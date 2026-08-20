/**
 * Regression tests for the scoring engine.
 *
 * Every assertion here corresponds to a defect found in the audit of the
 * original engine. The point is not coverage for its own sake — it is that
 * each of these produced a confident, wrong number in production, and none of
 * them is the kind of bug that shows up by looking at the screen.
 *
 * Run with:  npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeComprehensiveHealth,
  calculateAltmanZScore,
  calculatePiotroskiFScore,
  calculateROIC,
  calculateDCFFairValue,
  estimateWACC
} from './scoring.js';

// ---------------------------------------------------------------- fixtures

/** A healthy, fully-reporting industrial. */
function healthyModel(overrides = {}) {
  const latest = {
    asOfDate: '2025-12-31',
    revenue: 100e9, grossProfit: 60e9, operatingIncome: 30e9, ebit: 30e9,
    ebitda: 36e9, interestExpense: 0.5e9, netIncome: 24e9,
    pretaxIncome: 30e9, taxProvision: 6e9, dilutedEPS: 6, dilutedShares: 4e9,
    totalAssets: 120e9, totalLiabilities: 50e9, equity: 70e9,
    currentAssets: 40e9, currentLiabilities: 20e9, inventory: 5e9,
    retainedEarnings: 45e9, cash: 25e9, shortTermInvestments: 5e9,
    totalDebt: 12e9, longTermDebt: 10e9, currentDebt: 2e9,
    freeCashFlow: 26e9, operatingCashFlow: 32e9, capitalExpenditure: 6e9,
    dividendsPaid: 6e9, buybacks: -4e9
  };
  const prior = {
    ...latest,
    asOfDate: '2024-12-31',
    revenue: 88e9, grossProfit: 51e9, operatingIncome: 25e9, ebit: 25e9,
    netIncome: 20e9, dilutedShares: 4.1e9, dilutedEPS: 4.9,
    totalAssets: 112e9, equity: 63e9, freeCashFlow: 22e9,
    currentAssets: 36e9, currentLiabilities: 19e9, longTermDebt: 11e9
  };

  return {
    quote: {
      price: 150, marketCap: 600e9, sharesOutstanding: 4e9, currency: 'USD',
      trailingPE: 25, forwardPE: 22, pegRatio: 1.4, beta: 1.0,
      dividendYield: 0.01, payoutRatio: 0.25, sector: 'Technology'
    },
    latest, prior,
    annual: [prior, latest],
    quarterly: [],
    latestReported: {},
    isFinancial: false,
    reportingCurrency: 'USD',
    history: {
      periods: ['2024-12-31', '2025-12-31'],
      years: [2024, 2025],
      revenue: [88, 100],
      freeCashFlow: [22, 26],
      grossMarginPct: [58, 60],
      operatingMarginPct: [28.4, 30],
      sharesOutstanding: [4.1, 4.0],
      revenueCAGR: 0.136, epsCAGR: 0.22, fcfPerShareCAGR: 0.21,
      shareChangeYoY: -0.024, cagrYears: 1
    },
    ...overrides
  };
}

// =====================================================================
// The headline defect: empty input scored 86/100 "PRISTINE"
// =====================================================================

test('an empty input produces no score at all', () => {
  const r = computeComprehensiveHealth({});
  assert.equal(r.healthScore, null, 'a company with no data must not receive a score');
  assert.equal(r.healthTier, 'insufficient');
  assert.equal(r.coverage.sufficient, false);
  assert.equal(r.checklistSummary.naCount, 12, 'every check should read as not reported');
  assert.equal(r.checklistSummary.passCount, 0, 'nothing can pass without data');
});

test('missing debt data is not treated as a debt-free balance sheet', () => {
  const r = computeComprehensiveHealth({});
  const coverage = r.checklist.find((c) => c.id === 2);
  assert.equal(coverage.status, 'na',
    'absent interest data must not read as "no debt burden"');
});

