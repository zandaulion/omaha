/**
 * Pocket Omaha — alert rules engine and dispatch worker.
 *
 * Implements the four triggers from the notification spec. Every alert is
 * evaluated against the previous evaluation of the same ticker, so the engine
 * needs a stored snapshot per stock; that is what `stock_snapshots` holds.
 *
 * Nothing here fires on a metric that could not be measured. An indicator
 * moving from a real value to "unavailable" is a data-coverage change, not a
 * fundamental one, and waking someone for it would train them to ignore alerts.
 */

import { db } from './db.js';
import { getStockData } from './finance.js';
import { broadcastPush } from './push.js';
import { minutesSince } from '../core/time.js';
import { evaluateTriggers } from '../core/alerts/triggers.js';
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
} from '../core/alerts/sweep.js';

// The rules themselves are pure and live in core/, so the Android host can run
// exactly the same ones. Re-exported here because the route layer has always
// reached for them at this path.
export { evaluateTriggers };


/**
 * Cooldowns, sweep cadence and the digest slot now live in
 * `core/alerts/sweep.js`, next to the trigger rules, so the Android client
 * sweeps on the same policy rather than on a second copy of it that nobody
 * would notice had drifted.
 */

let sweepTimer = null;
let digestTimer = null;

// ---------------------------------------------------------------- settings

const DEFAULT_SETTINGS = DEFAULT_NOTIFICATION_SETTINGS;

export function getNotificationSettings() {
  const row = db.prepare('SELECT * FROM notification_settings WHERE id = 1').get();
  if (!row) {
    db.prepare(
      `INSERT INTO notification_settings
       (id, notify_earnings_filings, notify_red_flags, notify_margin_of_safety,
        notify_capital_returns, notify_sunday_digest)
       VALUES (1, ?, ?, ?, ?, ?)`
    ).run(
      DEFAULT_SETTINGS.notify_earnings_filings,
      DEFAULT_SETTINGS.notify_red_flags,
      DEFAULT_SETTINGS.notify_margin_of_safety,
      DEFAULT_SETTINGS.notify_capital_returns,
      DEFAULT_SETTINGS.notify_sunday_digest
    );
    return { id: 1, ...DEFAULT_SETTINGS };
  }
  return row;
}

export function updateNotificationSettings(patch) {
  getNotificationSettings();
  const fields = Object.keys(DEFAULT_SETTINGS).filter((k) => k in patch);
  if (!fields.length) return getNotificationSettings();

  db.prepare(
    `UPDATE notification_settings
     SET ${fields.map((f) => `${f} = ?`).join(', ')}
     WHERE id = 1`
  ).run(...fields.map((f) => (patch[f] ? 1 : 0)));

  return getNotificationSettings();
}

// --------------------------------------------------------------- snapshots

function readSnapshot(ticker) {
  const row = db.prepare('SELECT * FROM stock_snapshots WHERE ticker = ?').get(ticker);
  if (!row) return null;
  try {
    return { ...row, checklist: JSON.parse(row.checklist_json || '{}') };
  } catch {
    return { ...row, checklist: {} };
  }
}

/**
 * The row is written from `snapshotOf`, so the columns and the fields the
 * triggers read cannot drift apart. `captured_at` stays SQL's, because it is
 * the one value the store is better placed to supply than the caller.
 */
function writeSnapshot(ticker, stock, previous) {
  const snap = snapshotOf(stock);
  // Derived from the row being replaced, so it has to be read before the
  // write. See rollBaseline: without a slower-moving reading, every digest
  // compares this sweep against itself.
  const baseline = rollBaseline(previous, new Date().toISOString());

  db.prepare(
    `INSERT INTO stock_snapshots
       (ticker, health_score, checklist_json, altman_z, piotroski_score,
        current_ratio, gross_margin, pe_percentile, peg_ratio, share_change,
        week_ago_score, week_ago_at, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(ticker) DO UPDATE SET
       health_score=excluded.health_score,
       checklist_json=excluded.checklist_json,
       altman_z=excluded.altman_z,
       piotroski_score=excluded.piotroski_score,
       current_ratio=excluded.current_ratio,
       gross_margin=excluded.gross_margin,
       pe_percentile=excluded.pe_percentile,
       peg_ratio=excluded.peg_ratio,
       share_change=excluded.share_change,
       week_ago_score=excluded.week_ago_score,
       week_ago_at=excluded.week_ago_at,
       captured_at=datetime('now')`
  ).run(
    ticker,
    snap.health_score,
    JSON.stringify(snap.checklist),
    snap.altman_z,
    snap.piotroski_score,
    snap.current_ratio,
    snap.gross_margin,
    snap.pe_percentile,
    snap.peg_ratio,
    snap.share_change,
    baseline.score,
    baseline.at
  );
}


