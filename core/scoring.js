/**
 * Pocket Omaha — fundamental scoring engine.
 *
 * Design rule, and the reason this file was rewritten: a metric that cannot be
 * computed is reported as unavailable. It never falls back to a plausible
 * constant, because a fabricated input produces a confident score that is
 * simply wrong, and the user cannot tell the difference.
 *
 * Unavailable sub-scores are excluded from their pillar's denominator, so a
 * bank is not punished for having no gross profit line. But if too little of
 * the scorecard can be measured, no composite is emitted at all.
 */

import { fixed as fixedDecimal } from './format.js';

/** Below this share of measurable sub-scores, a composite would be noise. */
const MIN_COVERAGE = 0.6;

/** CAPM inputs for the WACC estimate used by the ROIC-vs-cost-of-capital test. */
const RISK_FREE_RATE = 0.042;
const EQUITY_RISK_PREMIUM = 0.05;
const DEFAULT_BETA = 1.0;

/**
 * Trailing beta is a five-year regression, and a structural break in that
 * window can drive it far below anything a real equity investor would accept.
 * Yahoo reports 0.15 for TAL, which by CAPM alone implies a 4.95% cost of
 * equity for a Chinese ADR — below what its own government bonds pay. Betas
 * are clamped to a range in which the model still means something.
 */
const MIN_BETA = 0.6;
const MAX_BETA = 2.5;
/** No equity is cheaper capital than a bond plus a real risk premium. */
const MIN_WACC = 0.06;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Division that yields null rather than Infinity or NaN. */
function ratio(numerator, denominator, { allowNegativeDenominator = false } = {}) {
  const a = num(numerator);
  const b = num(denominator);
  if (a === null || b === null || b === 0) return null;
  if (!allowNegativeDenominator && b < 0) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}

const round = (v, dp = 2) => (v === null ? null : Number(fixedDecimal(v, dp)));

// =====================================================================
// 1. Altman Z-Score
// =====================================================================

/**
 * Altman's 1968 model for public manufacturers. It is not defined for banks,
 * insurers or REITs — their balance sheets have no working-capital cycle — so
 * the caller passes `applicable: false` and the score is reported unavailable
 * rather than computed on inapplicable inputs.
 */
export function calculateAltmanZScore(params) {
  const {
    workingCapital, retainedEarnings, ebit, marketCap,
    totalLiabilities, totalRevenue, totalAssets
  } = params;

  const assets = num(totalAssets);
  if (assets === null || assets <= 0) return null;

  const X1 = ratio(workingCapital, assets, { allowNegativeDenominator: true });
  const X2 = ratio(retainedEarnings, assets);
  const X3 = ratio(ebit, assets);
  const X4 = ratio(marketCap, totalLiabilities);
  const X5 = ratio(totalRevenue, assets);

  // Every term is required; a missing one would silently bias the total.
  if ([X1, X2, X3, X4, X5].some((t) => t === null)) return null;

  return round(1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * X4 + 0.999 * X5);
}

// =====================================================================
// 2. Piotroski F-Score
// =====================================================================

/**
 * Nine binary tests, six of which compare against the prior fiscal year. With
 * no filed prior year the score is unavailable — the previous implementation
 * synthesised a prior year scaled to be uniformly worse, which made all six
 * comparisons pass by construction.
 */
export function calculatePiotroskiFScore(current, prior) {
  if (!current || !prior) return null;

  const details = [];
  let score = 0;
  let testable = 0;

  const test = (id, name, passed) => {
    if (passed === null) {
      details.push({ id, name, passed: null, available: false });
      return;
    }
    testable++;
    if (passed) score++;
    details.push({ id, name, passed, available: true });
  };

  const gt = (a, b) => (num(a) === null || num(b) === null ? null : a > b);
  const lte = (a, b) => (num(a) === null || num(b) === null ? null : a <= b);

  // Profitability
  test('f1', 'Positive net income', num(current.netIncome) === null ? null : current.netIncome > 0);
  test('f2', 'Positive operating cash flow', num(current.operatingCashFlow) === null ? null : current.operatingCashFlow > 0);
  test('f3', 'Return on assets improved',
    gt(ratio(current.netIncome, current.totalAssets), ratio(prior.netIncome, prior.totalAssets)));
  test('f4', 'Operating cash flow exceeds net income', gt(current.operatingCashFlow, current.netIncome));

  // Leverage, liquidity, source of funds.
  // Piotroski measures leverage as long-term debt over assets, not the raw
  // debt figure, so that growth through retained earnings is not penalised.
  test('f5', 'Leverage steady or lower',
    lte(ratio(current.longTermDebt ?? current.totalDebt, current.totalAssets),
        ratio(prior.longTermDebt ?? prior.totalDebt, prior.totalAssets)));
  test('f6', 'Current ratio improved',
    gt(ratio(current.currentAssets, current.currentLiabilities),
       ratio(prior.currentAssets, prior.currentLiabilities)));
  test('f7', 'No share dilution', lte(current.dilutedShares, prior.dilutedShares));

  // Operating efficiency
  test('f8', 'Gross margin expanded',
    gt(ratio(current.grossProfit, current.revenue), ratio(prior.grossProfit, prior.revenue)));
  test('f9', 'Asset turnover improved',
    gt(ratio(current.revenue, current.totalAssets), ratio(prior.revenue, prior.totalAssets)));

  if (testable < 6) return null;

  return {
    score,
    testable,
    maxScore: 9,
    // Scaled to the canonical 0-9 range when a filer omits a line item, so a
    // bank's 7-of-7 is comparable with an industrial's 9-of-9.
    normalised: testable === 9 ? score : Math.round((score / testable) * 9),
    details
  };
}

// =====================================================================
// 3. ROIC and the cost of capital
// =====================================================================

/**
 * NOPAT over invested capital. Invested capital can legitimately be zero or
 * negative for companies that have bought back stock into negative book equity
 * (AutoZone, Home Depot, McDonald's). ROIC is undefined there, and the old
 * `Math.max(1, ...)` clamp turned that into a 395-billion-percent return.
 */
export function calculateROIC({ ebit, taxRate, totalDebt, equity, cash }) {
  const operating = num(ebit);
  if (operating === null) return null;

  const rate = num(taxRate);
  const effectiveTax = rate !== null && rate >= 0 && rate < 0.6 ? rate : null;
  if (effectiveTax === null) return null;

  const debt = num(totalDebt) ?? 0;
  const eq = num(equity);
  const liquid = num(cash) ?? 0;
  if (eq === null) return null;

  const invested = debt + eq - liquid;
  if (invested <= 0) return null;

  return round(((operating * (1 - effectiveTax)) / invested) * 100);
}

/**
 * Weighted average cost of capital, estimated. Cost of equity from CAPM with
 * the stock's own beta; cost of debt from what it actually pays on its debt.
 * Reported as an estimate because the inputs are market-implied, not filed.
 */
