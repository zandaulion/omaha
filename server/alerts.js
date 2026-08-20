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

const SCORE_SHIFT_THRESHOLD = 3;

/**
 * Minimum days between repeats of the same alert type for the same ticker.
 *
 * A standing condition is not an event. "PEG below 1.3" stays true for months,
 * and without a floor here every sweep re-announces it — which is how NU and
 * PATH sent eight identical notifications in two hours. The per-trigger edge
 * guards below are the primary defence; this is the backstop that also covers
 * process restarts, since each restart runs a catch-up sweep.
 */
const COOLDOWN_DAYS = {
  MARGIN_OF_SAFETY: 14,
  CAPITAL_RETURN: 14,
  RED_FLAG_WARNING: 3,
  EARNINGS_HEALTH_SHIFT: 1,
  WEEKLY_DIGEST: 6
};
const DEFAULT_COOLDOWN_DAYS = 3;
const GROSS_MARGIN_DROP_BPS = 300;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // four sweeps a day
const DIGEST_WEEKDAY = 0; // Sunday
const DIGEST_HOUR = 9;

let sweepTimer = null;
let digestTimer = null;

// ---------------------------------------------------------------- settings

const DEFAULT_SETTINGS = {
  notify_earnings_filings: 1,
  notify_red_flags: 1,
  notify_margin_of_safety: 1,
  notify_capital_returns: 0,
  notify_sunday_digest: 1
};

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

function writeSnapshot(ticker, stock) {
  const m = stock.summary?.metrics || {};
  const checklist = Object.fromEntries(
    (stock.checklist || []).map((c) => [c.id, c.status])
  );

  db.prepare(
    `INSERT INTO stock_snapshots
       (ticker, health_score, checklist_json, altman_z, piotroski_score,
        current_ratio, gross_margin, pe_percentile, peg_ratio, share_change, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
       captured_at=datetime('now')`
  ).run(
    ticker,
    stock.health_score ?? null,
    JSON.stringify(checklist),
    stock.altman_z ?? null,
    stock.piotroski_score ?? null,
    m.currentRatio ?? null,
    m.grossMargin ?? null,
    // Only a P/E history long enough to mean something is carried forward.
    stock.summary?.peHistory?.scoreable === true
      ? stock.summary.peHistory.percentile ?? null
      : null,
    m.pegRatio ?? null,
    m.shareChangeYoY ?? null
  );
}

// ------------------------------------------------------------------- rules

const CHECK_NAMES = {
  1: 'Altman Z-Score', 2: 'Interest coverage', 3: 'Current ratio',
  4: 'Debt to equity', 5: 'Free cash flow', 6: 'Piotroski F-Score',
  7: 'ROIC vs cost of capital', 8: 'Gross margin', 9: 'Share count',
  10: 'Cash conversion', 11: 'PEG ratio', 12: 'Revenue growth'
};

const RANK = { pass: 3, watch: 2, fail: 1 };

/** Both values present and numeric — the precondition for any comparison. */
const both = (a, b) => typeof a === 'number' && typeof b === 'number';

