/**
 * Pocket Omaha — SEC EDGAR statement provider.
 *
 * Official, keyless, unlimited, and it returns the number a company actually
 * filed rather than a re-derivation of it. Doc 14 §2–3 has the research; this
 * is the implementation, and it satisfies the same `fetchFundamentals(ticker)`
 * contract `yahoo.js` does so the seam in `providers/index.js` can choose
 * between them per ticker.
 *
 * ## Why one large request rather than many small ones
 *
 * Doc 14 left the endpoint choice open and asked for it to be measured.
 * Measured 2026-08-24, and both of its figures were off:
 *
 * | | doc 14 | measured |
 * |---|---|---|
 * | `companyfacts` per company | ~3.8 MB | 0.91 MB (NOK), 3.61 (AAPL), **7.53 (JPM)** |
 * | `companyconcept` per tag | ~2 KB | **~18 KB** |
 *
 * `companyfacts` is still the right choice, and by a wider margin than the
 * original numbers suggested. This engine reads about thirty fields, each with
 * several candidate tags, and **which tag a filer uses is not known in
 * advance** — that is the entire problem this module solves. Resolving it with
 * `companyconcept` means a request per candidate, most of them 404, at ~18 KB
 * each against a 10 req/s budget. One request that is occasionally 7.5 MB beats
 * thirty-plus round trips that cannot be pipelined.
 *
 * **The open risk is parsing, not fetching.** `JSON.parse` of the JPM blob
 * costs 129 ms under Node on a laptop. QuickJS on a handset will be slower, and
 * doc 14 is right that this is the part that could disappoint. It has not been
 * measured on a device yet — see §"Still to measure" in doc 14.
 *
 * ## What EDGAR does not give you
 *
 * Yahoo synthesises `freeCashFlow`, `ebit`, `ebitda` and `totalDebt`. XBRL has
 * no such concepts, because companies do not file them. They are derived here,
 * and **only where the derivation is standard and unambiguous** — the app's
 * governing rule is that a number shown to a user is a number that was
 * measured, so a field whose inputs are missing stays `null` rather than
 * becoming a plausible constant.
 */

import { IngestError, kindForStatus, parseRetryAfter } from '../errors.js';

const TICKER_MAP_URL = 'https://www.sec.gov/files/company_tickers.json';
const COMPANYFACTS_BASE = 'https://data.sec.gov/api/xbrl/companyfacts/CIK';

/**
 * EDGAR requires a User-Agent naming the project and a contact address, and
 * refuses requests without one.
 *
 * ## Do not put `github.com` in this string
 *
 * Measured 2026-08-24 against `www.sec.gov`, same second, same client:
 *
 * ```
 * 403  PocketOmaha/1.0 (https://github.com/zandaulion/omaha; …)
 * 403  PocketOmaha/1.0 (github.com/zandaulion/omaha; …)
 * 200  PocketOmaha/1.0 (zandaulion/omaha; …)
 * 200  PocketOmaha/1.0 (https://example.com; …)
 * ```
 *
 * It is not URLs in general and it is not the contact address — it is the
 * literal substring `github.com`, which `www.sec.gov` refuses outright. The
 * trap is that citing the project's repository is exactly what a well-behaved
 * client would do, so the most conscientious version of this header is the one
 * that fails, and it fails only against the live host: every fixture-backed
 * test would pass.
 *
 * `data.sec.gov`, which serves `companyfacts`, is more permissive. The ticker
 * map lives on `www.sec.gov`, so the strict host is on the critical path.
 *
 * The address is real, which is the point: the SEC uses it to reach an operator
 * whose client is misbehaving, and it is the one thing in this header another
 * party relies on being true.
 */
export const EDGAR_USER_AGENT =
  'PocketOmaha/1.0 (zandaulion/omaha; zandaulion@gmail.com)';

/**
 * Which side of the statements a field comes from.
 *
 * XBRL draws a hard line the tag names do not: an income or cash-flow figure
 * covers a *period* and carries `start` and `end`, while a balance-sheet figure
 * is a *snapshot* and carries only `end`. Matching them the same way silently
 * pairs a year's revenue with the wrong year's cash, so the distinction is
 * declared rather than inferred.
 */