export function estimateWACC({ beta, marketCap, totalDebt, interestExpense, taxRate }) {
  const equityValue = num(marketCap);
  if (equityValue === null || equityValue <= 0) return null;

  const debt = num(totalDebt) ?? 0;
  const total = equityValue + debt;
  if (total <= 0) return null;

  const rawBeta = num(beta) ?? DEFAULT_BETA;
  const usedBeta = Math.min(MAX_BETA, Math.max(MIN_BETA, rawBeta));
  const costOfEquity = RISK_FREE_RATE + usedBeta * EQUITY_RISK_PREMIUM;

  let costOfDebt = ratio(interestExpense, debt);
  if (costOfDebt === null || costOfDebt <= 0 || costOfDebt > 0.25) {
    costOfDebt = RISK_FREE_RATE + 0.015;
  }

  const tax = num(taxRate);
  const afterTaxDebt = costOfDebt * (1 - (tax !== null && tax >= 0 && tax < 0.6 ? tax : 0.21));

  const wacc = costOfEquity * (equityValue / total) + afterTaxDebt * (debt / total);
  return round(Math.max(MIN_WACC, wacc) * 100);
}

// =====================================================================
// 4. Two-stage DCF
// =====================================================================

export function calculateDCFFairValue(params) {
  const {
    trailingFCF, growthRate = 0.12, terminalMultiple = 20,
    discountRate = 0.095, cashReserves = 0, totalDebt = 0, sharesOutstanding
  } = params;

  const fcf0 = num(trailingFCF);
  const shares = num(sharesOutstanding);

  // A company burning cash has no discounted-cash-flow value. The previous
  // implementation substituted $1 (server) or $1bn (client) of free cash flow
  // and produced a real-looking intrinsic value for it.
  if (fcf0 === null || fcf0 <= 0) {
    return { applicable: false, reason: 'negative-fcf', fairValuePerShare: null };
  }
  if (shares === null || shares <= 0) {
    return { applicable: false, reason: 'no-share-count', fairValuePerShare: null };
  }
  if (discountRate <= 0) {
    return { applicable: false, reason: 'invalid-discount-rate', fairValuePerShare: null };
  }

  const pvCashFlows = [];
  let currentFCF = fcf0;
  for (let t = 1; t <= 5; t++) {
    currentFCF *= 1 + growthRate;
    pvCashFlows.push({
      year: t,
      projectedFCF: currentFCF,
      presentValue: currentFCF / Math.pow(1 + discountRate, t)
    });
  }

  const cumulativePV = pvCashFlows.reduce((s, i) => s + i.presentValue, 0);
  const terminalValue = currentFCF * terminalMultiple;
  const pvTerminalValue = terminalValue / Math.pow(1 + discountRate, 5);
  const enterpriseValue = cumulativePV + pvTerminalValue;
  const equityValue = enterpriseValue + (num(cashReserves) ?? 0) - (num(totalDebt) ?? 0);

  // Negative equity value is a real result — the debt load exceeds the
  // discounted cash flows — and is reported as such rather than clamped to 0.
  return {
    applicable: true,
    fairValuePerShare: round(equityValue / shares),
    cumulativePV: round(cumulativePV),
    terminalValue: round(terminalValue),
    pvTerminalValue: round(pvTerminalValue),
    enterpriseValue: round(enterpriseValue),
    equityValue: round(equityValue),
    pvCashFlows
  };
}

// =====================================================================
// 5. Derived metrics
// =====================================================================

