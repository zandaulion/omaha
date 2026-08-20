import { db } from './db.js';
import { computeComprehensiveHealth } from './scoring.js';
import {
  fetchQuote,
  fetchFundamentals,
  fetchPriceHistory,
  search as yahooSearch
} from './yahoo.js';

const QUOTE_TTL_MIN = 15;
const FUNDAMENTALS_TTL_HOURS = 24;

/** Sectors where Altman Z and the working-capital ratios are not defined. */
const NON_INDUSTRIAL_SECTORS = new Set(['Financial Services', 'Real Estate']);

const minutesSince = (ts) => (Date.now() - new Date(ts).getTime()) / 60000;

// ---------------------------------------------------------------- search

export async function searchStocks(queryStr) {
  const query = (queryStr || '').trim();
  if (!query) return [];
  const upper = query.toUpperCase();

  let cached = [];
  try {
    cached = db
      .prepare(
        `SELECT ticker, name, sector, industry, price, change_pct, health_score
         FROM stock_cache
         WHERE ticker LIKE ? OR UPPER(name) LIKE ?
         ORDER BY CASE WHEN ticker = ? THEN 0 WHEN ticker LIKE ? THEN 1 ELSE 2 END,
                  health_score DESC
         LIMIT 10`
      )
      .all(`${upper}%`, `%${upper}%`, upper, `${upper}%`);
  } catch (err) {
    console.warn('[Finance] cache search failed:', err.message);
  }
  const cachedMap = new Map(cached.map((c) => [c.ticker, c]));

  let live = [];
  try {
    live = await yahooSearch(query);
  } catch (err) {
    console.warn('[Finance] live search failed:', err.message);
  }

  const results = new Map();
  if (cachedMap.has(upper)) {
    results.set(upper, { ...cachedMap.get(upper), isCached: true });
  }

  for (const item of live) {
    const hit = cachedMap.get(item.ticker);
    results.set(item.ticker, {
      ticker: item.ticker,
      name: hit?.name || item.name,
      sector: hit?.sector || item.sector,
      industry: hit?.industry || item.industry,
      exchange: item.exchange,
      quoteType: item.quoteType,
      price: hit?.price ?? null,
      change_pct: hit?.change_pct ?? null,
      health_score: hit?.health_score ?? null,
      isCached: Boolean(hit)
    });
  }

  for (const item of cached) {
    if (!results.has(item.ticker)) {
      results.set(item.ticker, { ...item, isCached: true });
    }
  }

  return [...results.values()].slice(0, 12);
}

// ------------------------------------------------------------ main entry

/**
 * Returns the scored stock, or `null` when the ticker cannot be resolved.
 * Never invents a company: an unknown symbol is an error, not a data point.
 */
export async function getStockData(tickerSymbol, forceRefresh = false) {
  const ticker = tickerSymbol.trim().toUpperCase();
  const cached = readCache(ticker);

  if (!forceRefresh && cached) {
    const quoteFresh = minutesSince(cached.last_fetched_at) < QUOTE_TTL_MIN;
    const fundamentalsFresh =
      cached.financials_fetched_at &&
      minutesSince(cached.financials_fetched_at) < FUNDAMENTALS_TTL_HOURS * 60;
    if (quoteFresh && fundamentalsFresh) return formatCachedStock(cached);
  }

  let quote = null;
  try {
    quote = await fetchQuote(ticker);
  } catch (err) {
    console.warn(`[Finance] quote fetch failed for ${ticker}: ${err.message}`);
  }

  if (!quote) {
    // Offline or rate-limited: serve what we have, clearly marked stale.
    if (cached) return formatCachedStock(cached, { stale: true });
    return null;
  }

  // Reuse stored statements when they are still inside their TTL — the
  // fundamentals request is the expensive one and filings change quarterly.
  let fundamentals = null;
  const storedFresh =
    cached?.financials_fetched_at &&
    minutesSince(cached.financials_fetched_at) < FUNDAMENTALS_TTL_HOURS * 60;

  if (!forceRefresh && storedFresh) {
    try {
      const stored = JSON.parse(cached.statements_json || 'null');
      if (stored?.annual?.length) fundamentals = stored;
    } catch {
      fundamentals = null;
    }
  }

  if (!fundamentals) {
    try {
      const [statements, prices] = await Promise.all([
        fetchFundamentals(ticker),
        fetchPriceHistory(ticker).catch(() => [])
      ]);
      fundamentals = { ...statements, priceHistory: prices };
    } catch (err) {
      console.warn(
        `[Finance] fundamentals fetch failed for ${ticker}: ${err.message}`
      );
      try {
        fundamentals = JSON.parse(cached?.statements_json || 'null');
      } catch {
        fundamentals = null;
      }
    }
  }

  if (!fundamentals) {
    fundamentals = {
      annual: [], quarterly: [], priceHistory: [],
      latestReported: {}, reportingCurrency: null
    };
  }

  const model = buildModel(quote, fundamentals);
  model.sectorMedianAssetTurnover = sectorMedianAssetTurnover(quote.sector, ticker);
  const peHistory = buildPeHistory(fundamentals, quote);
  model.peVsHistoryPct = peHistory.vsMedianPct;
  model.peHistory = peHistory;

  const score = computeComprehensiveHealth(model);
  score.peHistory = peHistory;
  const record = toRecord(ticker, quote, fundamentals, model, score);

  saveStockToCache(record, Boolean(fundamentals.annual.length));
  return formatCachedStock(record);
}

