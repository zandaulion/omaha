/**
 * Pocket Omaha — the alert sweep, for embedded hosts.
 *
 * Bundled and handed to QuickJS. The PWA server calls `core/alerts/*` directly
 * from Node and never loads this file, exactly as it never loads `host/stock.js`
 * — this is an adapter, not a second implementation. What it adapts is the one
 * awkward part of a sweep: the decisions are interleaved with I/O, so neither
 * side can own the whole loop.
 *
 * The split is per **ticker**. The host iterates its watchlist and persists what
 * comes back; everything it does between those two acts is decided here —
 * whether the fetched data is fit to compare, which alerts fired, whether each
 * has fired too recently, and what the next comparison will need to have kept.
 * The host's remaining freedom is to stop when told to.
 *
 * One ticker per call rather than one sweep per call, deliberately. Every call
 * builds a fresh interpreter (see `JsBridge`), and on Android the engine is
 * serialised process-wide — so a whole sweep in one call would hold the lock
 * for tickers x ~2s with the watchlist frozen behind it if someone opened the
 * app mid-sweep. Per ticker, a foreground read waits for one company at worst.
 */

import { stock } from './stock.js';
import { evaluateTriggers } from '../alerts/triggers.js';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DIGEST_HOUR,
  DIGEST_WEEKDAY,
  SWEEP_INTERVAL_MS,
  SWEEP_SPACING_MS,
  buildDigest,
  isSweepAbandonError,
  isWithinCooldown,
  rollBaseline,
  snapshotOf,
  sweepDecision
} from '../alerts/sweep.js';

/**
 * Call a host function, passing and receiving JSON.
 *
 * Same contract as `host/stock.js`: an empty reply is `null` rather than a
 * parse error, because "nothing stored" is the commonest answer a store gives.
 */
async function host(name, payload) {
  const fn = globalThis[name];
  if (typeof fn !== 'function') {
    throw new Error(`Host did not provide ${name}`);
  }
  const raw = await fn(JSON.stringify(payload));
  if (raw === undefined || raw === null || raw === '') return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/**
 * What is on before anybody has chosen.
 *
 * Exported so a host can seed its own settings row from here rather than
 * writing the five booleans down a second time. A default that differs between
 * clients is not a difference either client can see.
 */
export function defaults() {
  return DEFAULT_NOTIFICATION_SETTINGS;
}

/** The pause a host should leave between tickers, so it need not hardcode it. */
export function spacingMs() {
  return SWEEP_SPACING_MS;
}

/** How often to sweep, in milliseconds. Four times a day. */
export function intervalMs() {
  return SWEEP_INTERVAL_MS;
}

/**
 * When the weekly digest is due.
 *
 * `weekday` is JavaScript's numbering — 0 is Sunday — which a host reading it
 * has to convert rather than assume. Returned rather than duplicated because a
 * digest arriving on Sunday in one client and Monday in the other is a
 * difference a person would notice and nobody would think to test.
 */
export function digestSlot() {
  return { weekday: DIGEST_WEEKDAY, hour: DIGEST_HOUR };
}

/**
 * Sweep one ticker.
 *
 * @param {string} ticker
 * @param {object} settings the five `notify_*` flags
 * @returns {Promise<{
 *   ticker: string,
 *   action: 'evaluated'|'skipped'|'abandon',
 *   reason: string|null,
 *   alerts: object[],
 *   suppressed: string[],
 *   snapshot: object|null
 * }>}
 *
 * `snapshot` is returned rather than written through a host function so the
 * host can persist it in the same transaction as the history rows. A sweep
 * that recorded an alert and then failed to update the snapshot would fire the
 * identical alert on the next pass, six hours later — and the cooldown would
 * hide it, which is worse: the record would be right and the reason wrong.
 *
 * It is also null whenever `action` is not `evaluated`. Writing a snapshot
 * from data served stale would overwrite a good baseline with a copy of
 * itself, and the next comparison would be made against a reading it believes
 * is current.
 */
export async function sweepTicker(ticker, settings) {
  const result = await stock(ticker);

  if (!result.ok) {
    // A rate limit applies to the endpoint, not to the ticker that happened to
    // hit it. Continuing would send another request every 1.2 seconds into the
    // block that just rejected us.
    if (isSweepAbandonError(result.error)) {
      return done(ticker, 'abandon', 'rate_limited');
    }
    return done(ticker, 'skipped', result.error?.kind ?? 'unknown');
  }

  const data = result.data;
  const decision = sweepDecision(data);
  if (decision === 'abandon') return done(ticker, 'abandon', 'rate_limited');
  if (decision === 'skip') return done(ticker, 'skipped', data?.staleReason ?? 'stale');

  const prev = await host('__alertSnapshotRead', { ticker });

  const alerts = [];
  const suppressed = [];
  for (const alert of evaluateTriggers(data, prev, settings)) {
    const last = await host('__alertLastDelivered', {
      type: alert.type,
      ticker: alert.ticker || ''
    });
    if (isWithinCooldown(alert, last?.at ?? null)) {
      suppressed.push(`${alert.ticker} ${alert.type}`);
      continue;
    }
    alerts.push(alert);
  }

  // The digest's comparison point rides along inside the snapshot rather than
  // in a field of its own, so a host that stores the blob verbatim gets it for
  // free. It is derived from `prev` — the reading about to be replaced — which
  // is why it has to be computed here, before the new snapshot exists.
  const baseline = rollBaseline(prev, new Date().toISOString());

  return {
    ticker,
    action: 'evaluated',
    reason: null,
    alerts,
    suppressed,
    snapshot: {
      ...snapshotOf(data),
      week_ago_score: baseline.score,
      week_ago_at: baseline.at
    }
  };
}

function done(ticker, action, reason) {
  return { ticker, action, reason, alerts: [], suppressed: [], snapshot: null };
}

/**
 * The Sunday summary, from rows the host has already stored.
 *
 * Composed here so both clients say the same thing; the host supplies the rows
 * and applies the cooldown, because it is the one holding the history.
 *
 * @param {{listName: string, holdings: object[]}} input
 */
export function digest(input) {
  return buildDigest(input);
}

/**
 * Is this alert still inside its cooldown window?
 *
 * Exposed for the digest, which the host composes and dispatches outside
 * `sweepTicker`. Kept on this side so there is one table of windows.
 */
export function cooledDown(alert, lastDeliveredAt) {
  return isWithinCooldown(alert, lastDeliveredAt ?? null);
}