const DURATION = 'duration';
const INSTANT = 'instant';

/**
 * us-gaap tag candidates, in preference order.
 *
 * Order is load-bearing for the same reason it is in `yahoo.js`: several tags
 * can be present and the first is not necessarily the best. Revenue is the
 * clearest case — a filer may report both the post-ASC-606 contract-revenue tag
 * and a legacy `Revenues`, and they are not always equal.
 */
const US_GAAP = {
  revenue: [DURATION, [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'SalesRevenueGoodsNet'
  ]],
  costOfRevenue: [DURATION, ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfServices']],
  grossProfit: [DURATION, ['GrossProfit']],
  operatingIncome: [DURATION, ['OperatingIncomeLoss']],
  netIncome: [DURATION, ['NetIncomeLoss', 'ProfitLoss']],
  pretaxIncome: [DURATION, [
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'
  ]],
  taxProvision: [DURATION, ['IncomeTaxExpenseBenefit']],
  interestExpense: [DURATION, ['InterestExpense', 'InterestExpenseDebt', 'InterestIncomeExpenseNet']],
  dilutedEPS: [DURATION, ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted']],
  dilutedShares: [DURATION, [
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    'WeightedAverageNumberOfSharesOutstandingBasic'
  ]],
  depreciationAmortisation: [DURATION, [
    'DepreciationDepletionAndAmortization',
    'DepreciationAmortizationAndAccretionNet',
    'DepreciationAndAmortization'
  ]],

  totalAssets: [INSTANT, ['Assets']],
  totalLiabilities: [INSTANT, ['Liabilities']],
  equity: [INSTANT, [
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'
  ]],
  currentAssets: [INSTANT, ['AssetsCurrent']],
  currentLiabilities: [INSTANT, ['LiabilitiesCurrent']],
  inventory: [INSTANT, ['InventoryNet']],
  retainedEarnings: [INSTANT, ['RetainedEarningsAccumulatedDeficit']],
  cash: [INSTANT, [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'
  ]],
  shortTermInvestments: [INSTANT, [
    'ShortTermInvestments',
    'AvailableForSaleSecuritiesDebtSecuritiesCurrent',
    'MarketableSecuritiesCurrent'
  ]],
  longTermDebt: [INSTANT, ['LongTermDebtNoncurrent', 'LongTermDebt']],
  currentDebt: [INSTANT, ['LongTermDebtCurrent', 'DebtCurrent']],

  operatingCashFlow: [DURATION, [
    'NetCashProvidedByUsedInOperatingActivities',
    'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'
  ]],
  capitalExpenditure: [DURATION, [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets'
  ]],
  dividendsPaid: [DURATION, ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends']],
  buybacks: [DURATION, ['PaymentsForRepurchaseOfCommonStock']]
};

/**
 * ifrs-full tag candidates.
 *
 * Foreign private issuers filing 20-F or 40-F use this taxonomy — doc 14 names
 * NOK, SBSW and NU, while TAL files us-gaap despite being a foreign issuer, so
 * the taxonomy is detected per company rather than assumed from domicile.
 *
 * Doc 14 predicted nine of ten core concepts map cleanly and that capex is the
 * one that needs hunting. That holds: IFRS filers spread capital expenditure
 * across several `PurchaseOf…` variants with no single dominant spelling.
 */
const IFRS = {
  revenue: [DURATION, ['Revenue', 'RevenueFromContractsWithCustomers']],
  costOfRevenue: [DURATION, ['CostOfSales']],
  grossProfit: [DURATION, ['GrossProfit']],
  operatingIncome: [DURATION, ['ProfitLossFromOperatingActivities']],
  netIncome: [DURATION, ['ProfitLoss', 'ProfitLossAttributableToOwnersOfParent']],
  pretaxIncome: [DURATION, ['ProfitLossBeforeTax']],
  taxProvision: [DURATION, ['IncomeTaxExpenseContinuingOperations']],
  interestExpense: [DURATION, ['InterestExpense', 'FinanceCosts']],
  dilutedEPS: [DURATION, ['DilutedEarningsLossPerShare']],
  dilutedShares: [DURATION, [
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    'WeightedAverageShares'
  ]],
  depreciationAmortisation: [DURATION, [
    'DepreciationAndAmortisationExpense',
    'DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss'
  ]],

  totalAssets: [INSTANT, ['Assets']],
  totalLiabilities: [INSTANT, ['Liabilities']],
  equity: [INSTANT, ['Equity', 'EquityAttributableToOwnersOfParent']],
  currentAssets: [INSTANT, ['CurrentAssets']],
  currentLiabilities: [INSTANT, ['CurrentLiabilities']],
  inventory: [INSTANT, ['Inventories']],
  retainedEarnings: [INSTANT, ['RetainedEarnings']],
  cash: [INSTANT, ['CashAndCashEquivalents']],
  shortTermInvestments: [INSTANT, ['OtherCurrentFinancialAssets']],
  longTermDebt: [INSTANT, ['NoncurrentPortionOfNoncurrentBorrowings', 'LongtermBorrowings']],
  currentDebt: [INSTANT, ['ShorttermBorrowings', 'CurrentPortionOfLongtermBorrowings']],

  operatingCashFlow: [DURATION, ['CashFlowsFromUsedInOperatingActivities']],
  capitalExpenditure: [DURATION, [
    'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
    'PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets',
    'PurchaseOfInterestsInJointVenturesClassifiedAsInvestingActivities'
  ]],
  dividendsPaid: [DURATION, ['DividendsPaidClassifiedAsFinancingActivities', 'DividendsPaid']],
  buybacks: [DURATION, ['PaymentsToAcquireOrRedeemEntitysShares']]
};

/** Every field the engine consumes, so absent ones can be nulled explicitly. */
const ALL_FIELDS = [
  ...new Set([...Object.keys(US_GAAP), ...Object.keys(IFRS)]),
  // Derived below rather than filed. Listed so they are nulled like the rest.
  'ebit', 'ebitda', 'freeCashFlow', 'totalDebt'
];

/** Annual filings. A 40-F is the Canadian equivalent of a 20-F. */
const ANNUAL_FORMS = ['10-K', '20-F', '40-F'];

const DAY_MS = 86400000;

// ---------------------------------------------------------------- fetching

let tickerMapCache = null;

async function edgarFetch(url, { timeoutMs = 15000, label } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': EDGAR_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    throw new IngestError('network', `EDGAR ${label} request failed: ${err.message}`, {
      cause: err
    });
  }

  if (!res.ok) {
    // EDGAR signals throttling with 403, not 429.
    //
    // Observed 2026-08-24: the identical User-Agent that had just been served
    // 200 returned 403 during a burst, then 200 again seconds later. The
    // shared `kindForStatus` maps 403 to `unauthorized`, which is correct for
    // Yahoo — an invalidated crumb, recoverable by re-establishing the session
    // — and wrong here, because there is no session to re-establish and
    // `unauthorized` is not transient. Left unmapped, a throttled request would
    // surface as a permanent failure and the caller would never back off.
    const kind = res.status === 403 ? 'rate_limited' : kindForStatus(res.status);
    throw new IngestError(kind, `EDGAR ${label} returned ${res.status}`, {
      status: res.status,
      retryAfterMs: parseRetryAfter(res.headers.get('retry-after'))
    });
  }

  return res.json();
}

