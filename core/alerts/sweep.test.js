import { test } from 'node:test';
import assert from 'node:assert';

import {
  COOLDOWN_DAYS,
  DEFAULT_COOLDOWN_DAYS,
  DEFAULT_NOTIFICATION_SETTINGS,
  DIGEST_MOVER_THRESHOLD,
  buildDigest,
  cooldownDays,
  isSweepAbandonError,
  isWithinCooldown,
  movers,
  snapshotOf,
  sweepDecision
} from './sweep.js';
import { evaluateTriggers } from './triggers.js';

/**
 * These rules exist to be shared, so most of what is asserted here is
 * agreement — between `snapshotOf` and the fields `evaluateTriggers` reads,
 * and between a host's stored row and what the next comparison expects.
 */

const DAY = 86_400_000;

// ------------------------------------------------------------- snapshotOf

const scored = {
  ticker: 'AAPL',
  health_score: 66,
  altman_z: 6.4,
  piotroski_score: 7,
  checklist: [
    { id: 1, status: 'pass' },
    { id: 8, status: 'watch' },
    { id: 11, status: 'na' }
  ],
  summary: {
    metrics: { currentRatio: 0.87, grossMargin: 0.469, pegRatio: 2.1, shareChangeYoY: -0.031 },
    peHistory: { scoreable: true, percentile: 42 }
  }
};

test('a snapshot carries every field the triggers compare against', () => {
  const snap = snapshotOf(scored);

  // The real assertion: run the triggers against this snapshot as `prev` and
  // confirm each rule can actually see a number. A field spelled differently
  // would read as undefined, which `both()` treats as "not comparable" — the
  // rule would go quiet rather than fail, and no test that only checked keys
  // would notice.
  for (const key of [
    'health_score', 'altman_z', 'piotroski_score',
    'current_ratio', 'gross_margin', 'pe_percentile', 'peg_ratio', 'share_change'
  ]) {
    assert.strictEqual(typeof snap[key], 'number', `${key} did not survive the projection`);
  }
  assert.deepStrictEqual(snap.checklist, { 1: 'pass', 8: 'watch', 11: 'na' });
});

test('an unchanged stock against its own snapshot fires nothing', () => {
  // The end-to-end version of the test above. If the projection and the
  // triggers disagree anywhere, a stock compared with itself produces alerts.
  const alerts = evaluateTriggers(scored, snapshotOf(scored), DEFAULT_NOTIFICATION_SETTINGS);
  assert.deepStrictEqual(alerts, []);
});

test('a P/E history too short to score is not carried forward', () => {
  const shallow = {
    ...scored,
    summary: { ...scored.summary, peHistory: { scoreable: false, percentile: 4 } }
  };
  assert.strictEqual(snapshotOf(shallow).pe_percentile, null);
});

test('missing metrics become null, never zero', () => {
  // Zero is a value. A stock whose current ratio was not reported must not
  // look like one whose current ratio collapsed to 0.0 — that is a
  // RED_FLAG_WARNING that never happened.
  const snap = snapshotOf({ ticker: 'X', checklist: [] });
  assert.strictEqual(snap.current_ratio, null);
  assert.strictEqual(snap.health_score, null);
  assert.deepStrictEqual(snap.checklist, {});
});

// --------------------------------------------------------------- cooldown

test('each alert type keeps its own floor, and unknown types get the default', () => {
  assert.strictEqual(cooldownDays('MARGIN_OF_SAFETY'), 14);
  assert.strictEqual(cooldownDays('EARNINGS_HEALTH_SHIFT'), 1);
  assert.strictEqual(cooldownDays('SOMETHING_NEW'), DEFAULT_COOLDOWN_DAYS);
});

test('a standing condition cannot re-announce itself inside its window', () => {
  const now = Date.UTC(2026, 7, 27, 12, 0, 0);
  const alert = { type: 'MARGIN_OF_SAFETY', ticker: 'NU' };

  assert.strictEqual(isWithinCooldown(alert, now - 13 * DAY, now), true);
  assert.strictEqual(isWithinCooldown(alert, now - 15 * DAY, now), false);
  assert.strictEqual(isWithinCooldown(alert, null, now), false);
});

