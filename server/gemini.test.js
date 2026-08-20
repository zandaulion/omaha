/**
 * Payload construction tests. The prompt is only as good as what it is handed,
 * and the failures worth guarding against here are ones that read perfectly
 * well while being wrong.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComprehensivePayload } from './gemini.js';

/** Minimal shaped stock, resembling what finance.js emits. */
function stockFixture(overrides = {}) {
  const metrics = {
    fiscalPeriodEnd: '2025-12-31',
    isFinancial: false,
    revenue: 19889e6, netIncome: 651e6, ebit: 1134e6, ebitda: 2253e6,
    freeCashFlow: 1465e6, operatingCashFlow: 2071e6,
    cash: 6763e6, totalDebt: 4413e6, netCash: 2350e6, equity: 20967e6,
    totalLiabilities: 16539e6, workingCapital: 5788e6,
    currentRatio: 1.5786, quickRatio: 1.3578, interestCoverage: 5.178,
    debtToEquity: 0.2105, equityToAssets: 0.5577, netDebtToEbitda: -1.04,
    grossMargin: 0.4354, operatingMargin: 0.0393, fcfMargin: 0.0737,
    roic: 4.25, wacc: 7.62, roicSpread: -3.37, roe: 0.031, roa: 0.0173,
    assetTurnover: 0.529, effectiveTaxRate: 0.3027,
    marketCap: 47716e6, sharesOutstanding: 5502781000,
    price: 8.6713, tradedPrice: 10.13,
    tradedCurrency: 'USD', reportingCurrency: 'EUR',
    fx: { needed: true, rate: 0.8561, from: 'USD', to: 'EUR', available: true },
    revenueCAGR: -0.0576, cagrYears: 3, shareChangeYoY: -0.005,
    shareChangeYears: 1, shareChangeAnnualisedPct: -0.5,
    fcfPositiveYears: 4, fcfReportedYears: 4,
    piotroski: { score: 6, testable: 9, normalised: 6, details: [] },
    ...(overrides.metrics || {})
  };

  return {
    ticker: 'NOK', name: 'Nokia Corporation', sector: 'Technology',
    industry: 'Communication Equipment',
    price: 10.13, change_pct: -2.5,
    currency: 'USD',                       // traded
    health_score: 55, altman_z: 2.61, piotroski_score: 6,
    roic_pct: 4.25, fcf_conversion_pct: 225, net_cash_b: 2.35,
    financials: {
      reportingCurrency: 'EUR', historical: { periods: ['2025-12-31'] },
      grossProfit: 8659e6, operatingIncome: 782e6, capitalExpenditures: 606e6,
      dilutedEPS: 0.12
    },
    checklist: [], catalysts: [], risks: [], pillars: [],
    summary: {
      healthGrade: 'MODERATE', healthLabel: 'Mixed',
      checklistSummary: {}, coverage: { measured: 19, total: 19, pct: 100 },
      metrics, ratios: { pe: 72.36, forwardPE: 20.39, peg: 1.05 },
      dcf: {
        applicable: true, fairValue: 3.54, marginOfSafetyPct: -145,
        premiumToFairValuePct: 145, impliedGrowthRate: 0.2347,
        divergenceFactor: 0.41, divergenceWarning: false,
        assumptions: {
          growthRate: -0.0076, growthBasis: 'median', growthBeforeBounding: -0.0576,
          terminalMultiple: 13, discountRate: 0.095,
          cashFlowBase: 1465e6, cashFlowBasis: 'latest filed year',
          latestFiledCashFlow: 1465e6, normalisedCashFlow: 1465e6
        }
      },
      peHistory: { available: false, reason: 'insufficient history' }
    },
    ...overrides
  };
}

