import { test } from 'node:test';
import assert from 'node:assert';
import { assessSummaryStaleness, PRICE_DRIFT_THRESHOLD } from './staleness.js';

const stock = (fiscalPeriodEnd, price) => ({
  price,
  summary: { metrics: { fiscalPeriodEnd } }
});

const summary = (fiscalPeriodEnd, priceAtGeneration) => ({
  fiscalPeriodEnd,
  priceAtGeneration
});

test('an analysis against the current filings at a steady price is fresh', () => {
  const r = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 105));
  assert.strictEqual(r.stale, false);
  assert.strictEqual(r.scope, 'none');
  assert.strictEqual(r.headline, null);
});

test('newer filings make the whole analysis stale', () => {
  const r = assessSummaryStaleness(summary('2025-12-31', 100), stock('2026-12-31', 100));
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.filingsChanged, true);
  assert.strictEqual(r.scope, 'all');
  assert.match(r.detail, /2025-12-31/);
  assert.match(r.detail, /2026-12-31/);
});

test('price drift alone affects only the valuation sections', () => {
  const r = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 130));
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.priceDrifted, true);
  assert.strictEqual(r.filingsChanged, false);
  assert.strictEqual(r.scope, 'valuation');
  // The point of the distinction: the moat reasoning survives a price move.
  assert.match(r.detail, /moat and solvency reasoning is unchanged/);
});

test('newer filings outrank price drift when both are true', () => {
  const r = assessSummaryStaleness(summary('2025-12-31', 100), stock('2026-12-31', 130));
  assert.strictEqual(r.scope, 'all');
  assert.strictEqual(r.priceDrifted, true);
  assert.match(r.headline, /Newer financial statements/);
});

test('drift is measured in both directions', () => {
  const down = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 70));
  assert.strictEqual(down.priceDrifted, true);
  assert.ok(down.driftRatio < 0);
  assert.match(down.detail, /−30%/);

  const up = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 130));
  assert.match(up.detail, /\+30%/);
});

test('the threshold is inclusive and a hair under it is fresh', () => {
  const at = assessSummaryStaleness(
    summary('2025-12-31', 100),
    stock('2025-12-31', 100 * (1 + PRICE_DRIFT_THRESHOLD))
  );
  assert.strictEqual(at.priceDrifted, true);

  const under = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 114.9));
  assert.strictEqual(under.stale, false);
});

test('a missing fiscal period is not evidence of anything', () => {
  // An analysis cached before the field existed must not be condemned on the
  // strength of a value nobody recorded.
  assert.strictEqual(
    assessSummaryStaleness(summary(null, 100), stock('2026-12-31', 100)).filingsChanged,
    false
  );
  assert.strictEqual(
    assessSummaryStaleness(summary('2025-12-31', 100), stock(null, 100)).filingsChanged,
    false
  );
});

test('a missing or nonsensical price is not drift', () => {
  assert.strictEqual(assessSummaryStaleness(summary('2025-12-31', null), stock('2025-12-31', 500)).stale, false);
  assert.strictEqual(assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', null)).stale, false);
  assert.strictEqual(assessSummaryStaleness(summary('2025-12-31', 0), stock('2025-12-31', 100)).stale, false);
});

test('a price stored as a string still compares', () => {
  // The cached summary is JSON that has round-tripped through two stores.
  const r = assessSummaryStaleness({ fiscalPeriodEnd: '2025-12-31', priceAtGeneration: '100' },
                                   stock('2025-12-31', 130));
  assert.strictEqual(r.priceDrifted, true);
});

test('missing arguments are fresh rather than an exception', () => {
  assert.strictEqual(assessSummaryStaleness(null, stock('2025-12-31', 100)).stale, false);
  assert.strictEqual(assessSummaryStaleness(summary('2025-12-31', 100), null).stale, false);
  assert.strictEqual(assessSummaryStaleness(undefined, undefined).stale, false);
});

test('percentages render without toFixed rounding differences', () => {
  // core/format.js exists because toFixed is not portable across the engines
  // this runs in; this string is user-visible, so it must not reintroduce it.
  const r = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 116.25));
  assert.match(r.detail, /\+16\.3%|\+16\.2%/);
  const whole = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 120));
  assert.match(whole.detail, /\+20%/, 'a whole number should not render as 20.0%');
});
