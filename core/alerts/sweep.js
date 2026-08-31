/**
 * Pocket Omaha — sweep policy: what to capture, when to stop, when to repeat.
 *
 * `triggers.js` answers "is this a real fundamental change?". This module
 * answers the questions around it — which fields a snapshot has to carry for
 * the next comparison to be possible, how often the same alert may repeat, and
 * when a sweep should give up rather than keep asking. Both are policy, and
 * both were previously only in `server/alerts.js`, which is a problem the
 * moment a second client sweeps: a cooldown of 14 days on one host and 3 on the
 * other is not a bug either host can see.
 *
 * Pure, like `triggers.js`. Nothing here reads a database, a clock it was not
 * given, or a network. Storage, scheduling and delivery differ per host and are
 * meant to; the judgements do not.
 */

/**
 * What is on by default, before anybody has chosen.
 *
 * Capital returns is the one that starts off. A buyback stepping up is
 * interesting, not urgent, and an alert nobody acts on is how the other four
 * get ignored too.
 */
export const DEFAULT_NOTIFICATION_SETTINGS = {
  notify_earnings_filings: 1,
  notify_red_flags: 1,
  notify_margin_of_safety: 1,
  notify_capital_returns: 0,
  notify_sunday_digest: 1
};

/**
 * Minimum days between repeats of the same alert type for the same ticker.
 *
 * A standing condition is not an event. "PEG below 1.3" stays true for months,
 * and without a floor here every sweep re-announces it — which is how NU and
 * PATH sent eight identical notifications in two hours. The per-trigger edge
 * guards in `triggers.js` are the primary defence; this is the backstop that
 * also covers process restarts and reinstalls, each of which runs a catch-up
 * sweep against a history the triggers cannot see.
 */
export const COOLDOWN_DAYS = {
  MARGIN_OF_SAFETY: 14,
  CAPITAL_RETURN: 14,
  RED_FLAG_WARNING: 3,
  EARNINGS_HEALTH_SHIFT: 1,
  WEEKLY_DIGEST: 6
};

export const DEFAULT_COOLDOWN_DAYS = 3;

/** Four sweeps a day. Filings arrive quarterly; this is already generous. */
export const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Pause between tickers within one sweep.
 *
 * Yahoo rate-limits a burst, and a throttled sweep produces false
 * "unavailable" states — which would then be read as a coverage change and
 * suppressed by `triggers.js`, so the cost of going too fast is a sweep that
 * silently does nothing rather than one that visibly fails.
 */
export const SWEEP_SPACING_MS = 1200;

export const DIGEST_WEEKDAY = 0; // Sunday
export const DIGEST_HOUR = 9;

/** A health move smaller than this is not worth naming in the digest. */
export const DIGEST_MOVER_THRESHOLD = 2;

/**
 * How old the digest's comparison point is allowed to get before it is reset.
 *
 * Six rather than seven so the roll always lands on the sweep *before* the next
 * Sunday rather than the one after it. A seven-day window checked weekly rolls
 * on alternate Sundays half the time, and the digest would then compare across
 * a fortnight while saying "this week".
 */
export const DIGEST_BASELINE_DAYS = 6;

// -------------------------------------------------------------- snapshots

/**
 * Project a scored stock down to the fields the next comparison needs.
 *
 * This is the other half of `evaluateTriggers`, and the two have to agree:
 * every `prev.*` the triggers read must be a key this produces, spelled the
 * same way. They are `snake_case` because the server's `stock_snapshots` row
 * is passed straight in as `prev`, and renaming them here would mean the
 * triggers silently compare against `undefined` — which reads as "not both
 * numbers" and disables the rule rather than failing.
 *
 * @param {object} stock a scored stock, as `getStockData` returns it
 * @returns {object} a flat, JSON-safe snapshot; `checklist` is an id→status map
 */