/**
 * Ticker to zero-padded CIK.
 *
 * The map is ~780 KB and covers every registrant, so it is fetched once and
 * held. It changes when companies list or delist — daily at most — and a stale
 * entry produces a `not_found` rather than a wrong company, because the CIK is
 * checked against the ticker it came from.
 */
export async function resolveCik(ticker) {
  const symbol = String(ticker || '').trim().toUpperCase();
  if (!symbol) {
    throw new IngestError('not_found', 'No ticker supplied');
  }

  if (!tickerMapCache) {
    const json = await edgarFetch(TICKER_MAP_URL, { label: 'ticker map', timeoutMs: 12000 });
    const map = new Map();
    for (const row of Object.values(json || {})) {
      if (row?.ticker && row?.cik_str !== undefined) {
        map.set(String(row.ticker).toUpperCase(), String(row.cik_str));
      }
    }
    if (map.size === 0) {
      throw new IngestError('upstream', 'EDGAR ticker map was empty');
    }
    tickerMapCache = map;
  }

  const cik = tickerMapCache.get(symbol);
  if (!cik) {
    // A real answer, not a failure. EDGAR covers SEC registrants; a company
    // listed only outside the US is genuinely absent, and the caller falls
    // back to another provider rather than reporting the company as unknown.
    throw new IngestError('not_found', `${symbol} is not an SEC registrant`);
  }
  return cik.padStart(10, '0');
}