test('a partially reporting company scores only on what is filed', () => {
  const model = healthyModel();
  // Strip the cash-flow statement entirely.
  model.latest = { ...model.latest, freeCashFlow: null, operatingCashFlow: null };
  model.prior = { ...model.prior, freeCashFlow: null, operatingCashFlow: null };
  model.history = { ...model.history, freeCashFlow: [null, null], fcfPerShareCAGR: null };

  const r = computeComprehensiveHealth(model);
  assert.ok(r.coverage.pct < 100, 'coverage must drop when a statement is missing');
  assert.equal(r.checklist.find((c) => c.id === 10).status, 'na');
  assert.equal(r.dcf.applicable, false, 'no cash flow means no discounted cash flow model');
});

// =====================================================================
// Altman Z
// =====================================================================

test('Altman Z matches a hand-computed value', () => {
  // Apple FY2025 as filed, checked by hand during the audit: Z = 11.94.
  const z = calculateAltmanZScore({
    workingCapital: 148.0e9 - 165.6e9,
    retainedEarnings: -14.3e9,
    ebit: 133.1e9,
    marketCap: 4606e9,
    totalLiabilities: 285.5e9,
    totalRevenue: 416.2e9,
    totalAssets: 359.2e9
  });
  assert.ok(Math.abs(z - 11.94) < 0.05, `expected ~11.94, got ${z}`);
});

test('Altman Z is unavailable rather than partial when a term is missing', () => {
  assert.equal(
    calculateAltmanZScore({
      workingCapital: 1e9, retainedEarnings: null, ebit: 1e9,
      marketCap: 1e9, totalLiabilities: 1e9, totalRevenue: 1e9, totalAssets: 1e9
    }),
    null,
    'a missing term must not be silently treated as zero'
  );
});

test('Altman Z is not reported for banks and insurers', () => {
  const r = computeComprehensiveHealth(healthyModel({ isFinancial: true }));
  assert.equal(r.altmanZ, null);
  const check = r.checklist.find((c) => c.id === 1);
  assert.equal(check.status, 'na');
  assert.match(check.value, /financials/i);
});

// =====================================================================
// Piotroski
// =====================================================================

test('Piotroski is unavailable without a filed prior year', () => {
  assert.equal(calculatePiotroskiFScore({ netIncome: 1e9 }, null), null);
  const r = computeComprehensiveHealth(healthyModel({ prior: null, annual: [] }));
  assert.equal(r.piotroskiScore, null);
});

test('Piotroski year-on-year tests can actually fail', () => {
  // The original engine synthesised a prior year scaled to be uniformly worse,
  // so all six comparison tests passed for every company ever scored.
  const current = {
    // Operating cash flow below net income too: a loss-maker can still pass
    // the cash-quality signal (OCF > NI), which is correct Piotroski
    // behaviour, so the fixture has to be worse on that axis as well.
    netIncome: -5e9, operatingCashFlow: -7e9, totalAssets: 100e9,
    longTermDebt: 60e9, currentAssets: 10e9, currentLiabilities: 25e9,
    dilutedShares: 11e9, grossProfit: 5e9, revenue: 50e9
  };
  const prior = {
    netIncome: 8e9, operatingCashFlow: 9e9, totalAssets: 95e9,
    longTermDebt: 40e9, currentAssets: 20e9, currentLiabilities: 15e9,
    dilutedShares: 10e9, grossProfit: 15e9, revenue: 55e9
  };

  const f = calculatePiotroskiFScore(current, prior);
  assert.equal(f.score, 0, `a company worse on every axis must score 0, got ${f.score}`);
  assert.equal(f.testable, 9);
});

test('Piotroski scales when a filer omits a line item', () => {
  const base = {
    netIncome: 5e9, operatingCashFlow: 6e9, totalAssets: 100e9,
    longTermDebt: 10e9, dilutedShares: 10e9, revenue: 50e9,
    currentAssets: null, currentLiabilities: null, grossProfit: null
  };
  const f = calculatePiotroskiFScore(base, { ...base, netIncome: 4e9, totalAssets: 98e9 });
  assert.ok(f.testable < 9, 'untestable signals should be excluded');
  assert.ok(f.normalised <= 9);
});

