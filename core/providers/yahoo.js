/**
 * Pocket Omaha — Yahoo Finance ingestion.
 *
 * The v10 `quoteSummary` statement modules (balanceSheetHistory,
 * cashflowStatementHistory) return empty envelopes on the free endpoint —
 * `{maxAge, endDate}` and nothing else — and incomeStatementHistory returns
 * zeros for grossProfit/ebit/taxes. Fundamentals therefore come from the
 * `fundamentals-timeseries` service, which still serves complete statements.
 *
 * Rule for this module: a value Yahoo does not supply comes back as `null`.
 * Never substitute a plausible constant — a wrong number that looks right is
 * worse than an honest gap.
 */

import { IngestError, kindForStatus, parseRetryAfter } from '../errors.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const TIMESERIES_BASE =
  'https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/';
const QUOTESUMMARY_BASE =
  'https://query2.finance.yahoo.com/v10/finance/quoteSummary/';

let session = { cookie: null, crumb: null, expires: 0 };

export async function getSession(force = false) {
  if (!force && session.cookie && session.crumb && Date.now() < session.expires) {
    return session;
  }

  const headers = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  try {
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers,
      signal: AbortSignal.timeout(5000)
    });
    const cookie = cookieRes.headers.get('set-cookie');
    if (!cookie) return { cookie: null, crumb: null, expires: 0 };

    const crumbRes = await fetch(
      'https://query2.finance.yahoo.com/v1/test/getcrumb',
      { headers: { ...headers, Cookie: cookie }, signal: AbortSignal.timeout(5000) }
    );
    if (!crumbRes.ok) return { cookie: null, crumb: null, expires: 0 };

    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes('Too Many Requests') || crumb.includes('<html')) {
      return { cookie: null, crumb: null, expires: 0 };
    }

    session = { cookie, crumb, expires: Date.now() + 6 * 3600 * 1000 };
    return session;
  } catch (err) {
    console.warn('[Yahoo] session init failed:', err.message);
    return { cookie: null, crumb: null, expires: 0 };
  }
}

function authHeaders(sess) {
  const h = { 'User-Agent': UA };
  if (sess.cookie) h.Cookie = sess.cookie;
  return h;
}

/**
 * Drop the cached session.
 *
 * Exists for the tests: the crumb-recovery path is only observable from a
 * known starting state, and the session is module-level by design so that one
 * bootstrap serves every request. Not called on any production path.
 */
export function __resetSession() {
  session = { cookie: null, crumb: null, expires: 0 };
}

/**
 * One request, with transport failures typed.
 *
 * A thrown fetch (DNS, timeout, no route) is a `network` failure and is
 * retryable; a response that arrives is classified by status. Nothing here
 * decides *whether* to retry — that is the caller's business.
 */