export function snapshotOf(stock) {
  const m = stock?.summary?.metrics || {};

  return {
    ticker: stock?.ticker ?? null,
    health_score: stock?.health_score ?? null,
    checklist: Object.fromEntries(
      (stock?.checklist || []).map((c) => [c.id, c.status])
    ),
    altman_z: stock?.altman_z ?? null,
    piotroski_score: stock?.piotroski_score ?? null,
    current_ratio: m.currentRatio ?? null,
    gross_margin: m.grossMargin ?? null,
    // Only a P/E history long enough to mean something is carried forward. A
    // percentile over four quarters is not a valuation range, and letting one
    // through would make `MARGIN_OF_SAFETY` fire on earnings recovering off a
    // trough — the cheap-looking case that is not cheap.
    pe_percentile:
      stock?.summary?.peHistory?.scoreable === true
        ? stock.summary.peHistory.percentile ?? null
        : null,
    peg_ratio: m.pegRatio ?? null,
    share_change: m.shareChangeYoY ?? null
  };
}

// --------------------------------------------------------------- cooldown

export function cooldownDays(alertType) {
  return COOLDOWN_DAYS[alertType] ?? DEFAULT_COOLDOWN_DAYS;
}

/**
 * Has this exact alert already gone out recently?
 *
 * @param {{type: string}} alert
 * @param {string|number|Date|null} lastDeliveredAt when the same type last
 *   fired for the same ticker, or null if it never has
 * @param {number} [nowMs]
 * @returns {boolean} true if it is too soon to repeat
 *
 * An unreadable timestamp counts as **not** within cooldown. The alternative
 * fails towards silence, and a rule whose failure mode is "no alerts, no
 * message" is one nobody would notice was broken.
 */
export function isWithinCooldown(alert, lastDeliveredAt, nowMs = Date.now()) {
  if (lastDeliveredAt === null || lastDeliveredAt === undefined) return false;
  const at = parseStamp(lastDeliveredAt);
  if (at === null) return false;
  return nowMs - at < cooldownDays(alert?.type) * 86_400_000;
}

/**
 * A stored timestamp to epoch ms.
 *
 * Deliberately a local copy of `core/time.js`'s parser rather than an import:
 * this module is bundled into a QuickJS host where `Date.parse` on SQLite's
 * `YYYY-MM-DD HH:MM:SS` is either shifted by the local offset or refused
 * outright. See that file's header — the same defect once made the
 * fifteen-minute quote cache unreachable east of UTC.
 */
function parseStamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;

  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|z)?$/
    .exec(String(value).trim());
  if (!m) return null;

  const at = Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
  );
  return Number.isFinite(at) ? at : null;
}

// ------------------------------------------------------------ sweep control

/**
 * What to do with one fetched stock.
 *
 * `abandon` is the important one and the least obvious. A rate limit applies to
 * the endpoint, not to the ticker that happened to hit it; continuing down the
 * watchlist sends another request every 1.2 seconds into the block that just
 * rejected us, which is how a transient limit becomes a sustained one. The next
 * sweep is six hours out and will find the same filings.
 *
 * `skip` covers data served from cache because the upstream was unreachable.
 * Evaluating triggers against a record we already scored would compare a
 * snapshot with itself, which produces nothing — but it would also overwrite
 * the snapshot with itself, and that is not free: the next sweep's comparison
 * would then be against a stale baseline it believes is current.
 *
 * @param {object|null} stock
 * @returns {'evaluate'|'skip'|'abandon'}
 */
export function sweepDecision(stock) {
  if (!stock) return 'skip';
  if (stock.staleReason === 'rate_limited') return 'abandon';
  if (stock.stale) return 'skip';
  return 'evaluate';
}

/**
 * True when a caught error means the endpoint, not this ticker, said no.
 *
 * @param {{kind?: string}|null} err
 */
export function isSweepAbandonError(err) {
  return err?.kind === 'rate_limited';
}

/**
 * The score to compare this Sunday's reading against.
 *
 * Needed because a snapshot is overwritten on every sweep, so by the time the
 * digest runs, "the previous snapshot" is four to six hours old, not a week.
 * Both clients previously computed movers as `current - previousSnapshot`,
 * which is a difference of zero by construction: the sweep writes the cache
 * and the snapshot from the same fetch. Every digest either client could have
 * produced would have said "no material health changes this week", correctly
 * according to its arithmetic and wrongly about the world.
 *
 * So a second, slower-moving reading is carried alongside. It is adopted from
 * whatever the snapshot held *before* this sweep — the last reading that was
 * genuinely earlier — and then left alone until it ages out.
 *
 * @param {{health_score?: number|null, week_ago_score?: number|null,
 *   week_ago_at?: string|null}|null} previous the stored snapshot, before this
 *   sweep overwrites it
 * @param {string} nowIso
 * @returns {{score: number|null, at: string|null}} the baseline to store
 */