test('a SQLite timestamp with no zone marker is read as UTC', () => {
  // `new Date('2026-08-27 06:00:00')` is local time in V8 and unparseable in
  // QuickJS. Read as local east of UTC it looks older than it is, which lets
  // an alert repeat early on exactly the hosts this module was written for.
  const now = Date.UTC(2026, 7, 27, 12, 0, 0);
  assert.strictEqual(isWithinCooldown({ type: 'RED_FLAG_WARNING' }, '2026-08-27 06:00:00', now), true);
  assert.strictEqual(isWithinCooldown({ type: 'RED_FLAG_WARNING' }, '2026-08-20 06:00:00', now), false);
});

test('an unreadable timestamp lets the alert through rather than silencing it', () => {
  // Failing towards silence would mean a corrupt history row stops alerts
  // permanently, with nothing on screen to say so.
  assert.strictEqual(isWithinCooldown({ type: 'RED_FLAG_WARNING' }, 'not a date', Date.now()), false);
});

test('every named cooldown is at least a day', () => {
  for (const [type, days] of Object.entries(COOLDOWN_DAYS)) {
    assert.ok(days >= 1, `${type} would allow same-day repeats`);
  }
});

// ---------------------------------------------------------- sweep control

test('a rate-limited response abandons the sweep, a stale one only skips', () => {
  assert.strictEqual(sweepDecision({ stale: true, staleReason: 'rate_limited' }), 'abandon');
  assert.strictEqual(sweepDecision({ stale: true, staleReason: 'network' }), 'skip');
  assert.strictEqual(sweepDecision(null), 'skip');
  assert.strictEqual(sweepDecision({ health_score: 66 }), 'evaluate');
});

test('a thrown rate limit abandons too', () => {
  assert.strictEqual(isSweepAbandonError({ kind: 'rate_limited' }), true);
  assert.strictEqual(isSweepAbandonError({ kind: 'not_found' }), false);
  assert.strictEqual(isSweepAbandonError(null), false);
});

// ----------------------------------------------------------------- digest

test('the digest weights by capitalisation and names the biggest movers', () => {
  const alert = buildDigest({
    listName: 'The Compounders',
    holdings: [
      { ticker: 'AAPL', healthScore: 90, marketCap: 3000, previousScore: 88 },
      { ticker: 'NOK', healthScore: 50, marketCap: 20, previousScore: 61 },
      { ticker: 'MSFT', healthScore: 80, marketCap: 3000, previousScore: 80 }
    ]
  });

  // 90*3000 + 50*20 + 80*3000 = 511000 over 6020 = 84.9 -> 85. An equal
  // weighting would give 73, letting a 20bn holding drag the headline as hard
  // as a 3tn one.
  assert.strictEqual(alert.title, '🎩 The Compounders: 85/100');
  assert.match(alert.body, /^3 holdings scored\./);
  assert.match(alert.body, /NOK -11/);
  assert.ok(!alert.body.includes('MSFT'), 'a flat holding is not a mover');
  assert.strictEqual(alert.type, 'WEEKLY_DIGEST');
});

test('the digest says so when nothing moved, rather than trailing off', () => {
  const alert = buildDigest({
    listName: 'Watchlist',
    holdings: [{ ticker: 'AAPL', healthScore: 90, marketCap: 3000, previousScore: 90 }]
  });
  assert.match(alert.body, /No material health changes this week\./);
});

test('an unscored list produces no digest at all', () => {
  assert.strictEqual(buildDigest({ listName: 'Empty', holdings: [] }), null);
  assert.strictEqual(
    buildDigest({ listName: 'Unscored', holdings: [{ ticker: 'X', healthScore: null }] }),
    null
  );
});

// ------------------------------------------------------------------ movers

test('movers is sorted by |delta|, largest first', () => {
  const m = movers([
    { ticker: 'A', healthScore: 60, previousScore: 55 },
    { ticker: 'B', healthScore: 40, previousScore: 60 },
    { ticker: 'C', healthScore: 70, previousScore: 69 }
  ]);
  assert.deepStrictEqual(m.map((mv) => mv.ticker), ['B', 'A'], 'C is below threshold');
  assert.strictEqual(m[0].delta, -20);
});