// ------------------------------------------------------------- dispatching

/**
 * Has this exact alert already gone out recently?
 *
 * The edge guards in `triggers.js` stop a standing condition re-firing, but a
 * metric that oscillates around a threshold would still ring repeatedly, and
 * every process restart runs a catch-up sweep. This is the floor under both.
 *
 * The window itself is `core/alerts/sweep.js`'s to decide. SQL only supplies
 * the timestamp, because "when did this last fire" is a storage question and
 * "is that too soon" is a policy one — and only the second has to match on the
 * client that has no SQL.
 */
function withinCooldown(alert) {
  const row = db
    .prepare(
      `SELECT MAX(delivered_at) AS at FROM notification_history
       WHERE alert_type = ?
         AND COALESCE(ticker, '') = COALESCE(?, '')`
    )
    .get(alert.type, alert.ticker || '');
  return isWithinCooldown(alert, row?.at ?? null);
}

function recordAndSend(alert) {
  db.prepare(
    `INSERT INTO notification_history (ticker, alert_type, title, body, severity, url, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(alert.ticker, alert.type, alert.title, alert.body, alert.severity, alert.url);

  return broadcastPush({
    title: alert.title,
    body: alert.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    // One bubble per ticker per alert type; the weekly digest has no ticker so
    // it gets a key of its own rather than colliding on an empty one.
    tag: alert.ticker ? `${alert.type}:${alert.ticker}` : alert.type,
    data: { url: alert.url, type: alert.type, ticker: alert.ticker, severity: alert.severity }
  });
}

/** Every ticker on any watchlist — the set the user has asked to be told about. */
function watchedTickers() {
  const lists = db.prepare('SELECT tickers_json FROM watchlists').all();
  const set = new Set();
  for (const l of lists) {
    try {
      for (const t of JSON.parse(l.tickers_json || '[]')) set.add(t);
    } catch {
      // skip malformed rows
    }
  }
  return [...set];
}

/**
 * Refresh every watched stock, compare against its last snapshot, dispatch
 * whatever fired. Runs sequentially with a small delay: Yahoo rate-limits a
 * burst, and a sweep that gets throttled produces false "unavailable" states.
 */
export async function runSweep({ quiet = false } = {}) {
  const settings = getNotificationSettings();
  const tickers = watchedTickers();
  const fired = [];
  const suppressed = [];

  for (const ticker of tickers) {
    try {
      // Deliberately *not* a forced refresh. Forcing bypassed both cache
      // tiers, so every sweep re-fetched the full statement history — four
      // requests per holding, four times a day, for filings that change once a
      // quarter. Letting the TTLs apply still gives the sweep a current quote
      // (the 15-minute tier has always expired across a 6-hour gap) while
      // re-reading statements only once a day, which is the whole point of
      // having tiered TTLs.
      const stock = await getStockData(ticker);

      // Whether to evaluate, skip or give up is `core/alerts/sweep.js`'s call,
      // so the Android sweep abandons on the same conditions. A rate limit
      // applies to the endpoint, not to the ticker that happened to hit it.
      const decision = sweepDecision(stock);
      if (decision === 'abandon') {
        console.warn(`[Alerts] Sweep abandoned at ${ticker}: upstream rate-limited.`);
        break;
      }
      if (decision === 'skip') continue;

      const prev = readSnapshot(ticker);
      for (const alert of evaluateTriggers(stock, prev, settings)) {
        if (withinCooldown(alert)) {
          suppressed.push(`${alert.ticker} ${alert.type}`);
          continue;
        }
        fired.push(alert);
        await recordAndSend(alert);
      }
      writeSnapshot(ticker, stock, prev);
    } catch (err) {
      // A rate limit applies to the endpoint, not to this ticker. Continuing
      // down the watchlist would send another request every 1.2 seconds into
      // the block that just rejected us, which is how a transient limit
      // becomes a sustained one. Abandon the sweep; the next one is 6h out.
      if (isSweepAbandonError(err)) {
        console.warn(
          `[Alerts] Sweep abandoned at ${ticker}: upstream rate-limited` +
          (err.retryAfterMs ? `, retry after ${Math.round(err.retryAfterMs / 1000)}s.` : '.')
        );
        break;
      }
      console.warn(`[Alerts] sweep failed for ${ticker}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, SWEEP_SPACING_MS));
  }

  if (!quiet) {
    console.log(
      `[Alerts] Swept ${tickers.length} tickers, ${fired.length} sent` +
      (suppressed.length ? `, ${suppressed.length} suppressed by cooldown.` : '.')
    );
  }
  return { swept: tickers.length, alerts: fired, suppressed };
}