// =====================================================================
// ROIC and WACC
// =====================================================================

test('ROIC is undefined, not astronomical, when invested capital is not positive', () => {
  // AutoZone, Home Depot and McDonald's all carry negative book equity. The
  // original clamp turned this into a 395,000,000,000% return that passed the
  // moat check and produced an "Elite capital efficiency" catalyst card.
  assert.equal(
    calculateROIC({ ebit: 5e9, taxRate: 0.21, totalDebt: 1.3e9, equity: -1e9, cash: 1.2e9 }),
    null
  );
});

test('ROIC computes normally on a positive capital base', () => {
  const roic = calculateROIC({ ebit: 30e9, taxRate: 0.2, totalDebt: 12e9, equity: 70e9, cash: 30e9 });
  // 30 × 0.8 = 24 NOPAT over 52 invested = 46.15%
  assert.ok(Math.abs(roic - 46.15) < 0.1, `expected ~46.15, got ${roic}`);
});

test('WACC lands in a defensible range and responds to beta', () => {
  const low = estimateWACC({ beta: 0.5, marketCap: 100e9, totalDebt: 10e9, interestExpense: 0.4e9, taxRate: 0.21 });
  const high = estimateWACC({ beta: 1.8, marketCap: 100e9, totalDebt: 10e9, interestExpense: 0.4e9, taxRate: 0.21 });
  assert.ok(low > 3 && low < 12, `low-beta WACC out of range: ${low}`);
  assert.ok(high > low, 'a higher beta must raise the cost of capital');
  assert.ok(high < 20, `high-beta WACC out of range: ${high}`);
});

// =====================================================================
// DCF
// =====================================================================

test('a cash-burning company gets no fair value instead of a fabricated one', () => {
  const dcf = calculateDCFFairValue({ trailingFCF: -8e8, sharesOutstanding: 1e8 });
  assert.equal(dcf.applicable, false);
  assert.equal(dcf.reason, 'negative-fcf');
  assert.equal(dcf.fairValuePerShare, null);
});

test('negative intrinsic equity is reported, not clamped to zero', () => {
  const dcf = calculateDCFFairValue({
    trailingFCF: 1e8, growthRate: 0, terminalMultiple: 10,
    discountRate: 0.095, cashReserves: 0, totalDebt: 50e9, sharesOutstanding: 1e9
  });
  assert.equal(dcf.applicable, true);
  assert.ok(dcf.fairValuePerShare < 0,
    'a debt load exceeding the discounted flows must show as negative, not 0');
});

test('a company with negative fair value does not earn valuation credit', () => {
  // The original engine clamped fair value to 0, produced a 0% discount, and
  // awarded 3.5 of 5 points for being "at fair value".
  const model = healthyModel();
  model.latest = { ...model.latest, totalDebt: 900e9, freeCashFlow: 1e8 };
  const r = computeComprehensiveHealth(model);
  const valuation = r.pillars.find((p) => p.name.startsWith('Valuation'));
  const dcfItem = valuation.items.find((i) => i.name.startsWith('Discount'));
  assert.equal(dcfItem.points, 0, 'no equity value must score zero, not a mid band');
});

test('the terminal multiple does not follow the share price', () => {
  // Deriving it from forward P/E made fair value a function of the market
  // price, so an expensive stock could never look expensive.
  const cheap = computeComprehensiveHealth(healthyModel({
    quote: { ...healthyModel().quote, price: 50, forwardPE: 8, marketCap: 200e9 }
  }));
  const rich = computeComprehensiveHealth(healthyModel({
    quote: { ...healthyModel().quote, price: 500, forwardPE: 80, marketCap: 2000e9 }
  }));
  assert.equal(
    cheap.dcf.assumptions.terminalMultiple,
    rich.dcf.assumptions.terminalMultiple,
    'the same business must get the same terminal multiple at any price'
  );
});

test('the DCF is not run for banks', () => {
  const r = computeComprehensiveHealth(healthyModel({ isFinancial: true }));
  assert.equal(r.dcf.applicable, false);
  assert.equal(r.dcf.reason, 'not-meaningful-for-financials');
});