async function doFetch(url, sess, timeoutMs, label) {
  let res;
  try {
    res = await fetch(url, {
      headers: authHeaders(sess),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    throw new IngestError('network', `${label} unreachable: ${err.message}`, {
      cause: err
    });
  }
  return res;
}

/**
 * An authenticated Yahoo request, with one crumb recovery.
 *
 * The session is cached locally for six hours, but Yahoo can invalidate a
 * crumb well before that — routinely so once it starts rate-limiting. Until
 * now `getSession` was only ever called with its default argument, so the
 * `force` path existed and was never reachable: every request after an early
 * invalidation failed until the local timer happened to expire.
 *
 * The crumb is a query parameter rather than a header, so the retry has to
 * rebuild the URL against the new session — hence a builder rather than a
 * string.
 *
 * @param {(sess: {cookie: string|null, crumb: string|null}) => string} buildUrl
 */
async function authedFetch(buildUrl, { timeoutMs, label }) {
  let sess = await getSession();
  let res = await doFetch(buildUrl(sess), sess, timeoutMs, label);

  if (res.status === 401 || res.status === 403) {
    sess = await getSession(true);
    res = await doFetch(buildUrl(sess), sess, timeoutMs, label);
  }

  if (!res.ok) {
    throw new IngestError(
      kindForStatus(res.status),
      `${label} HTTP ${res.status}`,
      {
        status: res.status,
        retryAfterMs: parseRetryAfter(res.headers.get('retry-after'))
      }
    );
  }
  return res;
}

/**
 * Statement fields we ask for, mapped to the names used inside the app.
 * Several Yahoo keys are aliases that appear on some filers and not others.
 * Order matters: earlier entries are preferred, and that preference is
 * enforced by rank in parseTimeseries rather than by arrival order.
 */
const FIELD_MAP = {
  revenue: ['TotalRevenue'],
  costOfRevenue: ['CostOfRevenue'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncome'],
  ebit: ['EBIT'],
  ebitda: ['EBITDA', 'NormalizedEBITDA'],
  interestExpense: ['InterestExpense', 'InterestExpenseNonOperating'],
  netIncome: ['NetIncome', 'NetIncomeCommonStockholders'],
  pretaxIncome: ['PretaxIncome'],
  taxProvision: ['TaxProvision'],
  dilutedEPS: ['DilutedEPS'],
  dilutedShares: ['DilutedAverageShares', 'BasicAverageShares'],

  totalAssets: ['TotalAssets'],
  totalLiabilities: ['TotalLiabilitiesNetMinorityInterest'],
  equity: ['StockholdersEquity', 'TotalEquityGrossMinorityInterest'],
  currentAssets: ['CurrentAssets'],
  currentLiabilities: ['CurrentLiabilities'],
  inventory: ['Inventory'],
  retainedEarnings: ['RetainedEarnings'],

  // For book-value businesses. TangibleBookValue is taken directly rather than
  // derived: checked against both a French and an American bank, Yahoo's
  // figure is exactly equity minus goodwill-and-intangibles minus preferred --
  // 70,144 - 8,251 - 0 = 61,893 for GLE.PA, and 303,243 - 69,021 - 25,992 =
  // 208,230 for BAC. That is tangible *common* equity, which is the
  // denominator return on tangible equity actually wants, and deriving it by
  // hand would only reintroduce the preferred-stock step Yahoo already took.
  // The components come too, so the number can be shown its working.
  tangibleBookValue: ['TangibleBookValue'],
  goodwillAndIntangibles: ['GoodwillAndOtherIntangibleAssets'],
  goodwill: ['Goodwill'],
  preferredEquity: ['PreferredStockEquity'],
  // Distinct from netIncome, whose first alias is NetIncome -- that is before
  // preferred dividends and includes minority interests, so it overstates what
  // the common shareholder earned. Only the return-on-tangible-equity model
  // uses this; nothing else changes.
  netIncomeToCommon: ['NetIncomeCommonStockholders'],
  cash: ['CashAndCashEquivalents'],
  shortTermInvestments: ['OtherShortTermInvestments', 'AvailableForSaleSecurities'],
  totalDebt: ['TotalDebt'],
  longTermDebt: ['LongTermDebt'],
  currentDebt: ['CurrentDebt'],

  freeCashFlow: ['FreeCashFlow'],
  operatingCashFlow: ['OperatingCashFlow'],
  capitalExpenditure: ['CapitalExpenditure'],
  dividendsPaid: ['CashDividendsPaid', 'CommonStockDividendPaid'],
  buybacks: ['RepurchaseOfCapitalStock']
};

const ANNUAL_KEYS = [...new Set(Object.values(FIELD_MAP).flat())];
// Only the handful needed for the quarterly gross-margin trend check.
const QUARTERLY_KEYS = ['TotalRevenue', 'GrossProfit', 'OperatingIncome', 'NetIncome'];

/**
 * Reverse index: Yahoo key -> { field, rank }.
 *
 * `rank` is the position in that field's alias list, and it matters: Yahoo
 * returns the series in arbitrary order, so resolving aliases by whichever
 * arrives first silently picks the wrong one. For TAL, Yahoo emits
 * BasicAverageShares before DilutedAverageShares and
 * TotalEquityGrossMinorityInterest before StockholdersEquity — so the app was
 * scoring on basic shares and gross-of-minority equity, which moved its
 * Altman Z from 3.00 to 2.97 and with it a checklist item from pass to watch.
 */
const KEY_TO_FIELD = {};
for (const [field, keys] of Object.entries(FIELD_MAP)) {
  keys.forEach((k, rank) => {
    if (!(k in KEY_TO_FIELD)) KEY_TO_FIELD[k] = { field, rank };
  });
}

function parseTimeseries(json, prefix) {
  // asOfDate -> { field: value }, plus the reporting currency when present.
  const byDate = new Map();
  let currency = null;

  // Best alias rank seen per (date, field), so the declared preference wins
  // regardless of the order Yahoo happens to emit the series in.
  const rankUsed = new Map();

  for (const series of json?.timeseries?.result || []) {
    const type = series?.meta?.type?.[0];
    if (!type || !type.startsWith(prefix)) continue;

    const mapping = KEY_TO_FIELD[type.slice(prefix.length)];
    if (!mapping) continue;
    const { field, rank } = mapping;

    for (const point of series[type] || []) {
      if (!point || point.reportedValue?.raw === undefined) continue;
      const date = point.asOfDate;
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, { asOfDate: date });

      const row = byDate.get(date);
      const slot = `${date}|${field}`;
      const bestSoFar = rankUsed.get(slot);
      if (bestSoFar === undefined || rank < bestSoFar) {
        row[field] = point.reportedValue.raw;
        rankUsed.set(slot, rank);
      }
      if (!currency && point.currencyCode) currency = point.currencyCode;
    }
  }

  const all = [...byDate.values()].sort((a, b) =>
    a.asOfDate < b.asOfDate ? -1 : 1
  );

  // Yahoo emits stub periods that carry one stray line item and nothing else
  // (Apple's FY2021 comes back with only an interest-expense figure). Those
  // are not fiscal years for trend purposes — a chart built over them shows a
  // year of nulls — so they are excluded here and harvested separately below.
  const periods = all.filter(
    (p) => p.revenue !== undefined || p.totalAssets !== undefined
  );

  // Normalise sign conventions: Yahoo reports capex as a negative outflow.
  for (const p of all) {
    if (typeof p.capitalExpenditure === 'number') {
      p.capitalExpenditure = Math.abs(p.capitalExpenditure);
    }
    if (typeof p.interestExpense === 'number') {
      p.interestExpense = Math.abs(p.interestExpense);
    }
    if (typeof p.dividendsPaid === 'number') {
      p.dividendsPaid = Math.abs(p.dividendsPaid);
    }
    // Every field we asked for but did not receive is explicitly null.
    for (const field of Object.keys(FIELD_MAP)) {
      if (p[field] === undefined) p[field] = null;
    }
  }

  // Newest reported value for each field across every period, including the
  // stubs. Some filers stop populating a line (Apple's interest expense ends
  // at FY2023); the last real figure is a better basis than "unavailable",
  // provided the UI says which year it came from.
  const latestReported = {};
  for (const p of all) {
    for (const field of Object.keys(FIELD_MAP)) {
      const v = p[field];
      if (v === null || v === undefined) continue;
      latestReported[field] = { value: v, asOfDate: p.asOfDate };
    }
  }

  return { periods, currency, latestReported };
}

async function timeseriesRequest(ticker, types) {
  const buildUrl = (sess) => {
    const params = new URLSearchParams({
      symbol: ticker,
      type: types.join(','),
      period1: '1200000000',
      period2: String(Math.floor(Date.now() / 1000))
    });
    if (sess.crumb) params.set('crumb', sess.crumb);
    return `${TIMESERIES_BASE}${encodeURIComponent(ticker)}?${params}`;
  };

  const res = await authedFetch(buildUrl, {
    timeoutMs: 9000,
    label: 'timeseries'
  });
  return res.json();
}

/**
 * Annual and quarterly statements. Returns `null` only when Yahoo gives us
 * nothing usable at all — an empty result is a real answer about a real
 * ticker, and the caller needs to be able to tell those apart.
 */
export async function fetchFundamentals(ticker) {
  const annualJson = await timeseriesRequest(
    ticker,
    ANNUAL_KEYS.map((k) => `annual${k}`)
  );
  const { periods: annual, currency, latestReported } = parseTimeseries(
    annualJson,
    'annual'
  );

  let quarterly = [];
  try {
    const qJson = await timeseriesRequest(
      ticker,
      QUARTERLY_KEYS.map((k) => `quarterly${k}`)
    );
    quarterly = parseTimeseries(qJson, 'quarterly').periods;
  } catch (err) {
    // The quarterly series only feeds one checklist item; its absence is
    // recorded as an unavailable check rather than treated as a failure.
    // Logged rather than silent so a rate limit reaching only this request is
    // still diagnosable — the annual call above would already have thrown if
    // the whole endpoint were blocked.
    console.warn(
      `[Yahoo] quarterly series unavailable for ${ticker}: ${err.kind || 'error'}`
    );
  }

  return { annual, quarterly, latestReported, reportingCurrency: currency };
}

/** Live price and the market-derived multiples. */
export async function fetchQuote(ticker) {
  const modules =
    'price,summaryProfile,summaryDetail,financialData,defaultKeyStatistics';

  const buildUrl = (sess) => {
    const params = new URLSearchParams({ modules });
    if (sess.crumb) params.set('crumb', sess.crumb);
    return `${QUOTESUMMARY_BASE}${encodeURIComponent(ticker)}?${params}`;
  };

  const res = await authedFetch(buildUrl, {
    timeoutMs: 8000,
    label: 'quoteSummary'
  });

  const result = (await res.json())?.quoteSummary?.result?.[0];
  if (!result) return null;

  const p = result.price || {};
  const sd = result.summaryDetail || {};
  const ks = result.defaultKeyStatistics || {};
  const sp = result.summaryProfile || {};
  const fd = result.financialData || {};

  const raw = (...candidates) => {
    for (const c of candidates) {
      if (c?.raw !== undefined && c.raw !== null && Number.isFinite(c.raw)) {
        return c.raw;
      }
    }
    return null;
  };

  const price = raw(p.regularMarketPrice, fd.currentPrice);
  if (price === null) return null;

  return {
    ticker,
    name: p.longName || p.shortName || ticker,
    sector: sp.sector || null,
    industry: sp.industry || null,
    currency: p.currency || null,
    price,
    changePct: (raw(p.regularMarketChangePercent) ?? 0) * 100,
    marketCap: raw(p.marketCap, sd.marketCap),
    sharesOutstanding: raw(ks.sharesOutstanding, p.sharesOutstanding),
    trailingPE: raw(sd.trailingPE, ks.trailingPE),
    forwardPE: raw(sd.forwardPE, ks.forwardPE),
    pegRatio: raw(ks.pegRatio, ks.trailingPegRatio),
    priceToBook: raw(ks.priceToBook),
    dividendYield: raw(sd.dividendYield, sd.trailingAnnualDividendYield),
    payoutRatio: raw(sd.payoutRatio),
    fiveYearAvgDividendYield: raw(sd.fiveYearAvgDividendYield),
    beta: raw(sd.beta, ks.beta),
    // financialData is genuine TTM for these, and useful as a cross-check —
    // but the statements are the reporting basis, so these stay separate.
    ttm: {
      revenue: raw(fd.totalRevenue),
      ebitda: raw(fd.ebitda),
      grossMargin: raw(fd.grossMargins),
      operatingMargin: raw(fd.operatingMargins),
      profitMargin: raw(fd.profitMargins),
      currentRatio: raw(fd.currentRatio),
      quickRatio: raw(fd.quickRatio),
      debtToEquity: raw(fd.debtToEquity),
      totalCash: raw(fd.totalCash),
      totalDebt: raw(fd.totalDebt),
      freeCashFlow: raw(fd.freeCashflow),
      operatingCashFlow: raw(fd.operatingCashflow),
      returnOnEquity: raw(fd.returnOnEquity),
      revenueGrowth: raw(fd.revenueGrowth),
      earningsGrowth: raw(fd.earningsGrowth)
    }
  };
}

/**
 * Monthly closes, five years back. Combined with the filed EPS series this
 * gives a real historical P/E range — the spec asks for valuation relative to
 * a stock's own history, which needs price history to compute.
 */
export async function fetchPriceHistory(ticker) {
  const buildUrl = () =>
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    '?interval=1mo&range=5y';

  const res = await authedFetch(buildUrl, { timeoutMs: 8000, label: 'chart' });

  const result = (await res.json())?.chart?.result?.[0];
  const stamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  if (!stamps.length) return [];

  const out = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i];
    if (typeof close !== 'number' || !Number.isFinite(close)) continue;
    out.push({ date: new Date(stamps[i] * 1000).toISOString().slice(0, 10), close });
  }
  return out;
}