export function rollBaseline(previous, nowIso) {
  const held = previous?.week_ago_score ?? null;
  const heldAt = previous?.week_ago_at ?? null;

  // The clock comes from `nowIso` rather than `Date.now()`, so this stays as
  // testable as everything else here and cannot disagree with the timestamp it
  // is about to write.
  const nowMs = parseStamp(nowIso) ?? Date.now();
  const heldAtMs = heldAt === null ? null : parseStamp(heldAt);
  const age = heldAtMs === null ? Infinity : nowMs - heldAtMs;
  const stale = heldAt === null || age >= DIGEST_BASELINE_DAYS * 86_400_000;

  if (!stale) return { score: held, at: heldAt };

  // Adopt the reading being replaced. On the very first sweep there is none,
  // and the baseline stays null — which `buildDigest` reads as "no comparison
  // possible" and omits from the movers rather than treating as a change of
  // the full score.
  const adopting = previous?.health_score ?? null;
  return adopting === null ? { score: null, at: null } : { score: adopting, at: nowIso };
}

// ----------------------------------------------------------------- digest

/**
 * Ranked score movers within a set of holdings.
 *
 * Extracted from `buildDigest`, 2026-08-29, so the Android widget can show
 * the same ranked list the Sunday digest names in prose, without a second
 * definition of "worth naming" — a future change to the threshold or the
 * sort here reaches both callers, rather than one of them silently
 * disagreeing with the other about the same list on the same day.
 *
 * @param {Array<{ticker: string, healthScore: number, previousScore?: number|null}>} holdings
 * @returns {Array<{ticker: string, delta: number}>} sorted by |delta|, largest first
 */
export function movers(holdings) {
  return (holdings || [])
    .filter((r) => typeof r.healthScore === 'number' && typeof r.previousScore === 'number')
    .map((r) => ({ ticker: r.ticker, delta: r.healthScore - r.previousScore }))
    .filter((mv) => Math.abs(mv.delta) >= DIGEST_MOVER_THRESHOLD)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/**
 * The Sunday summary, from holdings already scored during the week's sweeps.
 *
 * Deliberately reads the cache rather than re-fetching. A digest that triggers
 * twenty cold ingests at 09:00 on a Sunday is a good way to be rate-limited
 * every Sunday at 09:01, and nothing in a weekly summary needs a fresher number
 * than the last sweep six hours ago.
 *
 * @param {{listName: string, holdings: Array<{ticker: string, healthScore: number,
 *   marketCap?: number|null, previousScore?: number|null}>}} input
 * @returns {object|null} an alert in the same shape `triggers.js` produces, or
 *   null when there is nothing scored to summarise
 */
export function buildDigest({ listName, holdings } = {}) {
  const rows = (holdings || []).filter((h) => typeof h.healthScore === 'number');
  if (!rows.length) return null;

  // Capitalisation-weighted where caps are known, because an equal weighting
  // lets the smallest holding move the headline number as much as the largest.
  // Falls back to a plain mean rather than to zero when no cap is available.
  const totalCap = rows.reduce((s, r) => s + (r.marketCap || 0), 0);
  const composite = totalCap
    ? Math.round(rows.reduce((s, r) => s + r.healthScore * (r.marketCap || 0), 0) / totalCap)
    : Math.round(rows.reduce((s, r) => s + r.healthScore, 0) / rows.length);

  const rowMovers = movers(rows);

  const moverText = rowMovers.length
    ? ` Movers: ${rowMovers.slice(0, 3).map((mv) => `${mv.ticker} ${mv.delta > 0 ? '+' : ''}${mv.delta}`).join(', ')}.`
    : ' No material health changes this week.';

  return {
    type: 'WEEKLY_DIGEST',
    ticker: '',
    title: `🎩 ${listName}: ${composite}/100`,
    body: `${rows.length} holdings scored.${moverText}`,
    severity: 'info',
    url: '/?tab=watchlist'
  };
}