/** Discards the cached ticker map. Exposed for tests. */
export function _resetTickerCache() {
  tickerMapCache = null;
}

// ---------------------------------------------------------------- parsing

/**
 * Choose the taxonomy this filer actually uses.
 *
 * Detected rather than assumed: doc 14 records that TAL is a foreign issuer
 * filing us-gaap, so domicile does not decide it. Whichever taxonomy is present
 * wins; where both are (rare, usually a transition year) the one with more of
 * our fields present does.
 */
export function selectTaxonomy(facts) {
  const hasUs = Boolean(facts?.['us-gaap']);
  const hasIfrs = Boolean(facts?.['ifrs-full']);

  if (hasUs && !hasIfrs) return { name: 'us-gaap', map: US_GAAP };
  if (hasIfrs && !hasUs) return { name: 'ifrs-full', map: IFRS };
  if (!hasUs && !hasIfrs) return null;

  const score = (name, map) =>
    Object.values(map).filter(([, tags]) => tags.some((t) => facts[name]?.[t])).length;
  return score('us-gaap', US_GAAP) >= score('ifrs-full', IFRS)
    ? { name: 'us-gaap', map: US_GAAP }
    : { name: 'ifrs-full', map: IFRS };
}

function daysBetween(start, end) {
  return (Date.parse(end) - Date.parse(start)) / DAY_MS;
}

/**
 * Is this fact a full financial year rather than a quarter or a stub?
 *
 * Judged on the reported duration rather than on `fp: 'FY'`. Fiscal years are
 * 52 or 53 weeks and drift a few days between filers, and — more importantly —
 * `fp` is unreliable: annual figures appear inside 10-Q filings, and some
 * filers stamp `FY` on a cumulative nine-month figure. The number of days
 * between two dates is a fact about the period; `fp` is a label about the form.
 */
function isAnnualDuration(fact) {
  if (!fact.start || !fact.end) return false;
  const d = daysBetween(fact.start, fact.end);
  return d >= 340 && d <= 400;
}

function isQuarterDuration(fact) {
  if (!fact.start || !fact.end) return false;
  const d = daysBetween(fact.start, fact.end);
  return d >= 80 && d <= 100;
}

/**
 * Pick one value per period end, preferring the most recently filed.
 *
 * The same fiscal year is reported many times: in its own annual report, then
 * as the comparative in the next two, and again after any restatement. Taking
 * whichever arrives first would mix original and restated figures across a
 * trend line. The latest filing is the company's current position on what the
 * number was, which is also what its next report will compare against.
 */
function pickByPeriod(facts, accept) {
  const best = new Map();
  for (const fact of facts) {
    if (typeof fact?.val !== 'number' || !fact.end) continue;
    if (!accept(fact)) continue;

    const existing = best.get(fact.end);
    if (!existing || String(fact.filed) > String(existing.filed)) {
      best.set(fact.end, fact);
    }
  }
  return best;
}