/**
 * Sunday morning summary across the default watchlist.
 *
 * Composition — the capitalisation weighting, which moves count, the wording —
 * is `buildDigest`'s. This function only supplies the rows.
 *
 * Until 2026-08-27 the mover loop here called a `both()` helper that was never
 * defined in this file: it is private to `triggers.js` and was never imported.
 * Every digest with at least one scored holding therefore threw
 * `ReferenceError`, which the hourly timer's `.catch()` logged and swallowed,
 * so the feature reported healthy while having never once sent. That is the
 * argument for the extraction rather than a footnote to it — the composition
 * had no test because it had no seam to test at.
 */
export async function sendWeeklyDigest() {
  const settings = getNotificationSettings();
  if (!settings.notify_sunday_digest) return null;

  const wl =
    db.prepare('SELECT * FROM watchlists WHERE is_default = 1').get() ||
    db.prepare('SELECT * FROM watchlists LIMIT 1').get();
  if (!wl) return null;

  // Read from the cache the sweeps already filled rather than re-fetching. A
  // digest that triggers twenty cold ingests at 09:00 on a Sunday is a good
  // way to be rate-limited every Sunday at 09:01.
  const holdings = JSON.parse(wl.tickers_json || '[]')
    .map((t) => db.prepare('SELECT * FROM stock_cache WHERE ticker = ?').get(t))
    .filter(Boolean)
    .map((row) => ({
      ticker: row.ticker,
      healthScore: row.health_score,
      marketCap: row.market_cap,
      // The rolled baseline, not the last snapshot. The last snapshot was
      // written by the same sweep that filled this cache row, so comparing
      // against it is comparing a reading with itself.
      previousScore: readSnapshot(row.ticker)?.week_ago_score ?? null
    }));

  const alert = buildDigest({ listName: wl.name, holdings });
  if (!alert || withinCooldown(alert)) return null;

  await recordAndSend(alert);
  return alert;
}

// --------------------------------------------------------------- scheduling

export function startAlertWorker() {
  if (process.env.ALERTS_ENABLED === '0') {
    console.log('[Alerts] Worker disabled by ALERTS_ENABLED=0.');
    return;
  }

  // A catch-up sweep after start, so downtime does not swallow a filing. It is
  // skipped when one ran recently: during a run of deployments this fired once
  // per restart, which is how eight identical notifications went out in two
  // hours. The cooldown would now suppress the duplicates anyway; not sweeping
  // at all is cheaper than fetching every holding to discard the result.
  setTimeout(() => {
    const last = db
      .prepare('SELECT MAX(captured_at) AS at FROM stock_snapshots')
      .get()?.at;
    const recentlySwept =
      last && minutesSince(last) * 60_000 < SWEEP_INTERVAL_MS / 2;

    if (recentlySwept) {
      console.log(`[Alerts] Start-up sweep skipped; last ran at ${last}.`);
      return;
    }
    runSweep().catch((err) => console.warn('[Alerts] sweep error:', err.message));
  }, 90_000);

  sweepTimer = setInterval(() => {
    runSweep().catch((err) => console.warn('[Alerts] sweep error:', err.message));
  }, SWEEP_INTERVAL_MS);

  // Checked hourly rather than scheduled once, so a restart cannot drop the
  // digest and a long uptime cannot drift off the hour.
  let lastDigestDate = null;
  digestTimer = setInterval(() => {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    if (
      now.getDay() === DIGEST_WEEKDAY &&
      now.getHours() === DIGEST_HOUR &&
      lastDigestDate !== stamp
    ) {
      lastDigestDate = stamp;
      sendWeeklyDigest().catch((err) =>
        console.warn('[Alerts] digest error:', err.message)
      );
    }
  }, 60 * 60 * 1000);

  console.log('[Alerts] Worker started: sweeps every 6h, digest Sundays at 09:00 local.');
}

export function stopAlertWorker() {
  if (sweepTimer) clearInterval(sweepTimer);
  if (digestTimer) clearInterval(digestTimer);
  sweepTimer = null;
  digestTimer = null;
}

export function getNotificationHistory(limit = 50) {
  return db
    .prepare(
      `SELECT id, ticker, alert_type, title, body, severity, url, read, delivered_at
       FROM notification_history
       ORDER BY delivered_at DESC
       LIMIT ?`
    )
    .all(Math.min(200, Math.max(1, limit)));
}

export function markNotificationsRead() {
  db.prepare('UPDATE notification_history SET read = 1 WHERE read = 0').run();
}