// =====================================================================
// Derived ratios that previously inverted
// =====================================================================

test('negative book equity fails the leverage check rather than passing it', () => {
  // Previously `equity > 0 ? debt/equity : 0.4` — and 0.4 is inside the pass
  // band, so the worst possible balance sheet read as low leverage.
  const model = healthyModel();
  model.latest = { ...model.latest, equity: -4e9, totalDebt: 9e9, totalLiabilities: 130e9 };
  const r = computeComprehensiveHealth(model);
  const check = r.checklist.find((c) => c.id === 4);
  assert.equal(check.status, 'fail');
  assert.match(check.value, /negative/i);
  assert.equal(r.metrics.debtToEquity, null);
});

test('interest coverage is measured, not assumed', () => {
  const r = computeComprehensiveHealth(healthyModel());
  // 30bn EBIT over 0.5bn interest = 60x
  assert.ok(Math.abs(r.metrics.interestCoverage - 60) < 0.5);
  assert.notEqual(r.metrics.interestCoverage, 25, 'the old engine hardcoded 25x for everyone');
});

test('the current ratio comes from the filings', () => {
  const r = computeComprehensiveHealth(healthyModel());
  assert.equal(r.metrics.currentRatio, 2, '40bn current assets over 20bn liabilities');
  assert.notEqual(r.metrics.currentRatio, 1.5, 'the old engine produced exactly 1.50 for everyone');
});

test('a negative PEG is excluded rather than scored as a watch', () => {
  const model = healthyModel();
  model.quote = { ...model.quote, pegRatio: -3 };
  const r = computeComprehensiveHealth(model);
  const check = r.checklist.find((c) => c.id === 11);
  assert.equal(check.status, 'na');
  assert.match(check.value, /negative growth/i);
});

test('a missing PEG does not default into a passing grade', () => {
  const model = healthyModel();
  model.quote = { ...model.quote, pegRatio: null };
  const r = computeComprehensiveHealth(model);
  assert.equal(r.checklist.find((c) => c.id === 11).status, 'na');
});

test('total liabilities are derived from the accounting identity when absent', () => {
  const model = healthyModel();
  model.latest = { ...model.latest, totalLiabilities: null };
  const r = computeComprehensiveHealth(model);
  assert.equal(r.metrics.totalLiabilities, 120e9 - 70e9);
  assert.equal(r.metrics.totalLiabilitiesDerived, true);
  assert.ok(r.altmanZ !== null, 'Altman should still compute from the identity');
});

// =====================================================================
// Trends: level versus direction
// =====================================================================

test('collapsing gross margin fails the consistency check', () => {
  // The old check scored the absolute level, so a margin falling from 70% to
  // 45% still read "45.0% — PASS · Expanding / Steady".
  const model = healthyModel();
  model.latest = { ...model.latest, grossProfit: 45e9 };   // 45% of 100bn
  model.prior = { ...model.prior, grossProfit: 61.6e9 };   // 70% of 88bn
  const r = computeComprehensiveHealth(model);
  const check = r.checklist.find((c) => c.id === 8);
  assert.equal(check.status, 'fail');
  assert.ok(r.metrics.grossMarginChangeBps < -1000);
});

test('free cash flow history counts every filed year', () => {
  const model = healthyModel();
  model.history = { ...model.history, freeCashFlow: [-2, -1, 3, 5] };
  const r = computeComprehensiveHealth(model);
  const check = r.checklist.find((c) => c.id === 5);
  assert.equal(check.status, 'fail', 'two negative years out of four is a fail');
  assert.match(check.value, /2 of 4/);
});

test('EPS growth and FCF growth are separate measurements', () => {
  // The original engine tested eps3yCAGR in the branch labelled FCF growth,
  // and eps3yCAGR itself was the hardcoded literal 0.12.
  const model = healthyModel();
  model.history = { ...model.history, epsCAGR: 0.30, fcfPerShareCAGR: -0.10 };
  const r = computeComprehensiveHealth(model);
  const growth = r.pillars.find((p) => p.name.startsWith('Growth'));
  const eps = growth.items.find((i) => i.name.includes('EPS'));
  const fcf = growth.items.find((i) => i.name.includes('FCF'));
  assert.equal(eps.points, 5, 'a 30% EPS CAGR should earn full marks');
  assert.equal(fcf.points, 0, 'a shrinking FCF per share should earn none');
});