// --------------------------------------------------------- model assembly

function buildModel(quote, fundamentals) {
  const annual = fundamentals.annual || [];
  const latest = annual[annual.length - 1] || null;
  const prior = annual.length >= 2 ? annual[annual.length - 2] : null;

  const isFinancial =
    NON_INDUSTRIAL_SECTORS.has(quote.sector || '') ||
    /bank|insurance|capital market|reit|asset management/i.test(
      quote.industry || ''
    );

  return {
    quote,
    latest,
    prior,
    annual,
    quarterly: fundamentals.quarterly || [],
    latestReported: fundamentals.latestReported || {},
    isFinancial,
    reportingCurrency: fundamentals.reportingCurrency || quote.currency || null,
    history: buildHistory(annual)
  };
}

/**
 * Trend series straight from the filings. Where a statement line is absent the
 * array carries `null` for that year — the chart draws a gap rather than a
 * fabricated bar. No padding: four filed years are reported as four years.
 */
function buildHistory(annual) {
  const pct = (num, den) =>
    num === null || den === null || !den ? null : Number(((num / den) * 100).toFixed(1));
  const bn = (v) => (v === null || v === undefined ? null : Number((v / 1e9).toFixed(2)));

  const years = annual.map((p) => Number(String(p.asOfDate).slice(0, 4)));

  return {
    periods: annual.map((p) => p.asOfDate),
    years,
    revenue: annual.map((p) => bn(p.revenue)),
    freeCashFlow: annual.map((p) => bn(p.freeCashFlow)),
    operatingCashFlow: annual.map((p) => bn(p.operatingCashFlow)),
    netIncome: annual.map((p) => bn(p.netIncome)),
    grossMarginPct: annual.map((p) => pct(p.grossProfit, p.revenue)),
    operatingMarginPct: annual.map((p) =>
      pct(p.operatingIncome ?? p.ebit, p.revenue)
    ),
    sharesOutstanding: annual.map((p) => bn(p.dilutedShares)),
    dilutedEPS: annual.map((p) => (p.dilutedEPS ?? null)),
    cash: annual.map((p) => bn(sumOrNull(p.cash, p.shortTermInvestments))),
    totalDebt: annual.map((p) => bn(p.totalDebt)),
    revenueCAGR: cagr(annual.map((p) => p.revenue)),
    epsCAGR: cagr(annual.map((p) => p.dilutedEPS)),
    fcfPerShareCAGR: cagr(
      annual.map((p) =>
        p.freeCashFlow !== null && p.dilutedShares
          ? p.freeCashFlow / p.dilutedShares
          : null
      )
    ),
    shareChangeYoY: yoyChange(annual.map((p) => p.dilutedShares)),
    // The span the CAGRs actually cover, so the UI can label them honestly.
    cagrYears: countableSpan(annual.map((p) => p.revenue))
  };
}

