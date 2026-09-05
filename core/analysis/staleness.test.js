import { test } from 'node:test';
import assert from 'node:assert';
import { assessSummaryStaleness, PRICE_DRIFT_THRESHOLD } from './staleness.js';

const stock = (fiscalPeriodEnd, price) => ({
  price,
  summary: { metrics: { fiscalPeriodEnd } }
});

// Written against the current prompt unless a test says otherwise, so the
// existing cases keep testing what they were written to test.
const CURRENT_PROMPT = 2;

const summary = (fiscalPeriodEnd, priceAtGeneration, promptVersion = CURRENT_PROMPT) => ({
  fiscalPeriodEnd,
  priceAtGeneration,
  promptVersion
});

test('an analysis against the current filings at a steady price is fresh', () => {
  const r = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 105), CURRENT_PROMPT);
  assert.strictEqual(r.stale, false);
  assert.strictEqual(r.scope, 'none');
  assert.strictEqual(r.headline, null);
});

test('newer filings make the whole analysis stale', () => {
  const r = assessSummaryStaleness(summary('2025-12-31', 100), stock('2026-12-31', 100), CURRENT_PROMPT);
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.filingsChanged, true);
  assert.strictEqual(r.scope, 'all');
  assert.match(r.detail, /2025-12-31/);
  assert.match(r.detail, /2026-12-31/);
});

test('price drift alone affects only the valuation sections', () => {
  const r = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 130), CURRENT_PROMPT);
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.priceDrifted, true);
  assert.strictEqual(r.filingsChanged, false);
  assert.strictEqual(r.scope, 'valuation');
  // The point of the distinction: the moat reasoning survives a price move.
  assert.match(r.detail, /moat and solvency reasoning is unchanged/);
});

test('newer filings outrank price drift when both are true', () => {
  const r = assessSummaryStaleness(summary('2025-12-31', 100), stock('2026-12-31', 130), CURRENT_PROMPT);
  assert.strictEqual(r.scope, 'all');
  assert.strictEqual(r.priceDrifted, true);
  assert.match(r.headline, /Newer financial statements/);
});

test('drift is measured in both directions', () => {
  const down = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 70), CURRENT_PROMPT);
  assert.strictEqual(down.priceDrifted, true);
  assert.ok(down.driftRatio < 0);
  assert.match(down.detail, /−30%/);

  const up = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 130), CURRENT_PROMPT);
  assert.match(up.detail, /\+30%/);
});

test('the threshold is inclusive and a hair under it is fresh', () => {
  const at = assessSummaryStaleness(
    summary('2025-12-31', 100),
    stock('2025-12-31', 100 * (1 + PRICE_DRIFT_THRESHOLD), CURRENT_PROMPT)
  );
  assert.strictEqual(at.priceDrifted, true);

  const under = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 114.9), CURRENT_PROMPT);
  assert.strictEqual(under.stale, false);
});

test('a missing fiscal period is not evidence of anything', () => {
  // An analysis cached before the field existed must not be condemned on the
  // strength of a value nobody recorded.
  assert.strictEqual(
    assessSummaryStaleness(summary(null, 100), stock('2026-12-31', 100), CURRENT_PROMPT).filingsChanged,
    false
  );
  assert.strictEqual(
    assessSummaryStaleness(summary('2025-12-31', 100), stock(null, 100), CURRENT_PROMPT).filingsChanged,
    false
  );
});

test('a missing or nonsensical price is not drift', () => {
  assert.strictEqual(assessSummaryStaleness(summary('2025-12-31', null), stock('2025-12-31', 500), CURRENT_PROMPT).stale, false);
  assert.strictEqual(assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', null), CURRENT_PROMPT).stale, false);
  assert.strictEqual(assessSummaryStaleness(summary('2025-12-31', 0), stock('2025-12-31', 100), CURRENT_PROMPT).stale, false);
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
  const r = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 116.25), CURRENT_PROMPT);
  assert.match(r.detail, /\+16\.3%|\+16\.2%/);
  const whole = assessSummaryStaleness(summary('2025-12-31', 100), stock('2025-12-31', 120), CURRENT_PROMPT);
  assert.match(whole.detail, /\+20%/, 'a whole number should not render as 20.0%');
});

test('an analysis written before the app learned something is superseded', () => {
  // The filings have not moved and the price has not moved. What changed is
  // what the app can measure -- for a bank, the difference between having a
  // fair value and having none at all.
  const r = assessSummaryStaleness(
    summary('2025-12-31', 100, 1), stock('2025-12-31', 100), 2
  );
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.supersededByNewerAnalysis, true);
  assert.strictEqual(r.filingsChanged, false);
  assert.strictEqual(r.priceDrifted, false);
  // The whole analysis, not just the valuation: every section was reasoned
  // without figures that now exist.
  assert.strictEqual(r.scope, 'all');
});

test('an analysis from before the stamp existed counts as superseded', () => {
  // Unknown is not current. Treating a missing version as up to date is the
  // favourable reading rather than the true one, and every summary in the
  // database predates the field.
  const before = { fiscalPeriodEnd: '2025-12-31', priceAtGeneration: 100 };
  const r = assessSummaryStaleness(before, stock('2025-12-31', 100), 2);
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.supersededByNewerAnalysis, true);
});

test('newer filings are reported ahead of a newer prompt', () => {
  // Both apply; the filings are the more concrete reason and the one a reader
  // can go and check for themselves.
  const r = assessSummaryStaleness(
    summary('2025-12-31', 100, 1), stock('2026-12-31', 100), 2
  );
  assert.match(r.headline, /financial statements/i);
  assert.strictEqual(r.supersededByNewerAnalysis, true);
});

test('a summary at the current version is not superseded', () => {
  const r = assessSummaryStaleness(
    summary('2025-12-31', 100, 2), stock('2025-12-31', 100), 2
  );
  assert.strictEqual(r.stale, false);
  assert.strictEqual(r.supersededByNewerAnalysis, false);
});