// =====================================================================
// Composite behaviour
// =====================================================================

test('the composite spans the full range, with no floor', () => {
  const model = healthyModel();
  model.latest = {
    ...model.latest,
    grossProfit: 2e9, operatingIncome: -10e9, ebit: -10e9, ebitda: -6e9,
    netIncome: -12e9, freeCashFlow: -8e9, operatingCashFlow: -5e9,
    interestExpense: 4e9, totalDebt: 90e9, cash: 1e9, shortTermInvestments: 0,
    currentAssets: 10e9, currentLiabilities: 30e9, equity: 2e9,
    retainedEarnings: -30e9, totalAssets: 100e9, totalLiabilities: 98e9,
    pretaxIncome: -14e9, taxProvision: 0
  };
  model.prior = { ...model.prior, netIncome: 5e9, freeCashFlow: 4e9, operatingCashFlow: 6e9 };
  model.history = {
    ...model.history,
    revenueCAGR: -0.2, epsCAGR: null, fcfPerShareCAGR: null,
    shareChangeYoY: 0.09, freeCashFlow: [4, -8]
  };
  model.quote = { ...model.quote, pegRatio: 9, forwardPE: 120, dividendYield: 0 };

  const r = computeComprehensiveHealth(model);
  assert.ok(r.healthScore !== null, 'there is enough data here to score');
  assert.ok(r.healthScore < 25,
    `a distressed company must score low; got ${r.healthScore}`);
  assert.equal(r.healthTier, 'risk');
});

test('a strong company still scores well', () => {
  const r = computeComprehensiveHealth(healthyModel());
  assert.ok(r.healthScore >= 70, `expected a strong score, got ${r.healthScore}`);
  assert.equal(r.coverage.sufficient, true);
});

test('pillar scores never exceed their maximum', () => {
  for (const model of [healthyModel(), healthyModel({ isFinancial: true })]) {
    const r = computeComprehensiveHealth(model);
    for (const p of r.pillars) {
      if (p.score === null) continue;
      assert.ok(p.score >= 0 && p.score <= 20, `${p.name} out of range: ${p.score}`);
    }
    if (r.healthScore !== null) {
      assert.ok(r.healthScore >= 0 && r.healthScore <= 100);
    }
  }
});

test('banks are scored on bank-appropriate measures', () => {
  const model = healthyModel({ isFinancial: true });
  model.latest = { ...model.latest, grossProfit: null, ebit: null, operatingIncome: null,
                   currentAssets: null, currentLiabilities: null, ebitda: null };
  model.prior = { ...model.prior, grossProfit: null, ebit: null, operatingIncome: null,
                  currentAssets: null, currentLiabilities: null };
  const r = computeComprehensiveHealth(model);

  const solvency = r.pillars.find((p) => p.name.startsWith('Financial Health'));
  assert.equal(solvency.items[0].name, 'Equity to assets');
  assert.ok(r.coverage.sufficient,
    'a bank with complete bank data must still be scoreable');
  const profitability = r.pillars.find((p) => p.name.startsWith('Profitability'));
  assert.ok(profitability.items.some((i) => i.name === 'Return on equity'));
});

// =====================================================================
// Presentation
// =====================================================================

test('a negative CAGR is not printed with a plus sign', () => {
  const model = healthyModel();
  model.history = { ...model.history, revenueCAGR: -0.071 };
  const r = computeComprehensiveHealth(model);
  const check = r.checklist.find((c) => c.id === 12);
  assert.ok(!check.value.includes('+-'), `got "${check.value}"`);
  assert.match(check.value, /^-7\.1%/);
});