test('statement figures are labelled with the reporting currency, not the traded one', () => {
  // Nokia trades in USD and reports in EUR. Taking stock.currency here put a
  // dollar sign on the entire EUR balance sheet, and the model repeated it.
  const p = buildComprehensivePayload(stockFixture(), null);

  assert.match(p.balanceSheet.netPosition, /€/, 'balance sheet must be in EUR');
  assert.match(p.incomeAndCashFlow.revenue, /€/);
  assert.match(p.valuation.dcfFairValue, /€/);
  assert.match(p.company.marketCap, /€/);
  assert.equal(p.company.reportingCurrency, 'EUR');

  // The traded price keeps its own currency.
  assert.match(p.company.tradedPrice, /\$10\.13/);
  assert.match(p.company.priceUsedForRatios, /€8\.67/);
});

test('the currency split is explained, with the rate', () => {
  const p = buildComprehensivePayload(stockFixture(), null);
  const note = p.readMeFirst.currencies;
  assert.match(note, /trade in USD/);
  assert.match(note, /reports in EUR/);
  assert.match(note, /0\.8561/, 'the conversion rate must be stated');
  assert.doesNotMatch(note, /1 USD = [\d.]+ USD/, 'the note must not claim a currency converts to itself');
});

test('a single-currency company gets no conversion narrative', () => {
  const s = stockFixture({ currency: 'USD' });
  s.financials.reportingCurrency = 'USD';
  s.summary.metrics = {
    ...s.summary.metrics, reportingCurrency: 'USD', tradedCurrency: 'USD',
    fx: { needed: false, rate: 1, available: true }
  };
  const p = buildComprehensivePayload(s, null);
  assert.match(p.readMeFirst.currencies, /same currency/);
  assert.match(p.balanceSheet.netPosition, /\$/);
});

test('provenance reaches the model rather than staying in the engine', () => {
  const s = stockFixture();
  s.summary.metrics = {
    ...s.summary.metrics,
    betaClamped: true, beta: 0.15, marketCapDerived: true,
    totalLiabilitiesDerived: true, taxRateEstimated: true,
    interestExpenseCarried: true, interestExpenseAsOf: '2024-02-29',
    shareChangeIsAnnual: false, shareChangeYears: 2
  };
  s.summary.coverage = { measured: 17, total: 19, pct: 89 };
  s.summary.peHistory = { available: true, scoreable: false, months: 19, epsPeriods: 2 };

  const notes = buildComprehensivePayload(s, null).readMeFirst.provenance.join(' | ');
  for (const expected of [/beta/i, /derived/i, /carried forward/i, /statutory/i, /2 fiscal years/i, /P\/E history/i, /sub-scores/i]) {
    assert.match(notes, expected, `provenance should mention ${expected}`);
  }
});

test('an unmeasurable metric never reaches the model as a number', () => {
  const s = stockFixture();
  s.summary.metrics = {
    ...s.summary.metrics,
    roic: null, wacc: null, roicSpread: null, grossMargin: null,
    currentRatio: null, quickRatio: null, interestCoverage: null
  };
  const p = buildComprehensivePayload(s, null);
  assert.equal(p.quantitativeKPIs.returnOnInvestedCapital, 'not reported');
  assert.equal(p.quantitativeKPIs.estimatedWACC, 'not reported');
  assert.equal(p.quantitativeKPIs.grossMargin, 'not reported');
  assert.equal(p.balanceSheet.currentRatio, 'not reported');
});

test('array units are carried in the key names', () => {
  const s = stockFixture();
  s.financials.historical = {
    periods: ['2024-12-31', '2025-12-31'],
    revenue: [19.22, 19.889], operatingMarginPct: [-8.9, 3.9], sharesOutstanding: [5.53, 5.50]
  };
  const keys = Object.keys(buildComprehensivePayload(s, null).growthAndHistory);
  // Units in a note were not enough: an array of -8.9 alongside dollar figures
  // was read as "negative $8.9M".
  assert.ok(keys.some((k) => k.includes('billionsEUR')), `expected a unit-bearing key, got ${keys}`);
  assert.ok(keys.some((k) => k.includes('_percent')));
});
