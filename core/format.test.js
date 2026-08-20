/**
 * `fixed` against V8's `toFixed`.
 *
 * This suite runs under Node, where `toFixed` is spec-conformant, so V8 is a
 * usable oracle. If `fixed` matches it everywhere in range, then replacing
 * `toFixed` throughout `core/` changes nothing about what the PWA renders —
 * while making the Android client render the same thing, which it currently
 * does not.
 *
 * The differential sweep is the real test. The named cases below it exist so a
 * failure says which property broke rather than only that some value differed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fixed, round } from './format.js';

test('the tie cases Android gets wrong', () => {
  // Measured on device: Android QuickJS returns 4.2, 0.12 and 2 for these.
  assert.equal(fixed(4.25, 1), '4.3');
  assert.equal(fixed(0.125, 2), '0.13');
  assert.equal(fixed(2.5, 0), '3');
  assert.equal(fixed(8.75, 1), '8.8');
  assert.equal(fixed(3.375, 2), '3.38');
});

test('a value that only looks like a tie is not treated as one', () => {
  // 1.005 is below the midpoint in binary, so every conforming engine renders
  // it 1.00. Reproducing that is as important as getting the true ties right.
  assert.equal(fixed(1.005, 2), (1.005).toFixed(2));
  assert.equal(fixed(1.005, 2), '1.00');
  assert.equal(fixed(8.165, 2), (8.165).toFixed(2));
});

test('differential sweep against V8 over the app\'s working range', () => {
  const mismatches = [];
  const check = (value, digits) => {
    const mine = fixed(value, digits);
    const v8 = value.toFixed(digits);
    if (mine !== v8) mismatches.push(`fixed(${value}, ${digits}) = ${mine}, toFixed = ${v8}`);
  };

  // Exhaustive over small decimals, where ties actually occur.
  for (let i = -20000; i <= 20000; i++) {
    const v = i / 8; // eighths are exactly representable, so ties are real
    check(v, 0);
    check(v, 1);
    check(v, 2);
  }

  // Deterministic pseudo-random spread across magnitudes the app produces:
  // ratios, percentages, and money up to trillions.
  let seed = 20260820;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 40000; i++) {
    const magnitude = 10 ** Math.floor(rand() * 13 - 4); // 1e-4 .. 1e8
    const v = (rand() - 0.5) * 2 * magnitude;
    check(v, Math.floor(rand() * 5));
  }

  assert.deepEqual(
    mismatches.slice(0, 10),
    [],
    `${mismatches.length} values disagree with V8`
  );
});

test('values sitting on a decimal midpoint match V8', () => {
  // The case an earlier implementation got wrong. Scaling by a power of ten
  // before rounding is not faithful: 61.555 is below its midpoint but
  // 61.555 * 100 lands above it, so the value rounded up where every
  // conforming engine rounds it down. It reached a golden fixture as a
  // one-cent difference in a cash balance, which is exactly how a formatting
  // bug hides.
  const mismatches = [];
  for (let whole = 0; whole < 400; whole++) {
    for (let thousandths = 5; thousandths < 1000; thousandths += 10) {
      const v = whole + thousandths / 1000;
      for (const d of [1, 2]) {
        const mine = fixed(v, d);
        const v8 = v.toFixed(d);
        if (mine !== v8) mismatches.push(`fixed(${v}, ${d}) = ${mine}, toFixed = ${v8}`);
      }
    }
  }
  assert.deepEqual(
    mismatches.slice(0, 10),
    [],
    `${mismatches.length} midpoint values disagree with V8`
  );
});

test('the exact value from the AAPL fixture still rounds down', () => {
  // 61.555 to two places is 61.55, because the double nearest 61.555 is below
  // the midpoint. Pinned because getting it wrong moved a real cash figure.
  assert.equal(fixed(61.555, 2), '61.55');
  assert.equal(fixed(61.555, 2), (61.555).toFixed(2));
});

test('zero, negative zero and small negatives match V8', () => {
  for (const [v, d] of [[0, 0], [0, 2], [-0, 2], [-0.0001, 2], [-0.5, 0], [-1.5, 0]]) {
    assert.equal(fixed(v, d), v.toFixed(d), `fixed(${v}, ${d})`);
  }
});

test('non-finite values match V8', () => {
  assert.equal(fixed(NaN, 2), (NaN).toFixed(2));
  assert.equal(fixed(Infinity, 2), (Infinity).toFixed(2));
  assert.equal(fixed(-Infinity, 2), (-Infinity).toFixed(2));
});

test('very large values defer to the default representation, as toFixed does', () => {
  assert.equal(fixed(1e21, 2), (1e21).toFixed(2));
  assert.equal(fixed(1.5e22, 2), (1.5e22).toFixed(2));
});

test('an out-of-range digit count is refused rather than guessed at', () => {
  assert.throws(() => fixed(1, -1), RangeError);
  assert.throws(() => fixed(1, 21), RangeError);
});

test('round returns the number the string would parse to', () => {
  assert.equal(round(4.25, 1), 4.3);
  assert.equal(round(2.5, 0), 3);
  assert.equal(round(-1.25, 1), -1.3);
  assert.equal(round(1.005, 2), 1);
});