export function evaluateTriggers(stock, prev, settings) {
  const alerts = [];
  if (!prev) return alerts; // First sighting is a baseline, not an event.

  const m = stock.summary?.metrics || {};
  const t = stock.ticker;

  // --- Trigger 1: health score shift or checklist state change -------------
  if (settings.notify_earnings_filings) {
    const delta =
      both(stock.health_score, prev.health_score)
        ? stock.health_score - prev.health_score
        : null;

    const flips = [];
    for (const check of stock.checklist || []) {
      const before = prev.checklist[check.id];
      const after = check.status;
      // Movement in or out of "na" is a coverage change, not a fundamental one.
      if (!before || before === after) continue;
      if (before === 'na' || after === 'na') continue;
      flips.push({ id: check.id, from: before, to: after, worse: RANK[after] < RANK[before] });
    }

    if ((delta !== null && Math.abs(delta) >= SCORE_SHIFT_THRESHOLD) || flips.length) {
      const up = delta !== null && delta > 0;
      const worsened = flips.filter((f) => f.worse);
      const parts = [];
      if (delta !== null && Math.abs(delta) >= SCORE_SHIFT_THRESHOLD) {
        parts.push(`Health ${up ? 'up' : 'down'} ${Math.abs(delta)} points to ${stock.health_score}/100.`);
      }
      for (const f of flips.slice(0, 2)) {
        parts.push(`${CHECK_NAMES[f.id] || `Check ${f.id}`}: ${f.from} → ${f.to}.`);
      }

      alerts.push({
        type: 'EARNINGS_HEALTH_SHIFT',
        ticker: t,
        title: `${t} ${up && !worsened.length ? 'health upgrade' : 'health change'}${stock.health_score !== null ? ` (${stock.health_score}/100)` : ''}`,
        body: parts.join(' '),
        severity: worsened.length ? 'warning' : 'positive',
        url: `/?tab=deepdive&ticker=${t}`
      });
    }
  }

  // --- Trigger 2: distress thresholds breached -----------------------------
  if (settings.notify_red_flags) {
    const breaches = [];

    if (both(stock.altman_z, prev.altman_z) && stock.altman_z < 1.8 && prev.altman_z >= 1.8) {
      breaches.push(`Altman Z fell to ${stock.altman_z.toFixed(2)}, into the distress zone.`);
    }
    if (both(m.currentRatio, prev.current_ratio) && m.currentRatio < 1.0 && prev.current_ratio >= 1.0) {
      breaches.push(`Current ratio dropped below 1.0 to ${m.currentRatio.toFixed(2)}.`);
    }
    if (both(m.grossMargin, prev.gross_margin)) {
      const dropBps = Math.round((prev.gross_margin - m.grossMargin) * 10000);
      if (dropBps > GROSS_MARGIN_DROP_BPS) {
        breaches.push(`Gross margin compressed ${dropBps} bps to ${(m.grossMargin * 100).toFixed(1)}%.`);
      }
    }
    if (both(stock.piotroski_score, prev.piotroski_score) &&
        stock.piotroski_score <= 4 && prev.piotroski_score > 4) {
      breaches.push(`Piotroski F-Score downgraded to ${stock.piotroski_score}/9.`);
    }

    if (breaches.length) {
      alerts.push({
        type: 'RED_FLAG_WARNING',
        ticker: t,
        title: `⚠️ ${t}: ${breaches.length > 1 ? `${breaches.length} warning signs` : 'warning sign'}`,
        body: breaches.join(' '),
        severity: 'critical',
        url: `/?tab=deepdive&ticker=${t}&subtab=checklist`
      });
    }
  }

  // --- Trigger 3: margin-of-safety entry -----------------------------------
  //
  // Both conditions below are edge-triggered. "PEG is under 1.3" is a state
  // that holds for months; announcing it on every sweep is not an alert, it is
  // a subscription to the same sentence. Only the crossing is news.
  if (settings.notify_margin_of_safety && typeof stock.health_score === 'number' && stock.health_score >= 85) {
    // A P/E history too short to be a valuation range cannot signal cheapness:
    // a low percentile there reflects earnings recovering off a trough.
    const peUsable = stock.summary?.peHistory?.scoreable === true;
    const pePercentile = peUsable ? stock.summary.peHistory.percentile ?? null : null;
    const peg = m.pegRatio;

    const crossedIntoCheapPe =
      typeof pePercentile === 'number' &&
      pePercentile <= 20 &&
      typeof prev.pe_percentile === 'number' &&
      prev.pe_percentile > 20;

    const crossedIntoCheapPeg =
      typeof peg === 'number' && peg > 0 && peg <= 1.3 &&
      typeof prev.peg_ratio === 'number' && prev.peg_ratio > 1.3;

    if (crossedIntoCheapPe || crossedIntoCheapPeg) {
      const reason = crossedIntoCheapPe
        ? `Its P/E has fallen into the cheapest ${pePercentile}% of its own history.`
        : `Its PEG has fallen to ${peg.toFixed(2)}, from ${prev.peg_ratio.toFixed(2)}.`;
      alerts.push({
        type: 'MARGIN_OF_SAFETY',
        ticker: t,
        title: `🎯 ${t} entry point (${stock.health_score}/100)`,
        body: `Health is strong and the price has come in. ${reason}`,
        severity: 'info',
        url: `/?tab=deepdive&ticker=${t}`
      });
    }
  }

  // --- Capital allocation (off by default) ---------------------------------
  if (settings.notify_capital_returns && both(m.shareChangeYoY, prev.share_change)) {
    if (m.shareChangeYoY < -0.02 && prev.share_change >= -0.02) {   // crossing only
      alerts.push({
        type: 'CAPITAL_RETURN',
        ticker: t,
        title: `📈 ${t} stepped up buybacks`,
        body: `Diluted share count is down ${Math.abs(m.shareChangeYoY * 100).toFixed(1)}% year on year.`,
        severity: 'positive',
        url: `/?tab=deepdive&ticker=${t}`
      });
    }
  }

  return alerts;
}