test('movers respects the exact threshold, inclusive', () => {
  const at = movers([{ ticker: 'A', healthScore: 62, previousScore: 60 }]);
  assert.strictEqual(at.length, 1, `delta of exactly ${DIGEST_MOVER_THRESHOLD} should count`);

  const under = movers([{ ticker: 'A', healthScore: 61, previousScore: 60 }]);
  assert.strictEqual(under.length, 0);
});

test('movers drops a holding with no baseline rather than treating it as a full-score move', () => {
  const m = movers([{ ticker: 'NEW', healthScore: 66, previousScore: null }]);
  assert.strictEqual(m.length, 0);
});

test('movers on an empty or missing list is an empty list, not an exception', () => {
  assert.deepStrictEqual(movers([]), []);
  assert.deepStrictEqual(movers(undefined), []);
});

test('holdings with no known capitalisation still average', () => {
  // Weighted by a total of zero is a division by zero, and the composite would
  // be NaN in the title of a notification.
  const alert = buildDigest({
    listName: 'W',
    holdings: [{ ticker: 'A', healthScore: 80 }, { ticker: 'B', healthScore: 60 }]
  });
  assert.strictEqual(alert.title, '🎩 W: 70/100');
});

// --------------------------------------------------------------- defaults

test('capital returns is the one alert that starts off', () => {
  assert.strictEqual(DEFAULT_NOTIFICATION_SETTINGS.notify_capital_returns, 0);
  for (const [key, on] of Object.entries(DEFAULT_NOTIFICATION_SETTINGS)) {
    if (key !== 'notify_capital_returns') assert.strictEqual(on, 1, `${key} should default on`);
  }
});

// --------------------------------------------------------------- baseline

import { DIGEST_BASELINE_DAYS, rollBaseline } from './sweep.js';

test('the first sweep has nothing to compare against and says so', () => {
  assert.deepStrictEqual(rollBaseline(null, '2026-08-27T09:00:00Z'), { score: null, at: null });
});

test('the second sweep adopts the reading it is replacing', () => {
  const rolled = rollBaseline(
    { health_score: 61, week_ago_score: null, week_ago_at: null },
    '2026-08-27T09:00:00Z'
  );
  assert.deepStrictEqual(rolled, { score: 61, at: '2026-08-27T09:00:00Z' });
});

test('a fresh baseline is left alone, so the window does not reset every six hours', () => {
  // The defect this exists to prevent: rolling on every sweep makes the
  // baseline four hours old, and every digest then reports no movement.
  const rolled = rollBaseline(
    { health_score: 55, week_ago_score: 61, week_ago_at: '2026-08-25T09:00:00Z' },
    '2026-08-27T09:00:00Z'
  );
  assert.deepStrictEqual(rolled, { score: 61, at: '2026-08-25T09:00:00Z' });
});

test('a baseline older than the window rolls forward', () => {
  const rolled = rollBaseline(
    { health_score: 55, week_ago_score: 61, week_ago_at: '2026-08-20T09:00:00Z' },
    '2026-08-27T09:00:00Z'
  );
  assert.deepStrictEqual(rolled, { score: 55, at: '2026-08-27T09:00:00Z' });
});

test('the window rolls before the next Sunday rather than after it', () => {
  // At seven days a weekly check rolls on alternate Sundays, and the digest
  // then compares across a fortnight while saying "this week".
  assert.ok(DIGEST_BASELINE_DAYS < 7);

  const sunday = '2026-08-30T09:00:00Z';
  const lastSunday = '2026-08-23T09:00:00Z';
  const rolled = rollBaseline(
    { health_score: 70, week_ago_score: 64, week_ago_at: lastSunday },
    sunday
  );
  assert.strictEqual(rolled.at, sunday, 'a week-old baseline should have rolled');
});

test('a baseline that never established does not read as a full-score move', () => {
  // previousScore null must drop the holding from the movers list entirely.
  // Treated as zero it would report a brand-new holding as "+66".
  const alert = buildDigest({
    listName: 'W',
    holdings: [
      { ticker: 'NEW', healthScore: 66, previousScore: null },
      { ticker: 'OLD', healthScore: 70, previousScore: 65 }
    ]
  });
  assert.ok(!alert.body.includes('NEW'), 'an unbaselined holding is not a mover');
  assert.match(alert.body, /OLD \+5/);
});
