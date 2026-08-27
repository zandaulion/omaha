import { test } from 'node:test';
import assert from 'node:assert';
import {
  dcfBaselines,
  presetAssumptions,
  dcfBlockedReason,
  projectDcf,
  dcfVerdict,
  LIMITS,
  PROJECTION_YEARS
} from './dcf.js';

test('baselines come from the engine, not from round numbers', () => {
  const b = dcfBaselines({ assumptions: { growthRate: 0.0731, terminalMultiple: 22.4, discountRate: 0.0925 } });
  assert.deepStrictEqual(b, { growthPct: 7, multiple: 22, discountPct: 9.3 });
});

test('a missing summary still yields usable baselines', () => {
  assert.deepStrictEqual(dcfBaselines(null), { growthPct: 6, multiple: 15, discountPct: 9.5 });
});

test('the bear case for a shrinking business declines faster', () => {
  // The defect this guards: multiplying a negative growth rate by 0.65 makes
  // the bear case the optimistic one.
  const shrinking = presetAssumptions('bear', { growthPct: -10, multiple: 20, discountPct: 9 });
  assert.ok(shrinking.growthPct < -10, `bear of -10% should be worse, got ${shrinking.growthPct}`);

  const growing = presetAssumptions('bear', { growthPct: 20, multiple: 20, discountPct: 9 });
  assert.ok(growing.growthPct < 20 && growing.growthPct > 0);
});

test('the bull case for a shrinking business declines more slowly', () => {
  const bull = presetAssumptions('bull', { growthPct: -10, multiple: 20, discountPct: 9 });
  assert.ok(bull.growthPct > -10 && bull.growthPct < 0);
});

test('presets stay inside the slider bounds', () => {
  for (const g of [-40, -25, 0, 45, 90]) {
    for (const preset of ['bear', 'base', 'bull']) {
      const a = presetAssumptions(preset, { growthPct: g, multiple: 20, discountPct: 9 });
      assert.ok(a.growthPct >= LIMITS.growthPct.min && a.growthPct <= LIMITS.growthPct.max,
        `${preset} of ${g} produced ${a.growthPct}`);
      assert.ok(a.multiple >= LIMITS.multiple.min && a.multiple <= LIMITS.multiple.max);
      assert.ok(a.discountPct >= LIMITS.discountPct.min && a.discountPct <= LIMITS.discountPct.max);
    }
  }
});

test('base returns the baseline unchanged when it is already in range', () => {
  const b = { growthPct: 11, multiple: 19, discountPct: 8.5 };
  assert.deepStrictEqual(presetAssumptions('base', b), b);
});

test('a baseline outside the slider range is clamped at source', () => {
  // The filings are not obliged to land inside a UI range, and the clamp has
  // to happen where the baseline is produced rather than only at the presets.
  // Clamped only later, a company with 90% filed growth showed a slider pinned
  // at 45 while its bear case was derived from 90 — worse than a base nobody
  // could see. Found by the Kotlin parity gate on its first run.
  const hot = dcfBaselines({ assumptions: { growthRate: 0.90, terminalMultiple: 60, discountRate: 0.02 } });
  assert.deepStrictEqual(hot, { growthPct: 45, multiple: 45, discountPct: 6 });

  // And the bear case now derives from the visible base, not the raw one.
  assert.strictEqual(presetAssumptions('bear', hot).growthPct, Math.round(45 * 0.65));
});

test('the model refuses to run rather than inventing a cash flow', () => {
  assert.strictEqual(dcfBlockedReason({ cashFlowBase: -5e9, shares: 1e9 }), 'negative-fcf');
  assert.strictEqual(dcfBlockedReason({ cashFlowBase: 0, shares: 1e9 }), 'negative-fcf');
  assert.strictEqual(dcfBlockedReason({ cashFlowBase: 1e9, shares: 0 }), 'no-share-count');
  assert.strictEqual(dcfBlockedReason({ cashFlowBase: 1e9, shares: NaN }), 'no-share-count');
  assert.strictEqual(
    dcfBlockedReason({ dcfSummary: { applicable: false, reason: 'not-meaningful-for-financials' }, cashFlowBase: 1e9, shares: 1e9 }),
    'not-meaningful-for-financials'
  );
  assert.strictEqual(dcfBlockedReason({ cashFlowBase: 1e9, shares: 1e9 }), null);
});

test('the projection discounts five years and a terminal multiple', () => {
  const r = projectDcf({
    cashFlowBase: 100, shares: 10, netCash: 0,
    growthPct: 0, multiple: 10, discountPct: 10
  });

  assert.strictEqual(r.rows.length, PROJECTION_YEARS);
  // Zero growth: every year projects 100, discounted at 10%.
  assert.ok(Math.abs(r.rows[0].fcf - 100) < 1e-9);
  assert.ok(Math.abs(r.rows[0].pv - 100 / 1.1) < 1e-9);
  assert.ok(Math.abs(r.terminalValue - 1000) < 1e-9);
  assert.ok(Math.abs(r.pvTerminal - 1000 / Math.pow(1.1, 5)) < 1e-9);
  assert.ok(Math.abs(r.equityValue - r.enterpriseValue) < 1e-9);
  assert.ok(Math.abs(r.fairValue - r.equityValue / 10) < 1e-9);
});

test('net debt reduces equity value, net cash raises it', () => {
  const base = { cashFlowBase: 100, shares: 10, growthPct: 5, multiple: 15, discountPct: 9 };
  const withCash = projectDcf({ ...base, netCash: 500 });
  const withDebt = projectDcf({ ...base, netCash: -500 });
  assert.ok(Math.abs((withCash.equityValue - withDebt.equityValue) - 1000) < 1e-9);
});

test('a wide divergence is reported as such rather than as a huge margin', () => {
  // The failure this prevents: a fair value four times the price rendered as
  // "margin of safety 75%", which reads as a recommendation.
  assert.strictEqual(dcfVerdict(400, 100).kind, 'divergent');
  assert.strictEqual(dcfVerdict(25, 100).kind, 'divergent');
  assert.strictEqual(dcfVerdict(150, 100).kind, 'undervalued');
  assert.strictEqual(dcfVerdict(80, 100).kind, 'overvalued');
});

test('an overvalued verdict is a premium, not a negative margin', () => {
  const v = dcfVerdict(50, 100);
  assert.strictEqual(v.kind, 'overvalued');
  // 100 is 100% above 50. The margin-of-safety form would say -100%.
  assert.ok(Math.abs(v.pct - 100) < 1e-9);
});

test('no equity value is distinguished from a cheap stock', () => {
  assert.strictEqual(dcfVerdict(-5, 100).kind, 'no-equity-value');
  assert.strictEqual(dcfVerdict(0, 100).kind, 'no-equity-value');
  assert.strictEqual(dcfVerdict(50, 0).kind, 'no-price');
});