test('catalysts and risks are not manufactured to fill the cards', () => {
  // The original always emitted at least one of each "for UX balance", so a
  // company with no notable strength was still handed a catalyst.
  const model = healthyModel();
  model.latest = {
    ...model.latest, grossProfit: 20e9, cash: 1e9, shortTermInvestments: 0,
    totalDebt: 20e9, ebit: 8e9, operatingIncome: 8e9, freeCashFlow: 5e9, netIncome: 6e9
  };
  model.history = { ...model.history, shareChangeYoY: 0.001 };
  const r = computeComprehensiveHealth(model);
  assert.ok(Array.isArray(r.catalysts));
  for (const c of r.catalysts) {
    assert.notMatch(c.title, /Established Market Position/,
      'no filler catalyst should be emitted');
  }
});

// =====================================================================
// Defects found by recomputing TAL by hand against the raw Yahoo response
// =====================================================================

test('a multi-year share-count change is annualised, not read as year on year', () => {
  // TAL files no FY2025 diluted share count. Filtering nulls and taking the
  // last two values reported the FY2024-to-FY2026 change as if it were a
  // single year, which both mislabels it and overstates the buyback rate.
  const model = healthyModel();
  model.history = {
    ...model.history,
    shareChangeYoY: -0.0511,
    shareChangeYears: 2,
    shareChangeIsAnnual: false
  };
  const r = computeComprehensiveHealth(model);

  assert.ok(Math.abs(r.metrics.shareChangeAnnualisedPct - -2.59) < 0.05,
    `expected about -2.59% a year, got ${r.metrics.shareChangeAnnualisedPct}`);
  const check = r.checklist.find((c) => c.id === 9);
  assert.match(check.value, /over 2 years/, 'the span must be stated');
});

test('a genuine one-year share change is left alone', () => {
  const model = healthyModel();
  model.history = {
    ...model.history,
    shareChangeYoY: -0.024, shareChangeYears: 1, shareChangeIsAnnual: true
  };
  const r = computeComprehensiveHealth(model);
  assert.ok(Math.abs(r.metrics.shareChangeAnnualisedPct - -2.4) < 0.01);
  assert.doesNotMatch(r.checklist.find((c) => c.id === 9).value, /over \d+ years/);
});

test('an implausibly low beta cannot produce a cost of capital below a bond', () => {
  // Yahoo reports beta 0.15 for TAL — a five-year regression across a
  // structural break. Unclamped CAPM gives a 4.9% cost of equity for a
  // Chinese ADR, which made a +18-point ROIC spread look like a moat.
  const wacc = estimateWACC({
    beta: 0.15, marketCap: 6.9e9, totalDebt: 387e6, interestExpense: 0, taxRate: 0.225
  });
  assert.ok(wacc >= 6, `WACC floor breached: ${wacc}%`);
  assert.ok(wacc <= 9, `WACC unexpectedly high for a low-beta name: ${wacc}%`);
});

test('an implausibly high beta is clamped too', () => {
  const high = estimateWACC({ beta: 6, marketCap: 1e9, totalDebt: 0, interestExpense: 0, taxRate: 0.21 });
  const capped = estimateWACC({ beta: 2.5, marketCap: 1e9, totalDebt: 0, interestExpense: 0, taxRate: 0.21 });
  assert.equal(high, capped, 'beta above the clamp must not keep raising WACC');
});

test('a short P/E history does not move the valuation score', () => {
  // Only two profitable filed years gives TAL an 18-month "five-year range"
  // computed against trough earnings: median 75x against a current 7.6x, and
  // a headline of "cheapest 0% of its range" that reflects an earnings
  // recovery rather than a valuation compression.
  const withShortHistory = healthyModel({ peVsHistoryPct: null });
  const withLongHistory = healthyModel({ peVsHistoryPct: -60 });

  const short = computeComprehensiveHealth(withShortHistory);
  const long = computeComprehensiveHealth(withLongHistory);

  const rowOf = (r) => r.pillars
    .find((p) => p.name.startsWith('Valuation'))
    .items.find((i) => i.name.startsWith('Forward P/E'));

  // With no usable history the row falls back to the absolute multiple.
  assert.ok(rowOf(short).available, 'the row should still score on absolute P/E');
  assert.ok(rowOf(long).points >= rowOf(short).points,
    'a genuine discount to a long history should score at least as well');
});