// ------------------------------------------------------------- dispatching

/**
 * Has this exact alert already gone out recently?
 *
 * The edge guards above stop a standing condition re-firing, but a metric that
 * oscillates around a threshold would still ring repeatedly, and every process
 * restart runs a catch-up sweep. This is the floor under both.
 */
function withinCooldown(alert) {
  const days = COOLDOWN_DAYS[alert.type] ?? DEFAULT_COOLDOWN_DAYS;
  const row = db
    .prepare(
      `SELECT 1 FROM notification_history
       WHERE alert_type = ?
         AND COALESCE(ticker, '') = COALESCE(?, '')
         AND delivered_at > datetime('now', ?)
       LIMIT 1`
    )
    .get(alert.type, alert.ticker || '', `-${days} days`);
  return Boolean(row);
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
    badge: '/icons/icon-192.png',
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
      const stock = await getStockData(ticker, true);
      if (!stock) continue;

      const prev = readSnapshot(ticker);
      for (const alert of evaluateTriggers(stock, prev, settings)) {
        if (withinCooldown(alert)) {
          suppressed.push(`${alert.ticker} ${alert.type}`);
          continue;
        }
        fired.push(alert);
        await recordAndSend(alert);
      }
      writeSnapshot(ticker, stock);
    } catch (err) {
      console.warn(`[Alerts] sweep failed for ${ticker}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  if (!quiet) {
    console.log(
      `[Alerts] Swept ${tickers.length} tickers, ${fired.length} sent` +
      (suppressed.length ? `, ${suppressed.length} suppressed by cooldown.` : '.')
    );
  }
  return { swept: tickers.length, alerts: fired, suppressed };
}

/** Sunday morning summary across the default watchlist. */
export async function sendWeeklyDigest() {
  const settings = getNotificationSettings();
  if (!settings.notify_sunday_digest) return null;

  const wl =
    db.prepare('SELECT * FROM watchlists WHERE is_default = 1').get() ||
    db.prepare('SELECT * FROM watchlists LIMIT 1').get();
  if (!wl) return null;

  const tickers = JSON.parse(wl.tickers_json || '[]');
  const rows = tickers
    .map((t) => db.prepare('SELECT * FROM stock_cache WHERE ticker = ?').get(t))
    .filter((r) => r && typeof r.health_score === 'number');
  if (!rows.length) return null;

  const totalCap = rows.reduce((s, r) => s + (r.market_cap || 0), 0);
  const composite = totalCap
    ? Math.round(rows.reduce((s, r) => s + r.health_score * (r.market_cap || 0), 0) / totalCap)
    : Math.round(rows.reduce((s, r) => s + r.health_score, 0) / rows.length);

  // Week-over-week movers, from the snapshots taken during the sweeps.
  const movers = [];
  for (const r of rows) {
    const snap = readSnapshot(r.ticker);
    if (snap && both(snap.health_score, r.health_score)) {
      const delta = r.health_score - snap.health_score;
      if (Math.abs(delta) >= 2) movers.push({ ticker: r.ticker, delta });
    }
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const moverText = movers.length
    ? ` Movers: ${movers.slice(0, 3).map((mv) => `${mv.ticker} ${mv.delta > 0 ? '+' : ''}${mv.delta}`).join(', ')}.`
    : ' No material health changes this week.';

  const alert = {
    type: 'WEEKLY_DIGEST',
    ticker: '',
    title: `🎩 ${wl.name}: ${composite}/100`,
    body: `${rows.length} holdings scored.${moverText}`,
    severity: 'info',
    url: '/?tab=watchlist'
  };

  if (withinCooldown(alert)) return null;
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
      last && Date.now() - new Date(`${last.replace(' ', 'T')}Z`).getTime() < SWEEP_INTERVAL_MS / 2;

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