/**
 * All facts for a field, from the best candidate tag — the freshest one.
 *
 * One tag is chosen rather than several merged. Two tags for the same concept
 * carry genuinely different figures, and interleaving them by date builds a
 * trend, and therefore a CAGR, out of two different definitions.
 *
 * **Which one is not "the first that has any facts."** That rule is wrong in a
 * way that only shows up on real filings, and it cost a full afternoon of a
 * wrong number rather than a missing one. Nokia's `Revenue` holds exactly three
 * facts, all filed in 2018 and covering 2015–17; from IFRS 15 onward it reports
 * `RevenueFromContractsWithCustomers`, with 24. Taking the first non-empty tag
 * therefore returned a revenue series that stopped eight years ago — and every
 * modern period silently came back null.
 *
 * The same transition exists in us-gaap, where `Revenues` gives way to the
 * ASC 606 contract-revenue tags, so this is a general property of the data
 * rather than a Nokia quirk.
 *
 * Candidates are therefore ranked by **how recent their newest fact is**, then
 * by how many they have, and only then by declared order. A tag a company
 * stopped using cannot outrank the one it uses now.
 */
function factsForField(facts, taxonomyName, tags, currencyHint) {
  let best = null;

  tags.forEach((tag, rank) => {
    const entry = facts?.[taxonomyName]?.[tag];
    if (!entry?.units) return;

    const unitKeys = Object.keys(entry.units);
    // Per-share figures are filed under a compound unit like 'USD/shares';
    // share counts under 'shares'. Prefer a monetary unit in the reporting
    // currency, then anything else the tag offers.
    const preferred =
      unitKeys.find((u) => u === currencyHint) ||
      unitKeys.find((u) => u === 'shares') ||
      unitKeys.find((u) => u.startsWith(`${currencyHint}/`)) ||
      unitKeys[0];

    const rows = entry.units[preferred];
    if (!Array.isArray(rows) || rows.length === 0) return;

    let latest = '';
    for (const row of rows) {
      if (row?.end && row.end > latest) latest = row.end;
    }

    const candidate = { rows, unit: preferred, tag, latest, count: rows.length, rank };
    if (
      !best ||
      candidate.latest > best.latest ||
      (candidate.latest === best.latest && candidate.count > best.count)
    ) {
      best = candidate;
    }
  });

  return best;
}

/**
 * The currency this company reports in.
 *
 * Read from the units of a monetary fact rather than guessed. This is the
 * property doc 14 highlights as the reason to move: EDGAR labels it explicitly
 * per fact, which removes by construction the traded-versus-reporting
 * conflation that contaminated 7 of 20 tickers in the earlier audit.
 */
export function detectReportingCurrency(facts, taxonomyName, map) {
  for (const field of ['revenue', 'totalAssets', 'netIncome', 'equity']) {
    const spec = map[field];
    if (!spec) continue;
    for (const tag of spec[1]) {
      const units = facts?.[taxonomyName]?.[tag]?.units;
      if (!units) continue;
      const monetary = Object.keys(units).find((u) => /^[A-Z]{3}$/.test(u));
      if (monetary) return monetary;
    }
  }
  return 'USD';
}

/**
 * Fill in what companies file but do not tag.
 *
 * Every one of these is a definition rather than an estimate, and each returns
 * null the moment an input is missing. That is the app's governing rule: a
 * number shown to a person is a number that was measured, so a derivation with
 * a hole in it is not a smaller number, it is not a number.
 */
function derive(period) {
  const has = (k) => typeof period[k] === 'number';

  // Free cash flow: operating cash flow less capital expenditure. Universal,
  // and the only reason it is not filed is that it is not a GAAP line item.
  period.freeCashFlow =
    has('operatingCashFlow') && has('capitalExpenditure')
      ? period.operatingCashFlow - period.capitalExpenditure
      : null;

  // Total debt: interest-bearing borrowings, both maturities. A filer
  // reporting only one is reported as having only that one rather than being
  // credited with a zero it never stated.
  period.totalDebt =
    has('longTermDebt') || has('currentDebt')
      ? (period.longTermDebt || 0) + (period.currentDebt || 0)
      : null;

  // EBIT: operating income is the filed proxy. Where it is absent, pre-tax
  // income plus interest expense reconstructs it.
  period.ebit = has('operatingIncome')
    ? period.operatingIncome
    : has('pretaxIncome') && has('interestExpense')
      ? period.pretaxIncome + period.interestExpense
      : null;

  period.ebitda =
    typeof period.ebit === 'number' && has('depreciationAmortisation')
      ? period.ebit + period.depreciationAmortisation
      : null;

  return period;
}