// =====================================================================
// Defects found reviewing BMBL's DCF sandbox
// =====================================================================

test('an outlier cash-flow year is not used as the projection base', () => {
  // Bumble's FY2025 free cash flow was 2.5x the prior year while revenue fell
  // 9.3%. Anchoring a five-year projection on it compounded a one-off into a
  // $44.97 fair value on a $2.79 stock.
  const model = healthyModel();
  model.history = {
    ...model.history,
    freeCashFlowLatest: 238.7e6,
    freeCashFlowNormalised: 167.2e6,
    revenueChangeLatest: 0.04
  };
  const r = computeComprehensiveHealth(model);
  assert.equal(r.dcf.assumptions.cashFlowBase, 167.2e6, 'should fall back to the median');
  assert.match(r.dcf.assumptions.cashFlowBasis, /median/);
  assert.equal(r.dcf.assumptions.latestFiledCashFlow, 238.7e6, 'the outlier is still reported');
});

test('a stable cash-flow year is used as filed', () => {
  const model = healthyModel();
  model.history = {
    ...model.history,
    freeCashFlowLatest: 26e9,
    freeCashFlowNormalised: 24e9,
    revenueChangeLatest: 0.05
  };
  const r = computeComprehensiveHealth(model);
  assert.equal(r.dcf.assumptions.cashFlowBase, 26e9);
  assert.match(r.dcf.assumptions.cashFlowBasis, /latest filed year/);
});

test('a shrinking business has its decline projected, not growth', () => {
  // The blend of filed CAGRs put Bumble at +18% a year on revenue that had
  // just fallen 9.3%, with negative EBIT and -65% ROIC.
  const model = healthyModel();
  model.history = {
    ...model.history,
    revenueCAGR: 0.0224, epsCAGR: null, fcfPerShareCAGR: 0.3371,
    revenueChangeLatest: -0.093
  };
  const r = computeComprehensiveHealth(model);
  assert.ok(r.dcf.assumptions.growthRate < 0,
    `expected a projected decline, got ${r.dcf.assumptions.growthRate}`);
  assert.ok(Math.abs(r.dcf.assumptions.growthRate - -0.093) < 0.001);
  assert.match(r.dcf.assumptions.growthBasis, /declined/);
  assert.ok(Math.abs(r.dcf.assumptions.growthBeforeBounding - 0.1797) < 0.001,
    'the unbounded blend is still reported for transparency');
});

test('cash-flow growth is capped by what the top line supports', () => {
  const model = healthyModel();
  model.history = {
    ...model.history,
    revenueCAGR: 0.03, epsCAGR: 0.40, fcfPerShareCAGR: 0.45,
    revenueChangeLatest: 0.02
  };
  const r = computeComprehensiveHealth(model);
  assert.ok(r.dcf.assumptions.growthRate <= 0.08 + 1e-9,
    `growth should be capped near revenue + 5 points, got ${r.dcf.assumptions.growthRate}`);
  assert.match(r.dcf.assumptions.growthBasis, /capped/);
});

test('the reverse DCF reports what the market price implies', () => {
  const model = healthyModel();
  const r = computeComprehensiveHealth(model);
  const implied = r.dcf.impliedGrowthRate;
  assert.ok(implied !== null, 'an implied rate should be solvable for a normal company');

  // Feeding the implied rate back through the model must reproduce the price.
  const check = calculateDCFFairValue({
    trailingFCF: r.dcf.assumptions.cashFlowBase,
    growthRate: implied,
    terminalMultiple: r.dcf.assumptions.terminalMultiple,
    discountRate: r.dcf.assumptions.discountRate,
    cashReserves: r.metrics.cash,
    totalDebt: r.metrics.totalDebt,
    sharesOutstanding: r.metrics.sharesOutstanding
  });
  assert.ok(Math.abs(check.fairValuePerShare - r.metrics.price) / r.metrics.price < 0.01,
    `implied rate should reproduce the price: got ${check.fairValuePerShare} vs ${r.metrics.price}`);
});