function sumOrNull(...values) {
  const present = values.filter((v) => v !== null && v !== undefined);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/** Compound growth across the filed series. Null unless it is well defined. */
function cagr(series) {
  const points = series.filter((v) => v !== null && v !== undefined);
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const periods = points.length - 1;
  // A sign change makes compound growth meaningless rather than merely large.
  if (first <= 0 || last <= 0) return null;
  return Number((Math.pow(last / first, 1 / periods) - 1).toFixed(4));
}

function countableSpan(series) {
  const points = series.filter((v) => v !== null && v !== undefined);
  return points.length >= 2 ? points.length - 1 : null;
}

function yoyChange(series) {
  const points = series.filter((v) => v !== null && v !== undefined);
  if (points.length < 2) return null;
  const prev = points[points.length - 2];
  const curr = points[points.length - 1];
  if (!prev) return null;
  return Number(((curr - prev) / prev).toFixed(4));
}

// ------------------------------------------------- contextual comparisons

/**
 * Median asset turnover of the cached peers in this sector. Comparing a
 * grocer's turnover to a software company's on an absolute scale inverts the
 * ranking, so the check only runs once there are enough peers to form a
 * median; below that the caller falls back to absolute thresholds.
 */
function sectorMedianAssetTurnover(sector, excludeTicker) {
  if (!sector) return null;
  try {
    const rows = db
      .prepare(
        `SELECT financials_json FROM stock_cache
         WHERE sector = ? AND ticker != ? AND financials_json IS NOT NULL`
      )
      .all(sector, excludeTicker);

    const turnovers = [];
    for (const row of rows) {
      try {
        const f = JSON.parse(row.financials_json);
        if (f.revenue > 0 && f.totalAssets > 0) {
          turnovers.push(f.revenue / f.totalAssets);
        }
      } catch {
        // skip unparseable rows
      }
    }
    if (turnovers.length < 3) return null;
    turnovers.sort((a, b) => a - b);
    const mid = Math.floor(turnovers.length / 2);
    return turnovers.length % 2
      ? turnovers[mid]
      : (turnovers[mid - 1] + turnovers[mid]) / 2;
  } catch {
    return null;
  }
}

/**
 * The stock's own P/E range over the last five years, from monthly closes
 * divided by the diluted EPS of the fiscal year each month falls in. The spec
 * asks for valuation relative to a company's own history; that needs price
 * history, which the previous implementation never fetched, so it compared
 * against fixed absolute multiples instead.
 */
function buildPeHistory(fundamentals, quote) {
  const empty = { available: false, series: [], min: null, median: null, max: null, current: null, percentile: null, vsMedianPct: null };
  const prices = fundamentals.priceHistory || [];
  const annual = fundamentals.annual || [];
  if (!prices.length || annual.length < 2) return empty;

  const epsPeriods = annual
    .filter((p) => typeof p.dilutedEPS === 'number' && p.dilutedEPS > 0)
    .map((p) => ({ date: p.asOfDate, eps: p.dilutedEPS }));
  if (epsPeriods.length < 2) return empty;

  const series = [];
  for (const point of prices) {
    // Use the most recently *filed* EPS as of that month — the multiple an
    // investor could actually have computed at the time.
    let eps = null;
    for (const period of epsPeriods) {
      if (period.date <= point.date) eps = period.eps;
    }
    if (eps === null || eps <= 0) continue;
    const pe = point.close / eps;
    if (pe > 0 && pe < 400) series.push({ date: point.date, pe: Number(pe.toFixed(2)) });
  }
  if (series.length < 12) return empty;

  const values = series.map((s) => s.pe).sort((a, b) => a - b);
  const at = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  const median = at(0.5);
  const current = quote.trailingPE ?? series[series.length - 1].pe;

  const below = values.filter((v) => v <= current).length;

  return {
    available: true,
    series,
    min: values[0],
    p20: at(0.2),
    median,
    p80: at(0.8),
    max: values[values.length - 1],
    current: Number(current.toFixed(2)),
    percentile: Math.round((below / values.length) * 100),
    vsMedianPct: median > 0 ? Number((((current - median) / median) * 100).toFixed(1)) : null
  };
}

// ------------------------------------------------------------ persistence

function toRecord(ticker, quote, fundamentals, model, score) {
  const latest = model.latest || {};
  const cash = sumOrNull(latest.cash, latest.shortTermInvestments);

  return {
    ticker,
    name: quote.name,
    sector: quote.sector,
    industry: quote.industry,
    price: quote.price,
    change_pct: quote.changePct,
    currency: quote.currency || model.reportingCurrency,
    market_cap: quote.marketCap,
    health_score: score.healthScore,
    altman_z: score.altmanZ,
    piotroski_score: score.piotroskiScore,
    roic_pct: score.roicPct,
    fcf_conversion_pct: score.fcfConversionPct,
    net_cash_b: score.netCashB,
    financials_json: JSON.stringify({
      reportingCurrency: model.reportingCurrency,
      fiscalPeriodEnd: latest.asOfDate || null,
      isFinancial: model.isFinancial,
      revenue: latest.revenue ?? null,
      grossProfit: latest.grossProfit ?? null,
      operatingIncome: latest.operatingIncome ?? null,
      ebit: latest.ebit ?? null,
      ebitda: latest.ebitda ?? null,
      interestExpense: latest.interestExpense ?? null,
      netIncome: latest.netIncome ?? null,
      operatingCashFlow: latest.operatingCashFlow ?? null,
      capitalExpenditures: latest.capitalExpenditure ?? null,
      freeCashFlow: latest.freeCashFlow ?? null,
      cashAndEquivalents: cash,
      totalDebt: latest.totalDebt ?? null,
      currentAssets: latest.currentAssets ?? null,
      currentLiabilities: latest.currentLiabilities ?? null,
      inventory: latest.inventory ?? null,
      totalAssets: latest.totalAssets ?? null,
      totalLiabilities: latest.totalLiabilities ?? null,
      totalStockholderEquity: latest.equity ?? null,
      retainedEarnings: latest.retainedEarnings ?? null,
      dilutedShares: latest.dilutedShares ?? null,
      dilutedEPS: latest.dilutedEPS ?? null,
      grossMargin: score.metrics.grossMargin,
      operatingMargin: score.metrics.operatingMargin,
      historical: model.history
    }),
    checklist_json: JSON.stringify(score.checklist),
    catalysts_json: JSON.stringify(score.catalysts),
    risks_json: JSON.stringify(score.risks),
    pillars_json: JSON.stringify(score.pillars),
    summary_json: JSON.stringify({
      healthGrade: score.healthGrade,
      healthLabel: score.healthLabel,
      healthTier: score.healthTier,
      checklistSummary: score.checklistSummary,
      dcf: score.dcf,
      metrics: score.metrics,
      coverage: score.coverage,
      peHistory: score.peHistory || null,
      ratios: {
        pe: quote.trailingPE,
        forwardPE: quote.forwardPE,
        peg: quote.pegRatio,
        priceToBook: quote.priceToBook,
        dividendYield: quote.dividendYield,
        beta: quote.beta
      }
    }),
    statements_json: JSON.stringify(fundamentals)
  };
}

function saveStockToCache(r, hasFundamentals) {
  try {
    db.prepare(
      `INSERT INTO stock_cache (
         ticker, name, sector, industry, price, change_pct, currency, market_cap,
         health_score, altman_z, piotroski_score, roic_pct, fcf_conversion_pct, net_cash_b,
         financials_json, checklist_json, catalysts_json, risks_json, pillars_json,
         summary_json, statements_json, last_fetched_at, financials_fetched_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?,
         datetime('now'), ${hasFundamentals ? "datetime('now')" : 'NULL'}
       )
       ON CONFLICT(ticker) DO UPDATE SET
         name=excluded.name, sector=excluded.sector, industry=excluded.industry,
         price=excluded.price, change_pct=excluded.change_pct,
         currency=excluded.currency, market_cap=excluded.market_cap,
         health_score=excluded.health_score, altman_z=excluded.altman_z,
         piotroski_score=excluded.piotroski_score, roic_pct=excluded.roic_pct,
         fcf_conversion_pct=excluded.fcf_conversion_pct, net_cash_b=excluded.net_cash_b,
         financials_json=excluded.financials_json, checklist_json=excluded.checklist_json,
         catalysts_json=excluded.catalysts_json, risks_json=excluded.risks_json,
         pillars_json=excluded.pillars_json, summary_json=excluded.summary_json,
         statements_json=excluded.statements_json,
         last_fetched_at=datetime('now')
         ${hasFundamentals ? ", financials_fetched_at=datetime('now')" : ''}`
    ).run(
      r.ticker, r.name, r.sector, r.industry, r.price, r.change_pct, r.currency,
      r.market_cap, r.health_score, r.altman_z, r.piotroski_score, r.roic_pct,
      r.fcf_conversion_pct, r.net_cash_b, r.financials_json, r.checklist_json,
      r.catalysts_json, r.risks_json, r.pillars_json, r.summary_json,
      r.statements_json
    );
  } catch (err) {
    console.warn('[Finance] cache write failed:', err.message);
  }
}

function readCache(ticker) {
  try {
    return db.prepare('SELECT * FROM stock_cache WHERE ticker = ?').get(ticker) || null;
  } catch (err) {
    console.warn('[Finance] cache read failed:', err.message);
    return null;
  }
}

function formatCachedStock(row, opts = {}) {
  const summary = JSON.parse(row.summary_json || '{}');
  return {
    ticker: row.ticker,
    name: row.name,
    sector: row.sector,
    industry: row.industry,
    price: row.price,
    change_pct: row.change_pct,
    currency: row.currency || 'USD',
    market_cap: row.market_cap,
    health_score: row.health_score,
    altman_z: row.altman_z,
    piotroski_score: row.piotroski_score,
    roic_pct: row.roic_pct,
    fcf_conversion_pct: row.fcf_conversion_pct,
    net_cash_b: row.net_cash_b,
    financials: JSON.parse(row.financials_json || '{}'),
    checklist: JSON.parse(row.checklist_json || '[]'),
    catalysts: JSON.parse(row.catalysts_json || '[]'),
    risks: JSON.parse(row.risks_json || '[]'),
    pillars: JSON.parse(row.pillars_json || '[]'),
    summary,
    last_fetched_at: row.last_fetched_at,
    financials_fetched_at: row.financials_fetched_at || null,
    stale: Boolean(opts.stale)
  };
}

export { formatCachedStock };