/**
 * Spot FX rate, cached in process.
 *
 * Needed because a depositary receipt trades in one currency while the company
 * files in another: NOK quotes in USD and reports in EUR, SBSW quotes in USD
 * and reports in ZAR. Without a conversion the engine divides a USD market
 * capitalisation by EUR liabilities, and compares a EUR discounted-cash-flow
 * value against a USD share price.
 */
const fxCache = new Map();
const FX_TTL_MS = 6 * 3600 * 1000;

export async function fetchFxRate(from, to) {
  if (!from || !to) return null;
  if (from === to) return 1;

  const pair = `${from}${to}=X`;
  const hit = fxCache.get(pair);
  if (hit && Date.now() < hit.expires) return hit.rate;

  try {
    const buildUrl = () =>
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair)}` +
      '?interval=1d&range=5d';

    const res = await authedFetch(buildUrl, {
      timeoutMs: 6000,
      label: `FX ${pair}`
    });

    const meta = (await res.json())?.chart?.result?.[0]?.meta;
    const rate = meta?.regularMarketPrice;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new Error('no usable rate');
    }

    fxCache.set(pair, { rate, expires: Date.now() + FX_TTL_MS });
    return rate;
  } catch (err) {
    console.warn(`[Yahoo] FX ${pair} failed: ${err.message}`);
    // A stale rate beats no conversion; a missing one is reported as such.
    return hit ? hit.rate : null;
  }
}

/** Ticker / company-name search. */
export async function search(query) {
  const clean = (query || '').trim();
  if (!clean) return [];

  /** @type {IngestError|null} Why the last host could not answer. */
  let lastFailure = null;

  const urls = [
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(clean)}&quotesCount=14&newsCount=0`,
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(clean)}&quotesCount=14&newsCount=0`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(4000)
      });
      if (!res.ok) {
        lastFailure = new IngestError(
          kindForStatus(res.status), `search failed: HTTP ${res.status}`,
          { status: res.status,
            retryAfterMs: parseRetryAfter(res.headers?.get?.('retry-after')) });
        continue;
      }
      const data = await res.json();
      return (data.quotes || [])
        .filter((q) => ['EQUITY', 'ETF', 'MUTUALFUND'].includes(q.quoteType))
        .map((q) => ({
          ticker: q.symbol,
          name: q.shortname || q.longname || q.symbol,
          sector: q.sector || q.industry || '',
          industry: q.industry || '',
          exchange: q.exchDisp || q.exchange || '',
          quoteType: q.quoteType || 'EQUITY'
        }));
    } catch (err) {
      lastFailure = err instanceof IngestError
        ? err
        : new IngestError('network', `search unreachable: ${err.message}`,
                          { cause: err });
      // fall through to the next host
    }
  }

  // Reaching here means no host answered. Returning [] would be a lie the
  // client cannot see through: an empty list is also what a genuine no-match
  // looks like, and the search view renders that as "No matching companies
  // found for X" over a perfectly real ticker, offering to add it as though
  // it were unlisted. A failure has to fail.
  throw lastFailure ?? new IngestError('network', 'search unreachable');
}

/**
 * Peers Yahoo associates with this symbol, for the comparison view. The spec
 * asks for "top competitors in the same sector"; this is the closest thing to
 * an authoritative list available without a paid classification feed.
 */
export async function fetchPeers(ticker) {
  const buildUrl = () =>
    'https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/' +
    encodeURIComponent(ticker);

  try {
    const res = await authedFetch(buildUrl, {
      timeoutMs: 6000,
      label: 'peers'
    });
    const rows = (await res.json())?.finance?.result?.[0]?.recommendedSymbols || [];
    return rows
      .map((r) => r.symbol)
      .filter((s) => s && s !== ticker)
      .slice(0, 6);
  } catch {
    return [];
  }
}