function deriveMetrics(model) {
  const q = model.quote || {};
  const cur = model.latest || {};
  const prior = model.prior || {};
  const hist = model.history || {};
  const carried = model.latestReported || {};

  /**
   * Falls back to the most recent year a filer actually reported this line.
   * Apple stopped populating interest expense after FY2023; treating that as
   * "unavailable" loses a real, checkable number. The year it came from is
   * carried alongside so the UI can label a carried-forward figure.
   */
  const withCarry = (field) => {
    const direct = num(cur[field]);
    if (direct !== null) return { value: direct, asOf: cur.asOfDate, carried: false };
    const fallback = carried[field];
    if (fallback && num(fallback.value) !== null) {
      return { value: fallback.value, asOf: fallback.asOfDate, carried: true };
    }
    return { value: null, asOf: null, carried: false };
  };

  // Assets = liabilities + equity is an identity, not an estimate, so filling
  // a missing third term from the other two is arithmetic rather than a guess.
  // Yahoo omits TotalLiabilities for some filers (Alphabet among them).
  const totalAssetsRaw = num(cur.totalAssets);
  const equityRaw = num(cur.equity);
  const liabilitiesRaw = num(cur.totalLiabilities);
  const totalLiabilities =
    liabilitiesRaw ??
    (totalAssetsRaw !== null && equityRaw !== null ? totalAssetsRaw - equityRaw : null);

  const cash = sum(cur.cash, cur.shortTermInvestments);
  const totalDebt = num(cur.totalDebt);
  const netCash = cash === null || totalDebt === null ? null : cash - totalDebt;

  const workingCapital =
    num(cur.currentAssets) === null || num(cur.currentLiabilities) === null
      ? null
      : cur.currentAssets - cur.currentLiabilities;

  const reportedTaxRate = ratio(cur.taxProvision, cur.pretaxIncome);
  // A loss-making year produces a meaningless effective rate (negative, or
  // wildly over 100%). NOPAT is negative either way, so the statutory rate
  // keeps ROIC computable and correctly negative rather than unavailable.
  const taxRateUsable =
    reportedTaxRate !== null && reportedTaxRate >= 0 && reportedTaxRate < 0.6;
  const effectiveTaxRate = taxRateUsable ? reportedTaxRate : null;
  const appliedTaxRate = taxRateUsable ? reportedTaxRate : 0.21;

  const operatingIncome = num(cur.operatingIncome) ?? num(cur.ebit);
  const grossMargin = ratio(cur.grossProfit, cur.revenue);
  const operatingMargin = ratio(operatingIncome, cur.revenue);

  const priorGrossMargin = ratio(prior.grossProfit, prior.revenue);
  const priorOperatingMargin = ratio(
    num(prior.operatingIncome) ?? num(prior.ebit),
    prior.revenue
  );

  // Interest cover: a debt-free company has no interest burden to cover, which
  // is a pass on the merits rather than a missing measurement.
  const interest = withCarry('interestExpense');
  let interestCoverage = null;
  let interestCoverageUnburdened = false;
  // Only a *reported* zero counts as debt-free. Absent data is not evidence
  // of a clean balance sheet.
  if (totalDebt === 0 || (totalDebt !== null && interest.value === 0)) {
    interestCoverageUnburdened = true;
  } else if (totalDebt !== null) {
    interestCoverage = ratio(cur.ebit ?? operatingIncome, interest.value, {
      allowNegativeDenominator: false
    });
  }

  const equity = num(cur.equity);
  // Yahoo omits marketCap for some listings (AutoZone among them). Price times
  // the filed diluted share count is the same quantity, so the whole valuation
  // pillar and Altman's X4 stay computable.
  const sharesForCap = num(q.sharesOutstanding) ?? num(cur.dilutedShares);

  // Market figures are taken in the currency the company reports in. A
  // depositary receipt trades in one currency and files in another, and every
  // ratio below combines the two — Altman's X4, enterprise value, the cash
  // flow yields and the whole discounted-cash-flow model. Where the rate could
  // not be fetched these are null, and the dependent metrics report as
  // unavailable rather than mixing currencies.
  const priceReporting = num(q.priceReporting) ?? (model.fx?.needed ? null : num(q.price));
  const marketCap =
    num(q.marketCapReporting) ??
    (priceReporting !== null && sharesForCap !== null ? priceReporting * sharesForCap : null);
  const enterpriseValue =
    marketCap === null || totalDebt === null || cash === null
      ? null
      : marketCap + totalDebt - cash;

  const roic = calculateROIC({
    ebit: cur.ebit ?? operatingIncome,
    taxRate: appliedTaxRate,
    totalDebt,
    equity,
    cash
  });

  const wacc = estimateWACC({
    beta: q.beta,
    marketCap,
    totalDebt,
    interestExpense: interest.value,
    taxRate: appliedTaxRate
  });

  const altmanZ = model.isFinancial
    ? null
    : calculateAltmanZScore({
        workingCapital,
        retainedEarnings: cur.retainedEarnings,
        ebit: cur.ebit ?? operatingIncome,
        marketCap,
        totalLiabilities,
        totalRevenue: cur.revenue,
        totalAssets: cur.totalAssets
      });

  const piotroski = calculatePiotroskiFScore(
    model.latest ? { ...cur, longTermDebt: cur.longTermDebt } : null,
    model.prior ? { ...prior, longTermDebt: prior.longTermDebt } : null
  );

  const fcf = num(cur.freeCashFlow);
  const dividendPayoutOnFcf = ratio(cur.dividendsPaid, cur.freeCashFlow);

  return {
    fiscalPeriodEnd: cur.asOfDate || null,
    isFinancial: Boolean(model.isFinancial),

    revenue: num(cur.revenue),
    netIncome: num(cur.netIncome),
    ebit: num(cur.ebit) ?? operatingIncome,
    ebitda: num(cur.ebitda),
    freeCashFlow: fcf,
    operatingCashFlow: num(cur.operatingCashFlow),

    cash,
    totalDebt,
    netCash,
    netCashB: netCash === null ? null : round(netCash / 1e9),
    equity,
    workingCapital,

    grossMargin,
    operatingMargin,
    fcfMargin: ratio(cur.freeCashFlow, cur.revenue),
    grossMarginChangeBps:
      grossMargin === null || priorGrossMargin === null
        ? null
        : Math.round((grossMargin - priorGrossMargin) * 10000),
    operatingMarginChangeBps:
      operatingMargin === null || priorOperatingMargin === null
        ? null
        : Math.round((operatingMargin - priorOperatingMargin) * 10000),

    currentRatio: ratio(cur.currentAssets, cur.currentLiabilities),
    quickRatio:
      num(cur.currentAssets) === null || num(cur.currentLiabilities) === null
        ? null
        : ratio(cur.currentAssets - (num(cur.inventory) ?? 0), cur.currentLiabilities),
    interestCoverage,
    interestCoverageUnburdened,
    interestExpense: interest.value,
    interestExpenseAsOf: interest.asOf,
    interestExpenseCarried: interest.carried,
    equityToAssets: ratio(cur.equity, cur.totalAssets),
    totalLiabilities,
    totalLiabilitiesDerived: liabilitiesRaw === null && totalLiabilities !== null,
    netDebtToEbitda:
      netCash === null || num(cur.ebitda) === null || cur.ebitda <= 0
        ? null
        : round(-netCash / cur.ebitda),
    debtToEquity: equity !== null && equity > 0 ? ratio(totalDebt, equity) : null,
    negativeEquity: equity !== null && equity <= 0,

    beta: num(q.beta),
    betaClamped:
      num(q.beta) !== null && (q.beta < 0.6 || q.beta > 2.5),
    effectiveTaxRate,
    appliedTaxRate,
    taxRateEstimated: !taxRateUsable,
    roic,
    wacc,
    roicSpread: roic === null || wacc === null ? null : round(roic - wacc),
    roa: ratio(cur.netIncome, cur.totalAssets),
    roe: equity !== null && equity > 0 ? ratio(cur.netIncome, equity) : null,
    assetTurnover: ratio(cur.revenue, cur.totalAssets),

    fcfConversion: ratio(cur.freeCashFlow, cur.netIncome),
    fcfYield: ratio(cur.freeCashFlow, marketCap),
    evToFcfYield: ratio(cur.freeCashFlow, enterpriseValue),
    enterpriseValue,

    altmanZ,
    piotroski,

    revenueCAGR: hist.revenueCAGR ?? null,
    revenueChangeLatest: hist.revenueChangeLatest ?? null,
    revenueChangeYears: hist.revenueChangeYears ?? null,
    freeCashFlowLatest: hist.freeCashFlowLatest ?? null,
    freeCashFlowNormalised: hist.freeCashFlowNormalised ?? null,
    epsCAGR: hist.epsCAGR ?? null,
    fcfPerShareCAGR: hist.fcfPerShareCAGR ?? null,
    shareChangeYoY: hist.shareChangeYoY ?? null,
    shareChangeYears: hist.shareChangeYears ?? null,
    shareChangeIsAnnual: hist.shareChangeIsAnnual ?? null,
    cagrYears: hist.cagrYears ?? null,

    // Compound annual rate implied by the change, so a multi-year span is
    // comparable with a genuine one-year move.
    shareChangeAnnualisedPct: (() => {
      const change = hist.shareChangeYoY;
      if (change === null || change === undefined) return null;
      const years = hist.shareChangeYears || 1;
      if (years <= 1) return Number(fixedDecimal((change * 100), 2));
      return Number(fixedDecimal(((Math.pow(1 + change, 1 / years) - 1) * 100), 2));
    })(),

    fcfPositiveYears: (hist.freeCashFlow || []).filter((v) => v !== null && v > 0).length,
    fcfReportedYears: (hist.freeCashFlow || []).filter((v) => v !== null).length,
    quarterlyGrossMarginTrend: quarterlyMarginTrend(model.quarterly),

    dividendYield: num(q.dividendYield),
    dividendPayoutOnFcf,
    dividendStreakYears: dividendStreak(model.annual),

    trailingPE: num(q.trailingPE),
    forwardPE: num(q.forwardPE),
    pegRatio: num(q.pegRatio),
    priceToBook: num(q.priceToBook),
    marketCap,
    marketCapDerived: num(q.marketCapReporting) === null && marketCap !== null,
    // `price` is the figure every ratio here is computed against, so it is the
    // one in the reporting currency. The traded price is carried separately.
    price: priceReporting,
    tradedPrice: num(q.price),
    tradedCurrency: model.tradedCurrency ?? q.currency ?? null,
    reportingCurrency: model.reportingCurrency ?? null,
    fx: model.fx ?? null,
    sharesOutstanding: sharesForCap
  };
}

