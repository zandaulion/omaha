/**
 * Pocket Omaha — decimal formatting that does not depend on the platform.
 *
 * `Number.prototype.toFixed` is not portable. Measured across three engines
 * running this same code:
 *
 *   value              Node (V8)   QuickJS/JVM   QuickJS/Android
 *   (4.25).toFixed(1)     4.3          4.3            4.2
 *   (0.125).toFixed(2)    0.13         0.13           0.12
 *   (2.5).toFixed(0)      3            3              2
 *
 * ECMAScript is unambiguous about which is right — of the two candidate
 * results for a tie, "pick the larger n" — so Android's build is deviating
 * from spec rather than expressing a preference. The cause is that QuickJS
 * hands decimal conversion to the platform's C library, and Bionic rounds
 * half-to-even where the others round half-away-from-zero.
 *
 * This matters here beyond pedantry. The two clients must show the same
 * number for the same company: "ROIC of 4.3%" on one and "4.2%" on the other
 * is a visible contradiction between two apps claiming to measure the same
 * thing, and it appears in risk text and checklist values that people read.
 *
 * The way out is to never ask the platform. IEEE 754 *arithmetic* is exactly
 * specified and identical on every engine; only decimal *formatting* varies.
 * So round with arithmetic, then build the string from an integer, which
 * converts exactly everywhere.
 */

const BITS = new DataView(new ArrayBuffer(8));

/**
 * Split a finite positive double into the exact integers `m` and `e` such that
 * the value is precisely `m * 2 ** e`.
 *
 * Every double is exactly a dyadic rational, so this loses nothing — which is
 * the entire point. Reading the bits is the only portable way to get at that
 * value without going through a decimal conversion, and decimal conversion is
 * the thing that is not portable.
 *
 * @returns {{m: bigint, e: number}}
 */
function decompose(magnitude) {
  BITS.setFloat64(0, magnitude);
  const hi = BITS.getUint32(0);
  const lo = BITS.getUint32(4);

  const biasedExponent = (hi >>> 20) & 0x7ff;
  const fraction = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);

  // Subnormals carry no implicit leading bit and share the smallest exponent.
  if (biasedExponent === 0) return { m: fraction, e: -1074 };
  return { m: fraction | (1n << 52n), e: biasedExponent - 1075 };
}

/**
 * `round(magnitude * 10 ** digits)`, exactly, with ties going away from zero.
 *
 * Done in integer arithmetic rather than by scaling the double, because
 * scaling is not faithful: `61.555 * 100` lands just above the midpoint even
 * though 61.555 itself is just below it, which would round a value up that
 * every conforming engine rounds down. That defect was real and was caught by
 * a golden fixture — see `format.test.js`.
 *
 * @returns {bigint}
 */
function roundScaled(magnitude, digits) {
  const { m, e } = decompose(magnitude);
  const numerator = m * 10n ** BigInt(digits);

  // A non-negative binary exponent means the scaled value is already an
  // integer; there is nothing to round.
  if (e >= 0) return numerator << BigInt(e);

  const denominator = 1n << BigInt(-e);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  // Compare 2r against the denominator to avoid dividing: 2r > d is "above the
  // midpoint", 2r === d is exactly the midpoint. Both round up in magnitude,
  // which for a positive magnitude is away from zero — the rule ECMAScript
  // states and Android's libc does not follow.
  const doubled = remainder * 2n;
  return doubled >= denominator ? quotient + 1n : quotient;
}

/**
 * Format a number with a fixed number of decimal places.
 *
 * A drop-in replacement for `toFixed` in the range this app uses — ratios,
 * percentages and money — verified against V8 case by case in `format.test.js`.
 *
 * @param {number} value
 * @param {number} [digits] 0–20
 * @returns {string}
 */
export function fixed(value, digits = 0) {
  const d = Math.trunc(digits);
  if (d < 0 || d > 20) throw new RangeError('digits must be between 0 and 20');

  const x = Number(value);
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';

  // Above 1e21 `toFixed` gives up and returns the default representation.
  // Match that rather than inventing a different answer at the boundary.
  if (Math.abs(x) >= 1e21) return String(x);

  const negative = x < 0;
  const n = roundScaled(Math.abs(x), d);

  let s = n.toString();
  if (d > 0) {
    s = s.padStart(d + 1, '0');
    s = `${s.slice(0, s.length - d)}.${s.slice(s.length - d)}`;
  }

  // A strictly negative input keeps its sign even when it rounds to zero:
  // `-0.00` says "small and negative", which is information worth preserving.
  // Negative zero is not strictly negative and renders unsigned, as toFixed does.
  return negative ? `-${s}` : s;
}

/**
 * Round to a number rather than a string, with the same tie rule.
 *
 * For the many places that do `Number(x.toFixed(2))` — going through a string
 * only to parse it back. Same guarantees, one step.
 *
 * @param {number} value
 * @param {number} [digits]
 * @returns {number}
 */
export function round(value, digits = 0) {
  const s = fixed(value, digits);
  return Number(s);
}