test('a fair value far from the traded price is flagged, not celebrated', () => {
  const model = healthyModel();
  // Same business, priced at a tenth of it.
  model.quote = { ...model.quote, price: 15, marketCap: 60e9 };
  const r = computeComprehensiveHealth(model);
  assert.equal(r.dcf.divergenceWarning, true);
  assert.ok(r.dcf.divergenceFactor >= 3);
});

test('an ordinary gap between model and market is not flagged', () => {
  const r = computeComprehensiveHealth(healthyModel());
  assert.equal(r.dcf.divergenceWarning, false,
    'the warning must stay quiet on normal valuations or it means nothing');
});

test('capital destruction cuts the terminal multiple further than low returns', () => {
  const weak = healthyModel();
  weak.latest = { ...weak.latest, ebit: 1e9, operatingIncome: 1e9 };   // low but positive ROIC
  const destroying = healthyModel();
  destroying.latest = { ...destroying.latest, ebit: -5e9, operatingIncome: -5e9 };

  const a = computeComprehensiveHealth(weak).dcf.assumptions.terminalMultiple;
  const b = computeComprehensiveHealth(destroying).dcf.assumptions.terminalMultiple;
  assert.ok(b < a, `negative ROIC should score below merely low ROIC: ${b} vs ${a}`);
});

// =====================================================================
// Depositary receipts: traded currency vs reporting currency
// =====================================================================

test('market figures enter the model in the reporting currency', () => {
  // NOK trades in USD and files in EUR. Unconverted, Altman's X4 divides a USD
  // market capitalisation by EUR liabilities and the DCF returns a EUR fair
  // value to be compared against a USD price.
  const model = healthyModel();
  model.reportingCurrency = 'EUR';
  model.tradedCurrency = 'USD';
  model.fx = { needed: true, rate: 0.856, from: 'USD', to: 'EUR', available: true };
  model.quote = {
    ...model.quote,
    currency: 'USD',
    price: 10.13,
    priceReporting: 10.13 * 0.856,
    marketCap: null,
    marketCapReporting: null,
    sharesOutstanding: 5.5e9
  };

  const r = computeComprehensiveHealth(model);
  assert.ok(Math.abs(r.metrics.price - 8.671) < 0.01, 'ratios must use the converted price');
  assert.equal(r.metrics.tradedPrice, 10.13, 'the quoted price is preserved separately');
  assert.equal(r.metrics.tradedCurrency, 'USD');
  assert.equal(r.metrics.reportingCurrency, 'EUR');
  assert.ok(Math.abs(r.metrics.marketCap - 10.13 * 0.856 * 5.5e9) < 1,
    'market cap must be built from the converted price');
});

test('an unavailable exchange rate withholds the mixed-currency metrics', () => {
  const model = healthyModel();
  model.reportingCurrency = 'EUR';
  model.tradedCurrency = 'USD';
  model.fx = { needed: true, rate: null, from: 'USD', to: 'EUR', available: false };
  model.quote = {
    ...model.quote, currency: 'USD', price: 10.13,
    priceReporting: null, marketCap: null, marketCapReporting: null
  };

  const r = computeComprehensiveHealth(model);
  assert.equal(r.metrics.price, null);
  assert.equal(r.metrics.marketCap, null);
  assert.equal(r.altmanZ, null, 'X4 must not mix currencies');
  // A fair value per share is still computable without a price — it needs
  // cash flow and a share count. What cannot be stated is the comparison.
  assert.equal(r.dcf.marginOfSafetyPct, null, 'no price means no margin of safety');
  assert.equal(r.metrics.fcfYield, null, 'no market cap means no yield');
  assert.equal(r.metrics.enterpriseValue, null);
});

test('a single-currency company is unaffected by the conversion path', () => {
  const r = computeComprehensiveHealth(healthyModel());
  assert.equal(r.metrics.price, 150);
  assert.equal(r.metrics.marketCap, 600e9);
  assert.ok(r.altmanZ !== null);
});