function sum(...values) {
  const present = values.map(num).filter((v) => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/** Direction of gross margin across the filed quarters, in basis points. */
function quarterlyMarginTrend(quarters) {
  if (!Array.isArray(quarters) || quarters.length < 3) return null;
  const margins = quarters
    .map((q) => ratio(q.grossProfit, q.revenue))
    .filter((m) => m !== null);
  if (margins.length < 3) return null;

  let declines = 0;
  for (let i = 1; i < margins.length; i++) {
    if (margins[i] < margins[i - 1]) declines++;
  }
  return {
    quarters: margins.length,
    changeBps: Math.round((margins[margins.length - 1] - margins[0]) * 10000),
    consecutiveDeclines: declines,
    margins: margins.map((m) => Number(fixedDecimal((m * 100), 1)))
  };
}

/** Consecutive most-recent fiscal years with a dividend paid. */
function dividendStreak(annual) {
  if (!Array.isArray(annual) || !annual.length) return null;
  let streak = 0;
  for (let i = annual.length - 1; i >= 0; i--) {
    const paid = num(annual[i].dividendsPaid);
    if (paid === null) break;
    if (paid > 0) streak++;
    else break;
  }
  return streak;
}

// =====================================================================
// 6. Pillar scoring
// =====================================================================

/**
 * Each sub-score is a band lookup that can return `null` for "not measurable".
 * `bands` is ordered best-first as [threshold, points]; the value must be at
 * or above the threshold to earn those points.
 */
function band(value, bands, max) {
  if (value === null || value === undefined) {
    return { points: null, max, available: false };
  }
  for (const [threshold, points] of bands) {
    if (value >= threshold) return { points, max, available: true };
  }
  return { points: 0, max, available: true };
}

const fixed = (points, max) => ({ points, max, available: true });
const unavailable = (max) => ({ points: null, max, available: false });

function scorePillars(m) {
  const pillars = [];

  // --- Pillar 1: financial health and solvency -------------------------
  // A bank has no working-capital cycle, no EBITDA and no gross profit. Those
  // items are not *missing* for a lender, they are inapplicable — so they are
  // left out of the scorecard entirely rather than counted as unmeasured,
  // which would otherwise drag every financial below the coverage floor.
  const p1 = [];
  if (m.isFinancial) {
    p1.push({
      // The plain-language form of the regulatory leverage ratio, and the
      // right solvency question to ask of a lender.
      name: 'Equity to assets',
      ...band(m.equityToAssets === null ? null : m.equityToAssets * 100,
              [[10, 5], [8, 4], [6, 2.5]], 5)
    });
  } else {
    p1.push({ name: 'Altman Z-Score', ...band(m.altmanZ, [[3.0, 5], [1.8, 3]], 5) });
    p1.push({
      name: 'Net debt / EBITDA',
      ...(m.netCash !== null && m.netCash > 0
        ? fixed(5, 5)
        : band(m.netDebtToEbitda === null ? null : -m.netDebtToEbitda,
               [[-1.5, 4], [-3.0, 2]], 5))
    });
    p1.push({
      name: 'Interest coverage',
      ...(m.interestCoverageUnburdened
        ? fixed(5, 5)
        : band(m.interestCoverage, [[8.0, 5], [4.0, 3], [1.5, 1]], 5))
    });
    p1.push({
      name: 'Current & quick ratio',
      ...(m.currentRatio === null
        ? unavailable(5)
        : m.currentRatio >= 1.5 && (m.quickRatio === null || m.quickRatio >= 1.0)
          ? fixed(5, 5)
          : band(m.currentRatio, [[1.5, 4], [1.0, 3]], 5))
    });
  }
  pillars.push({ name: 'Financial Health & Solvency', items: p1 });

  // --- Pillar 2: profitability and moat quality ------------------------
  const p2 = [];
  p2.push({
    name: 'Piotroski F-Score',
    ...band(m.piotroski?.normalised ?? null, [[8, 5], [6, 3.5], [4, 2]], 5)
  });
  if (m.isFinancial) {
    // Invested capital is not a meaningful denominator for a bank; return on
    // equity is the measure the industry and its investors actually use.
    p2.push({
      name: 'Return on equity',
      ...band(m.roe === null ? null : m.roe * 100, [[15, 5], [10, 3.5], [6, 2]], 5)
    });
  } else {
    p2.push({ name: 'Return on invested capital', ...band(m.roic, [[15, 5], [10, 3.5], [5, 2]], 5) });
    p2.push({
      // The spec scores the trend, not the level: a 25% margin compressing from
      // 40% is a different business from one expanding towards 25%.
      name: 'Operating margin trend',
      ...band(m.operatingMarginChangeBps, [[100, 5], [-50, 3.5], [-200, 1.5]], 5)
    });
  }
  p2.push({
    name: 'Free cash flow conversion',
    ...band(m.fcfConversion === null ? null : m.fcfConversion * 100,
            [[100, 5], [80, 3.5], [50, 2]], 5)
  });
  pillars.push({ name: 'Profitability & Moat Quality', items: p2 });

  // --- Pillar 3: valuation and margin of safety ------------------------
  const p3 = [];
  p3.push({
    name: 'Forward P/E vs. own history',
    ...(m.peVsHistoryPct === null || m.peVsHistoryPct === undefined
      ? band(m.forwardPE === null ? null : -m.forwardPE, [[-18, 5], [-26, 3.5], [-35, 2]], 5)
      : band(-m.peVsHistoryPct, [[15, 5], [-10, 3.5], [-25, 2]], 5))
  });
  p3.push({
    // A negative PEG means earnings are shrinking; that is a growth signal,
    // not a cheapness signal, so it is excluded rather than scored as cheap.
    name: 'PEG ratio',
    ...(m.pegRatio === null || m.pegRatio <= 0
      ? unavailable(5)
      : band(-m.pegRatio, [[-1.0, 5], [-1.8, 3.5], [-2.5, 2]], 5))
  });
  p3.push({
    name: 'EV / free cash flow yield',
    ...band(m.evToFcfYield === null ? null : m.evToFcfYield * 100,
            [[6, 5], [4, 3.5], [2, 2]], 5)
  });
  p3.push({
    name: 'Discount to DCF fair value',
    ...band(m.dcfDiscountPct, [[20, 5], [-10, 3], [-20, 1]], 5)
  });
  pillars.push({ name: 'Valuation & Margin of Safety', items: p3 });

  // --- Pillar 4: growth and operating leverage -------------------------
  const p4 = [];
  p4.push({
    name: 'Revenue CAGR',
    ...band(m.revenueCAGR === null ? null : m.revenueCAGR * 100, [[15, 5], [8, 3.5], [3, 2]], 5)
  });
  p4.push({
    name: 'Diluted EPS CAGR',
    ...band(m.epsCAGR === null ? null : m.epsCAGR * 100, [[20, 5], [10, 3.5], [0, 1.5]], 5)
  });
  if (!m.isFinancial) {
    // Free cash flow and gross margin are not value drivers for a lender —
    // deposit and loan flows dominate both — so neither is scored.
    p4.push({
      name: 'FCF per share CAGR',
      ...band(m.fcfPerShareCAGR === null ? null : m.fcfPerShareCAGR * 100,
              [[15, 5], [5, 3.5], [0, 1.5]], 5)
    });
    p4.push({
      name: 'Gross margin trajectory',
      ...(m.quarterlyGrossMarginTrend
        ? band(m.quarterlyGrossMarginTrend.changeBps, [[0, 5], [-100, 3.5], [-300, 1.5]], 5)
        : band(m.grossMarginChangeBps, [[0, 5], [-100, 3.5], [-300, 1.5]], 5))
    });
  }
  pillars.push({ name: 'Growth & Operating Leverage', items: p4 });

  // --- Pillar 5: capital allocation ------------------------------------
  const p5 = [];
  p5.push({
    name: 'Buybacks vs. dilution',
    // Annualised where a filing gap makes the change span more than one year,
    // so a two-year buyback is not scored as if it happened in twelve months.
    ...band(m.shareChangeAnnualisedPct === null ? null : -m.shareChangeAnnualisedPct,
            [[2, 7], [-0.5, 5], [-2, 2]], 7)
  });

  const isPayer = m.dividendYield !== null && m.dividendYield > 0;
  if (isPayer) {
    const covered = m.dividendPayoutOnFcf !== null && m.dividendPayoutOnFcf < 0.6;
    const longStreak = (m.dividendStreakYears ?? 0) >= 5;
    p5.push({
      name: 'Dividend safety & coverage',
      ...(m.dividendPayoutOnFcf === null
        ? unavailable(7)
        : fixed(covered && longStreak ? 7 : covered ? 5.5 : m.dividendPayoutOnFcf < 0.9 ? 3 : 1, 7))
    });
  } else {
    p5.push({
      name: 'Reinvestment quality',
      ...band(m.roic, [[15, 7], [10, 5], [5, 3]], 7)
    });
  }

  p5.push({
    // Scored against the sector when enough peers are cached, because a
    // grocer and a software company are not comparable on turnover.
    name: 'Asset turnover efficiency',
    ...(m.sectorMedianAssetTurnover
      ? band(
          m.assetTurnover === null
            ? null
            : m.assetTurnover / m.sectorMedianAssetTurnover,
          [[1.25, 6], [0.9, 4.5], [0.6, 3]],
          6
        )
      : band(m.assetTurnover, [[0.8, 6], [0.4, 4]], 6))
  });
  pillars.push({ name: 'Capital Allocation & Returns', items: p5 });

  return pillars;
}

// =====================================================================
// 7. Twelve-point checklist
// =====================================================================

const NA = { status: 'na', value: 'Not reported' };

function buildChecklist(m, fmt) {
  const pct = (v, dp = 1) => (v === null ? null : `${fixedDecimal((v * 100), dp)}%`);

  const item = (id, name, category, explanation, body) => ({
    id, name, category, explanation, ...(body || NA)
  });

  return [
    item(1, 'Altman Z-Score', 'Solvency',
      'Probability of financial distress within two years, from working capital, retained earnings and asset efficiency. Not defined for banks, insurers or REITs.',
      m.altmanZ === null
        ? (m.isFinancial
            ? { status: 'na', value: 'N/A for financials', benchmark: 'Z ≥ 3.0' }
            : { status: 'na', value: 'Not reported', benchmark: 'Z ≥ 3.0' })
        : {
            value: fixedDecimal(m.altmanZ, 2),
            benchmark: 'Z ≥ 3.0 safe zone',
            status: m.altmanZ >= 3.0 ? 'pass' : m.altmanZ >= 1.8 ? 'watch' : 'fail'
          }),

    item(2, 'Interest Coverage', 'Solvency',
      'Operating profit as a multiple of interest owed. A company with no debt has no interest burden to cover.',
      m.interestCoverageUnburdened
        ? { value: 'No debt burden', benchmark: '> 6.0× EBIT / interest', status: 'pass' }
        : m.interestCoverage === null
          ? { ...NA, benchmark: '> 6.0× EBIT / interest' }
          : {
              value: `${fixedDecimal(m.interestCoverage, 1)}×`,
              benchmark: '> 6.0× EBIT / interest',
              status: m.interestCoverage >= 6 ? 'pass' : m.interestCoverage >= 2.5 ? 'watch' : 'fail'
            }),

    item(3, 'Current Ratio', 'Liquidity',
      'Short-term assets against short-term obligations. Banks do not classify their balance sheets this way.',
      m.currentRatio === null
        ? { status: 'na', value: m.isFinancial ? 'N/A for financials' : 'Not reported', benchmark: '≥ 1.50' }
        : {
            value: fixedDecimal(m.currentRatio, 2) + (m.quickRatio !== null ? ` (quick ${fixedDecimal(m.quickRatio, 2)})` : ''),
            benchmark: '≥ 1.50 current assets / liabilities',
            status: m.currentRatio >= 1.5 ? 'pass' : m.currentRatio >= 1.0 ? 'watch' : 'fail'
          }),

    item(4, 'Debt to Equity', 'Solvency',
      'Leverage against book equity. Negative equity — usually from sustained buybacks — is reported as its own state rather than scored as low leverage.',
      m.negativeEquity
        ? { value: 'Negative book equity', benchmark: '< 0.8× or net cash', status: 'fail' }
        : m.netCash !== null && m.netCash > 0
          ? { value: `Net cash ${fmt(m.netCash)}`, benchmark: '< 0.8× or net cash', status: 'pass' }
          : m.debtToEquity === null
            ? { ...NA, benchmark: '< 0.8× or net cash' }
            : {
                value: `${fixedDecimal(m.debtToEquity, 2)}×`,
                benchmark: '< 0.8× or net cash',
                status: m.debtToEquity < 0.8 ? 'pass' : m.debtToEquity <= 1.8 ? 'watch' : 'fail'
              }),

    item(5, 'Free Cash Flow History', 'Cash Flow',
      'Owner earnings after the capital spending needed to keep the business running, across every filed year.',
      m.fcfReportedYears === 0
        ? { ...NA, benchmark: 'Positive every filed year' }
        : {
            value: `${m.fcfPositiveYears} of ${m.fcfReportedYears} years positive`,
            benchmark: 'Positive every filed year',
            status:
              m.fcfPositiveYears === m.fcfReportedYears ? 'pass'
              : m.fcfReportedYears - m.fcfPositiveYears === 1 ? 'watch'
              : 'fail'
          }),

    item(6, 'Piotroski F-Score', 'Quality',
      'Nine fundamental tests across profitability, leverage and efficiency, six of which compare against the prior filed year.',
      !m.piotroski
        ? { ...NA, benchmark: '≥ 7 of 9' }
        : {
            value: `${m.piotroski.score}/${m.piotroski.testable}` +
              (m.piotroski.testable < 9 ? ` (${m.piotroski.normalised}/9 scaled)` : ''),
            benchmark: '≥ 7 of 9 points',
            status: m.piotroski.normalised >= 7 ? 'pass' : m.piotroski.normalised >= 5 ? 'watch' : 'fail'
          }),

    item(7, 'ROIC vs. Cost of Capital', 'Economic Moat',
      'Return on invested capital against an estimated WACC (CAPM cost of equity from the stock beta, plus its actual cost of debt). A durable moat earns well above its cost of capital.',
      m.roic === null
        ? { ...NA, benchmark: 'ROIC ≥ WACC + 5 pts' }
        : m.wacc === null
          ? {
              value: `${fixedDecimal(m.roic, 1)}% ROIC`,
              benchmark: 'ROIC ≥ 15%',
              status: m.roic >= 15 ? 'pass' : m.roic >= 9 ? 'watch' : 'fail'
            }
          : {
              value: `${fixedDecimal(m.roic, 1)}% vs ${fixedDecimal(m.wacc, 1)}% WACC`,
              benchmark: 'ROIC ≥ WACC + 5 pts',
              status: m.roicSpread >= 5 ? 'pass' : m.roicSpread >= 0 ? 'watch' : 'fail'
            }),

    item(8, 'Gross Margin Consistency', 'Pricing Power',
      'Direction of gross margin, which is where pricing power shows up first. Measured across filed quarters where available, otherwise year on year.',
      (() => {
        const t = m.quarterlyGrossMarginTrend;
        if (t) {
          return {
            value: `${t.changeBps >= 0 ? '+' : ''}${t.changeBps} bps over ${t.quarters} quarters`,
            benchmark: 'Expanding or steady',
            status: t.changeBps >= 0 ? 'pass' : t.changeBps >= -100 ? 'watch' : 'fail'
          };
        }
        if (m.grossMarginChangeBps === null) return { ...NA, benchmark: 'Expanding or steady' };
        return {
          value: `${m.grossMarginChangeBps >= 0 ? '+' : ''}${m.grossMarginChangeBps} bps YoY` +
            (m.grossMargin !== null ? ` (now ${pct(m.grossMargin)})` : ''),
          benchmark: 'Expanding or steady',
          status: m.grossMarginChangeBps >= 0 ? 'pass' : m.grossMarginChangeBps >= -100 ? 'watch' : 'fail'
        };
      })()),

    item(9, 'Share Dilution & Buybacks', 'Capital Return',
      'Change in the diluted share count. Buybacks lift per-share value; stock compensation quietly erodes it.',
      m.shareChangeYoY === null
        ? { ...NA, benchmark: 'Shrinking or < 0.5% a year' }
        : {
            value: `${m.shareChangeYoY <= 0 ? '' : '+'}${fixedDecimal((m.shareChangeYoY * 100), 1)}%` +
              (m.shareChangeYoY < 0 ? ' (buybacks)' : ' dilution') +
              // Say so when a filing gap means this is not a one-year change.
              (m.shareChangeIsAnnual === false && m.shareChangeYears
                ? ` over ${m.shareChangeYears} years`
                : ''),
            benchmark: 'Shrinking or < 0.5% a year',
            status: m.shareChangeAnnualisedPct <= 0.5 ? 'pass'
              : m.shareChangeAnnualisedPct <= 2.5 ? 'watch' : 'fail'
          }),

    item(10, 'FCF / Net Income Quality', 'Earnings Quality',
      'How much reported profit arrives as cash. A persistent gap points to aggressive accrual accounting.',
      m.fcfConversion === null
        ? { ...NA, benchmark: '> 90% conversion' }
        : {
            value: `${fixedDecimal((m.fcfConversion * 100), 0)}% conversion`,
            benchmark: '> 90% conversion',
            status: m.fcfConversion >= 0.9 ? 'pass' : m.fcfConversion >= 0.6 ? 'watch' : 'fail'
          }),

    item(11, 'Valuation PEG Ratio', 'Valuation',
      'Price/earnings against expected growth. Undefined when growth is negative — a shrinking business is not cheap, it is shrinking.',
      m.pegRatio === null
        ? { ...NA, benchmark: 'PEG ≤ 1.50' }
        : m.pegRatio <= 0
          ? { status: 'na', value: 'N/A — negative growth', benchmark: 'PEG ≤ 1.50' }
          : {
              value: `${fixedDecimal(m.pegRatio, 2)}×`,
              benchmark: 'PEG ≤ 1.50',
              status: m.pegRatio <= 1.5 ? 'pass' : m.pegRatio <= 2.2 ? 'watch' : 'fail'
            }),

    item(12, 'Revenue Growth', 'Growth',
      'Compound revenue growth across the filed years.',
      m.revenueCAGR === null
        ? { ...NA, benchmark: '> 8% CAGR' }
        : {
            value: `${m.revenueCAGR >= 0 ? '+' : ''}${fixedDecimal((m.revenueCAGR * 100), 1)}% CAGR` +
              (m.cagrYears ? ` (${m.cagrYears}Y)` : ''),
            benchmark: '> 8% CAGR',
            status: m.revenueCAGR >= 0.08 ? 'pass' : m.revenueCAGR >= 0.02 ? 'watch' : 'fail'
          })
  ];
}

// =====================================================================
// 8. Catalysts and risk flags
// =====================================================================

function buildInsights(m, fmt) {
  const catalysts = [];
  const risks = [];

  if (m.netCash !== null && m.netCash > 0 && m.cash !== null && m.totalDebt !== null && !m.isFinancial) {
    catalysts.push({
      icon: '💎',
      title: 'Fortress balance sheet',
      text: `Cash and short-term investments of ${fmt(m.cash)} exceed total debt of ${fmt(m.totalDebt)}, leaving ${fmt(m.netCash)} net cash.`
    });
  }
  if (m.roic !== null && m.roic >= 18) {
    catalysts.push({
      icon: '🚀',
      title: 'Elite capital efficiency',
      text: `ROIC of ${fixedDecimal(m.roic, 1)}%${m.wacc !== null ? `, ${fixedDecimal((m.roic - m.wacc), 1)} points above its estimated ${fixedDecimal(m.wacc, 1)}% cost of capital` : ''}.`
    });
  }
  if (m.fcfConversion !== null && m.fcfConversion >= 1) {
    catalysts.push({
      icon: '💰',
      title: 'Earnings arrive as cash',
      text: `Free cash flow is ${fixedDecimal((m.fcfConversion * 100), 0)}% of reported net income.`
    });
  }
  if (m.grossMargin !== null && m.grossMargin >= 0.6) {
    catalysts.push({
      icon: '⚡',
      title: 'Pricing power',
      text: `Gross margin of ${fixedDecimal((m.grossMargin * 100), 1)}% absorbs input-cost inflation without repricing.`
    });
  }
  if (m.shareChangeYoY !== null && m.shareChangeYoY < -0.01) {
    const span = m.shareChangeIsAnnual === false && m.shareChangeYears
      ? `over ${m.shareChangeYears} filed years`
      : 'year on year';
    catalysts.push({
      icon: '📈',
      title: 'Accretive buybacks',
      text: `Diluted share count fell ${fixedDecimal(Math.abs(m.shareChangeYoY * 100), 1)}% ${span}.`
    });
  }
  if (m.operatingMarginChangeBps !== null && m.operatingMarginChangeBps >= 150) {
    catalysts.push({
      icon: '📊',
      title: 'Operating leverage',
      text: `Operating margin expanded ${m.operatingMarginChangeBps} bps year on year.`
    });
  }

  if (m.negativeEquity) {
    risks.push({
      icon: '⚠️',
      title: 'Negative book equity',
      text: 'Liabilities exceed assets on a book basis. Common after sustained buybacks, but it removes the equity cushion and makes leverage ratios undefined.'
    });
  }
  if (m.netDebtToEbitda !== null && m.netDebtToEbitda > 3) {
    risks.push({
      icon: '⚠️',
      title: 'Elevated leverage',
      text: `Net debt is ${fixedDecimal(m.netDebtToEbitda, 1)}× EBITDA, which limits flexibility if rates stay high.`
    });
  }
  if (m.shareChangeAnnualisedPct !== null && m.shareChangeAnnualisedPct > 2) {
    risks.push({
      icon: '⚠️',
      title: 'Shareholder dilution',
      text: `Diluted share count rose ${fixedDecimal(m.shareChangeAnnualisedPct, 1)}% a year.`
    });
  }
  if (m.forwardPE !== null && m.forwardPE > 40) {
    risks.push({
      icon: '⚠️',
      title: 'Demanding valuation',
      text: `A forward P/E of ${fixedDecimal(m.forwardPE, 1)}× leaves little room for execution error.`
    });
  }
  if (m.altmanZ !== null && m.altmanZ < 1.8) {
    risks.push({
      icon: '🚨',
      title: 'Altman Z distress zone',
      text: `An Altman Z-Score of ${fixedDecimal(m.altmanZ, 2)} sits in the distress range.`
    });
  }
  if (m.roicSpread !== null && m.roicSpread < 0) {
    risks.push({
      icon: '⚠️',
      title: 'Returns below cost of capital',
      text: `ROIC of ${fixedDecimal(m.roic, 1)}% is under the estimated ${fixedDecimal(m.wacc, 1)}% WACC, so growth is destroying value.`
    });
  }
  if (m.fcfConversion !== null && m.fcfConversion < 0.6 && m.netIncome !== null && m.netIncome > 0) {
    risks.push({
      icon: '⚠️',
      title: 'Weak cash conversion',
      text: `Only ${fixedDecimal((m.fcfConversion * 100), 0)}% of net income converted to free cash flow.`
    });
  }
  if (m.quarterlyGrossMarginTrend && m.quarterlyGrossMarginTrend.changeBps <= -200) {
    risks.push({
      icon: '⚠️',
      title: 'Margin compression',
      text: `Gross margin fell ${Math.abs(m.quarterlyGrossMarginTrend.changeBps)} bps across the last ${m.quarterlyGrossMarginTrend.quarters} filed quarters.`
    });
  }

  return { catalysts: catalysts.slice(0, 4), risks: risks.slice(0, 4) };
}

// =====================================================================
// 9. Entry point
// =====================================================================

/**
 * Free cash flow base for the projection.
 *
 * A single filed year is a fragile foundation when it is an outlier. Bumble's
 * FY2025 free cash flow was 2.5x the prior year while revenue fell 9.3% — a
 * projection anchored on it compounds a one-off. Where the latest year sits
 * far from the three-year median, the median is used instead and the choice is
 * reported, so nobody has to guess which basis produced the number.
 */
function dcfCashFlowBase(m) {
  const latest = num(m.freeCashFlowLatest) ?? num(m.freeCashFlow);
  const normal = num(m.freeCashFlowNormalised);

  if (latest === null) return { value: null, basis: 'unavailable', latest, normalised: normal };
  if (normal === null || normal <= 0) {
    return { value: latest, basis: 'latest filed year', latest, normalised: normal };
  }

  const ratio = latest / normal;
  if (ratio > 1.35 || ratio < 0.65) {
    return {
      value: normal,
      basis: 'three-year median — the latest filed year is an outlier',
      latest,
      normalised: normal,
      outlierRatio: round(ratio)
    };
  }
  return { value: latest, basis: 'latest filed year', latest, normalised: normal };
}

/**
 * Growth for the projection stage.
 *
 * The median of the filed compound rates, then bounded by what the top line
 * can actually support. Free cash flow growing faster than revenue for five
 * straight years requires continuous margin expansion, and a business whose
 * most recent filed year shrank does not get a growth projection at all — it
 * gets its decline projected. Bumble's blend came out at +18% a year on
 * revenue that had just fallen 9.3%, with negative EBIT and -65% ROIC.
 */
function dcfGrowthRate(m) {
  const rates = [m.revenueCAGR, m.epsCAGR, m.fcfPerShareCAGR].filter(
    (r) => r !== null && r !== undefined
  );

  let base;
  if (!rates.length) {
    base = 0.04;
  } else {
    const sorted = [...rates].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    base = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  const latestChange = num(m.revenueChangeLatest);

  // A shrinking business has its decline projected, floored so that five years
  // of compounding stays inside the plausible.
  if (latestChange !== null && latestChange < 0) {
    return {
      rate: Number(fixedDecimal(Math.max(-0.15, latestChange), 4)),
      basis: 'revenue declined in the latest filed year, so the decline is projected rather than growth',
      unbounded: Number(fixedDecimal(base, 4))
    };
  }

  const ceiling =
    m.revenueCAGR !== null && m.revenueCAGR !== undefined
      ? Math.min(0.2, m.revenueCAGR + 0.05)
      : 0.1;
  const rate = Number(fixedDecimal(Math.min(ceiling, Math.max(0, base)), 4));

  return {
    rate,
    basis:
      rate < base
        ? 'capped at revenue growth plus 5 points — cash flow cannot outgrow the top line indefinitely'
        : 'median of the filed compound growth rates',
    unbounded: Number(fixedDecimal(base, 4))
  };
}

/**
 * Terminal multiple keyed to business quality, not to the share price. The
 * previous implementation derived it from forward P/E, which made the fair
 * value a function of the market price — an expensive stock got a higher
 * multiple and so could never look expensive.
 */
function dcfTerminalMultiple(m) {
  let multiple = 15;
  if (m.roic !== null) {
    if (m.roic >= 25) multiple += 6;
    else if (m.roic >= 15) multiple += 4;
    else if (m.roic >= 10) multiple += 1;
    else if (m.roic < 6) multiple -= 3;
    // Destroying capital outright is a different case from merely low returns.
    if (m.roic < 0) multiple -= 2;
  }
  if (m.grossMargin !== null && m.grossMargin >= 0.6) multiple += 2;
  if (m.netCash !== null && m.netCash > 0) multiple += 1;
  if (m.netDebtToEbitda !== null && m.netDebtToEbitda > 3) multiple -= 2;
  return Math.min(26, Math.max(8, multiple));
}

/**
 * The growth rate that would make the model agree with the market.
 *
 * More useful than the fair value itself when the two disagree sharply: it
 * turns "93.8% undervalued" into "the market is pricing in a 28.5% annual
 * decline", which is a claim the reader can actually assess.
 */
function impliedGrowthRate({ price, fcf0, terminalMultiple, discountRate, cash, debt, shares }) {
  if ([price, fcf0, shares].some((v) => num(v) === null) || fcf0 <= 0 || shares <= 0 || price <= 0) {
    return null;
  }

  const valueAt = (g) => {
    let f = fcf0;
    let cum = 0;
    for (let t = 1; t <= 5; t++) {
      f *= 1 + g;
      cum += f / Math.pow(1 + discountRate, t);
    }
    const ev = cum + (f * terminalMultiple) / Math.pow(1 + discountRate, 5);
    return (ev + (cash ?? 0) - (debt ?? 0)) / shares;
  };

  // Monotonic in g, so a bisection converges quickly.
  let lo = -0.95;
  let hi = 1.0;
  if (valueAt(lo) > price) return null;   // even total collapse cannot justify the price
  if (valueAt(hi) < price) return null;   // even extreme growth cannot justify it
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (valueAt(mid) > price) hi = mid;
    else lo = mid;
  }
  return Number(fixedDecimal(((lo + hi) / 2), 4));
}

export function computeComprehensiveHealth(model = {}) {
  const metrics = deriveMetrics(model);
  const currency = model.reportingCurrency || model.quote?.currency || 'USD';
  const fmt = (v) => formatMoney(v, currency);

  // Optional context supplied by the caller (sector peers, historical P/E).
  metrics.sectorMedianAssetTurnover = model.sectorMedianAssetTurnover ?? null;
  metrics.peVsHistoryPct = model.peVsHistoryPct ?? null;

  // --- DCF -------------------------------------------------------------
  const cashFlowBase = dcfCashFlowBase(metrics);
  const growth = dcfGrowthRate(metrics);
  const terminalMultiple = dcfTerminalMultiple(metrics);

  const dcfInput = {
    trailingFCF: cashFlowBase.value,
    growthRate: growth.rate,
    terminalMultiple,
    discountRate: 0.095,
    cashReserves: metrics.cash ?? 0,
    totalDebt: metrics.totalDebt ?? 0,
    sharesOutstanding: metrics.sharesOutstanding
  };

  // A bank's free cash flow is not owner earnings — deposits and loan books
  // move it around with no relation to value — so the model is not run.
  const dcf = model.isFinancial
    ? { applicable: false, reason: 'not-meaningful-for-financials', fairValuePerShare: null }
    : calculateDCFFairValue(dcfInput);

  let dcfDiscountPct = null;
  let premiumToFairValuePct = null;
  if (dcf.applicable && dcf.fairValuePerShare !== null && metrics.price !== null) {
    if (dcf.fairValuePerShare > 0) {
      dcfDiscountPct = round(
        ((dcf.fairValuePerShare - metrics.price) / dcf.fairValuePerShare) * 100, 1
      );
      // (P − FV)/FV reads naturally when the stock trades above fair value;
      // the margin-of-safety form goes to −188% and stops meaning anything.
      premiumToFairValuePct = round(
        ((metrics.price - dcf.fairValuePerShare) / dcf.fairValuePerShare) * 100, 1
      );
    } else {
      // Discounted cash flows do not cover the debt: no equity value at all.
      dcfDiscountPct = -100;
    }
  }
  metrics.dcfDiscountPct = dcfDiscountPct;

  // What the market would have to believe. When the model and the market
  // disagree by a wide factor, this is the more informative number of the two.
  const impliedGrowth = dcf.applicable
    ? impliedGrowthRate({
        price: metrics.price,
        fcf0: cashFlowBase.value,
        terminalMultiple,
        discountRate: 0.095,
        cash: metrics.cash,
        debt: metrics.totalDebt,
        shares: metrics.sharesOutstanding
      })
    : null;

  // A fair value several multiples away from the traded price is far more
  // likely to mean the assumptions are wrong, or that the market is pricing
  // something the filings do not show, than that free money is on the table.
  const divergenceFactor =
    dcf.applicable && dcf.fairValuePerShare > 0 && metrics.price > 0
      ? round(dcf.fairValuePerShare / metrics.price)
      : null;
  const divergenceWarning = divergenceFactor !== null && (divergenceFactor >= 3 || divergenceFactor <= 0.33);

  // --- Pillars ---------------------------------------------------------
  const rawPillars = scorePillars(metrics);

  let earned = 0;
  let possible = 0;
  let availableItems = 0;
  let totalItems = 0;

  const pillars = rawPillars.map((p) => {
    let pEarned = 0;
    let pPossible = 0;
    for (const it of p.items) {
      totalItems++;
      if (!it.available) continue;
      availableItems++;
      pEarned += it.points;
      pPossible += it.max;
    }
    earned += pEarned;
    possible += pPossible;

    // Rescale to 20 over what was measurable, so a missing line item neither
    // credits nor penalises the company — it just does not vote.
    const score = pPossible > 0 ? Number(fixedDecimal(((pEarned / pPossible) * 20), 1)) : null;
    return {
      name: p.name,
      score,
      max: 20,
      pct: score === null ? null : Math.round((score / 20) * 100),
      measured: p.items.filter((i) => i.available).length,
      of: p.items.length,
      items: p.items.map((i) => ({
        name: i.name,
        points: i.points,
        max: i.max,
        available: i.available
      }))
    };
  });

  const coveragePct = totalItems ? availableItems / totalItems : 0;
  const sufficient = coveragePct >= MIN_COVERAGE && possible > 0;

  const healthScore = sufficient
    ? Math.min(100, Math.max(0, Math.round((earned / possible) * 100)))
    : null;

  let healthLabel, healthGrade, healthTier;
  if (healthScore === null) {
    healthLabel = 'Not enough filed data to score';
    healthGrade = 'INSUFFICIENT';
    healthTier = 'insufficient';
  } else if (healthScore >= 85) {
    healthLabel = 'Pristine financial health';
    healthGrade = 'PRISTINE';
    healthTier = 'pristine';
  } else if (healthScore >= 70) {
    healthLabel = 'Solid moat and financials';
    healthGrade = 'GOOD';
    healthTier = 'good';
  } else if (healthScore >= 50) {
    healthLabel = 'Mixed — watch the flagged items';
    healthGrade = 'MODERATE';
    healthTier = 'moderate';
  } else {
    healthLabel = 'High leverage or distress risk';
    healthGrade = 'RISK';
    healthTier = 'risk';
  }

  // --- Checklist and insights -----------------------------------------
  const checklist = buildChecklist(metrics, fmt);
  const { catalysts, risks } = buildInsights(metrics, fmt);

  const counts = { pass: 0, watch: 0, fail: 0, na: 0 };
  for (const c of checklist) counts[c.status]++;
  const scored = counts.pass + counts.watch + counts.fail;

  return {
    healthScore,
    healthLabel,
    healthGrade,
    healthTier,

    altmanZ: metrics.altmanZ,
    piotroskiScore: metrics.piotroski ? metrics.piotroski.normalised : null,
    piotroskiDetails: metrics.piotroski ? metrics.piotroski.details : [],
    roicPct: metrics.roic,
    fcfConversionPct:
      metrics.fcfConversion === null ? null : Math.round(metrics.fcfConversion * 100),
    netCashB: metrics.netCashB,

    metrics,
    coverage: {
      measured: availableItems,
      total: totalItems,
      pct: Math.round(coveragePct * 100),
      sufficient
    },

    pillars,
    checklistSummary: {
      passCount: counts.pass,
      watchCount: counts.watch,
      failCount: counts.fail,
      naCount: counts.na,
      total: checklist.length,
      scored,
      passPct: scored ? Math.round((counts.pass / scored) * 100) : null
    },
    checklist,
    catalysts,
    risks,

    dcf: {
      applicable: dcf.applicable,
      reason: dcf.reason || null,
      fairValue: dcf.fairValuePerShare,
      currentPrice: metrics.price,
      marginOfSafetyPct: dcfDiscountPct,
      premiumToFairValuePct,
      cumulativePV: dcf.cumulativePV ?? null,
      terminalValue: dcf.terminalValue ?? null,
      pvTerminalValue: dcf.pvTerminalValue ?? null,
      equityValue: dcf.equityValue ?? null,
      cashReserves: metrics.cash,
      totalDebt: metrics.totalDebt,
      sharesOutstanding: metrics.sharesOutstanding,
      assumptions: {
        growthRate: dcfInput.growthRate,
        growthBasis: growth.basis,
        growthBeforeBounding: growth.unbounded,
        terminalMultiple: dcfInput.terminalMultiple,
        discountRate: dcfInput.discountRate,
        cashFlowBase: cashFlowBase.value,
        cashFlowBasis: cashFlowBase.basis,
        latestFiledCashFlow: cashFlowBase.latest,
        normalisedCashFlow: cashFlowBase.normalised
      },
      impliedGrowthRate: impliedGrowth,
      divergenceFactor,
      divergenceWarning,
      pvCashFlows: dcf.pvCashFlows || []
    }
  };
}

// =====================================================================
// Formatting helper shared with the API layer
// =====================================================================

const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', GBp: 'p', JPY: '¥', CHF: 'CHF ',
  CAD: 'C$', AUD: 'A$', RON: 'RON ', SEK: 'SEK ', DKK: 'DKK ',
  NOK: 'NOK ', HKD: 'HK$', CNY: '¥', INR: '₹', BRL: 'R$'
};

export function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] ?? `${code || ''} `;
}

export function formatMoney(value, currency = 'USD') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sym = currencySymbol(currency);
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${sym}${fixedDecimal((abs / 1e12), 2)}T`;
  if (abs >= 1e9) return `${sign}${sym}${fixedDecimal((abs / 1e9), 2)}B`;
  if (abs >= 1e6) return `${sign}${sym}${fixedDecimal((abs / 1e6), 1)}M`;
  return `${sign}${sym}${fixedDecimal(abs, 2)}`;
}
