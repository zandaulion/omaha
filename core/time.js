/**
 * Pocket Omaha — timestamp parsing that gives the same answer everywhere.
 *
 * Two formats reach this module from storage. SQLite's `datetime('now')`
 * writes `YYYY-MM-DD HH:MM:SS` in UTC with no timezone marker, and several
 * paths write `toISOString()` instead — so the same column can hold either.
 *
 * `new Date(str)` cannot be used on the first form. The specification leaves
 * non-ISO strings implementation-defined; V8 reads `YYYY-MM-DD HH:MM:SS` as
 * *local* time, so a UTC timestamp comes back shifted by the machine's offset,
 * and QuickJS may decline to parse it at all. That is not a theoretical
 * portability concern — it silently broke the cache tiers in `finance.js`,
 * where an age inflated by the local offset made the fifteen-minute quote
 * cache unreachable on any machine east of UTC.
 *
 * Everything here is parsed by hand into `Date.UTC` rather than handed to
 * `Date.parse`, because the whole point is not to depend on the engine.
 */

/**
 * `YYYY-MM-DD`, optionally followed by a time separated by `T` or a space,
 * optionally followed by `Z` or a `±HH:MM` offset.
 */
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3})\d*)?)?(Z|z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parse a stored timestamp to epoch milliseconds.
 *
 * A value with no timezone marker is read as **UTC**, which is what both
 * writers produce. Returns `null` for anything unparseable — callers must
 * treat that as "unknown age" rather than "age zero", since a missing
 * timestamp read as `now` would mark stale data fresh.
 *
 * @param {string|number|Date|null|undefined} value
 * @returns {number|null} epoch ms, or null
 */
export function parseTimestamp(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const m = TIMESTAMP.exec(raw);
  if (!m) return null;

  const [, y, mo, d, hh, mm, ss, ms, zone] = m;

  let at = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh || 0),
    Number(mm || 0),
    Number(ss || 0),
    Number((ms || '').padEnd(3, '0') || 0)
  );
  if (!Number.isFinite(at)) return null;

  // An explicit offset means the wall-clock reading above was in that zone.
  if (zone && zone !== 'Z' && zone !== 'z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const offsetMin =
      Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0);
    at -= sign * offsetMin * 60_000;
  }

  return at;
}

/**
 * Age of a stored timestamp in minutes.
 *
 * Returns `Infinity` when the timestamp cannot be read, so that an unparseable
 * value fails towards "stale" and triggers a refetch, rather than towards
 * "fresh" and serves data of unknown age indefinitely.
 *
 * @param {string|number|Date|null|undefined} value
 * @param {number} [nowMs]
 * @returns {number}
 */
export function minutesSince(value, nowMs = Date.now()) {
  const at = parseTimestamp(value);
  if (at === null) return Infinity;
  return (nowMs - at) / 60_000;
}