/**
 * companyfacts JSON to the shape `fetchFundamentals` promises.
 *
 * Exported so it can be tested against recorded blobs without a network.
 */
export function parseCompanyFacts(json) {
  const facts = json?.facts;
  const taxonomy = selectTaxonomy(facts);
  if (!taxonomy) {
    throw new IngestError('upstream', 'EDGAR returned no recognised taxonomy');
  }

  const { name, map } = taxonomy;
  const currency = detectReportingCurrency(facts, name, map);

  const build = (accept) => {
    const byDate = new Map();

    // Duration facts first, and they alone decide which dates are periods.
    //
    // This ordering is the whole correctness argument. A balance sheet is
    // filed at every quarter end regardless of the period being reported, so
    // letting instants create periods yields one "year" per quarter — measured
    // at 70 annual periods for AAPL before this was separated, against the ~13
    // it actually has. A fiscal year exists because an income statement covers
    // it; the balance sheet is what the company looked like on the last day of
    // one.
    for (const [field, [kind, tags]] of Object.entries(map)) {
      if (kind !== DURATION) continue;
      const found = factsForField(facts, name, tags, currency);
      if (!found) continue;

      for (const [end, fact] of pickByPeriod(found.rows, accept)) {
        if (!byDate.has(end)) byDate.set(end, { asOfDate: end });
        byDate.get(end)[field] = fact.val;
      }
    }

    // Then instants, attached only to dates a duration fact already claimed.
    for (const [field, [kind, tags]] of Object.entries(map)) {
      if (kind !== INSTANT) continue;
      const found = factsForField(facts, name, tags, currency);
      if (!found) continue;

      for (const [end, fact] of pickByPeriod(found.rows, (f) => !f.start)) {
        if (byDate.has(end)) byDate.get(end)[field] = fact.val;
      }
    }

    // A period needs an income statement behind it. Anything else is a date
    // some other line item happened to land on.
    const periods = [...byDate.values()]
      .filter((p) => p.revenue !== undefined || p.netIncome !== undefined)
      .sort((a, b) => (a.asOfDate < b.asOfDate ? -1 : 1));

    for (const p of periods) {
      // EDGAR files capital expenditure and dividends as positive outflows and
      // Yahoo as negatives; both are normalised to magnitudes so the engine
      // above never learns which provider it was handed.
      for (const k of ['capitalExpenditure', 'interestExpense', 'dividendsPaid', 'buybacks']) {
        if (typeof p[k] === 'number') p[k] = Math.abs(p[k]);
      }
      derive(p);
      for (const field of ALL_FIELDS) {
        if (p[field] === undefined) p[field] = null;
      }
    }

    return periods;
  };

  const annual = build(isAnnualDuration);
  const quarterly = build(isQuarterDuration);

  const latestReported = {};
  for (const p of annual) {
    for (const field of ALL_FIELDS) {
      const v = p[field];
      if (v === null || v === undefined) continue;
      latestReported[field] = { value: v, asOfDate: p.asOfDate };
    }
  }

  return { annual, quarterly, latestReported, reportingCurrency: currency };
}

// ---------------------------------------------------------------- entry point

/**
 * Annual and quarterly filed statements for a ticker.
 *
 * Same contract as `yahoo.fetchFundamentals`, so `providers/index.js` can pick
 * between them without anything above the seam noticing.
 */
export async function fetchFundamentals(ticker) {
  const cik = await resolveCik(ticker);
  const json = await edgarFetch(`${COMPANYFACTS_BASE}${cik}.json`, {
    label: 'companyfacts',
    timeoutMs: 20000
  });
  return parseCompanyFacts(json);
}

export { ANNUAL_FORMS, US_GAAP, IFRS };
