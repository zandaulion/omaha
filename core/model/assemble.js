/**
 * Pocket Omaha — model assembly.
 *
 * Turns a quote and a set of filed statements into the object the scoring
 * engine consumes. Pure apart from one FX lookup, which goes through the
 * provider seam rather than to any particular upstream.
 *
 * The rule this module inherits: a value the filings do not contain stays
 * `null`. Every trend series is exactly as long as the filings are, so a chart
 * draws a gap for an unreported year rather than a fabricated bar.
 */

import { getFxRate as fetchFxRate } from '../providers/index.js';

/** Sectors where Altman Z and the working-capital ratios are not defined. */
export const NON_INDUSTRIAL_SECTORS = new Set(['Financial Services', 'Real Estate']);

export function buildModel(quote, fundamentals) {
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
    // Direction of the most recent filed year, which a multi-year CAGR hides:
    // Bumble's revenue CAGR is +2.2% while its latest year fell 9.3%.
    ...(() => {
      const change = yoyChange(annual.map((p) => p.revenue));
      return { revenueChangeLatest: change.value, revenueChangeYears: change.years };
    })(),

    // A single year is a fragile base for a five-year projection when it is an
    // outlier. Both are carried so the model can pick and say which it used.
    freeCashFlowLatest: latestOf(annual.map((p) => p.freeCashFlow)),
    freeCashFlowNormalised: normalised(annual.map((p) => p.freeCashFlow)),

    revenueCAGR: cagr(annual.map((p) => p.revenue)),
    epsCAGR: cagr(annual.map((p) => p.dilutedEPS)),
    fcfPerShareCAGR: cagr(
      annual.map((p) =>
        p.freeCashFlow !== null && p.dilutedShares
          ? p.freeCashFlow / p.dilutedShares
          : null
      )
    ),
    ...(() => {
      const change = yoyChange(annual.map((p) => p.dilutedShares));
      return {
        shareChangeYoY: change.value,
        shareChangeYears: change.years,
        shareChangeIsAnnual: change.consecutive
      };
    })(),
    // The span the CAGRs actually cover, so the UI can label them honestly.
    cagrYears: countableSpan(annual.map((p) => p.revenue))
  };
}

/** Most recent non-null value in a series. */
function latestOf(series) {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null && series[i] !== undefined) return series[i];
  }
  return null;
}

/** Median of the last three reported values, as a normalised base. */
function normalised(series) {
  const points = series.filter((v) => v !== null && v !== undefined).slice(-3);
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function sumOrNull(...values) {
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

/**
 * Change between the two most recent *consecutive* filed periods.
 *
 * Filtering nulls and taking the last two values is wrong when a year is
 * missing: TAL has no FY2025 share count, so that approach reported the
 * FY2024-to-FY2026 change as if it were year on year. Where the latest period
 * or the one before it is unreported, the change is not year on year and the
 * span is returned alongside so the caller can label it honestly.
 */
function yoyChange(series) {
  const last = series.length - 1;
  if (last < 1) return { value: null, years: null, consecutive: false };

  const curr = series[last];
  if (curr === null || curr === undefined) {
    return { value: null, years: null, consecutive: false };
  }

  // Walk back to the nearest earlier period that reported a value.
  let idx = last - 1;
  while (idx >= 0 && (series[idx] === null || series[idx] === undefined)) idx--;
  if (idx < 0 || !series[idx]) return { value: null, years: null, consecutive: false };

  const span = last - idx;
  return {
    value: Number(((curr - series[idx]) / series[idx]).toFixed(4)),
    years: span,
    consecutive: span === 1
  };
}

/**
 * Put the market-derived figures into the currency the company reports in.
 *
 * A depositary receipt trades in one currency and files in another — NOK
 * quotes in USD and reports in EUR, SBSW quotes in USD and reports in ZAR.
 * Left unconverted, Altman's X4 divides a USD market capitalisation by EUR
 * liabilities, enterprise value adds USD to EUR, and the discounted-cash-flow
 * fair value comes out in EUR to be compared against a USD share price. Seven
 * of the twenty tickers on one of the seeded watchlists are affected, and for
 * a rand reporter the distortion is roughly eighteenfold.
 *
 * The traded price stays untouched — that is what the user sees on a broker
 * screen. A second, converted figure is added for the model to work in.
 */
export async function applyFxNormalisation(model) {
  const quote = model.quote;
  const reporting = model.reportingCurrency;
  const traded = quote.currency;

  model.tradedCurrency = traded;
  model.fx = { needed: false, rate: 1, from: traded, to: reporting, available: true };

  if (!reporting || !traded || reporting === traded) {
    quote.priceReporting = quote.price;
    quote.marketCapReporting = quote.marketCap;
    return;
  }

  const rate = await fetchFxRate(traded, reporting);
  model.fx = {
    needed: true,
    rate,
    from: traded,
    to: reporting,
    available: rate !== null
  };

  if (rate === null) {
    // Without a rate the two currencies must not be mixed, so the figures
    // that would combine them are withheld rather than silently wrong.
    quote.priceReporting = null;
    quote.marketCapReporting = null;
    return;
  }

  quote.priceReporting = quote.price * rate;
  quote.marketCapReporting =
    quote.marketCap !== null && quote.marketCap !== undefined
      ? quote.marketCap * rate
      : null;
}
