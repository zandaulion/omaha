/**
 * Pocket Omaha — alert trigger rules.
 *
 * Pure. Takes the current scored stock, the previous snapshot of it, and the
 * user's notification preferences; returns the alerts that should fire. It
 * decides nothing about delivery, storage or scheduling — those differ per
 * host (web push from a server, a local notification from WorkManager) while
 * the question "is this a real fundamental change?" must not.
 *
 * Nothing here fires on a metric that could not be measured. An indicator
 * moving from a real value to "unavailable" is a data-coverage change, not a
 * fundamental one, and waking someone for it would train them to ignore alerts.
 */

/** A health-score move smaller than this is noise, not news. */
export const SCORE_SHIFT_THRESHOLD = 3;

/** Gross-margin deterioration that counts as a red flag, in basis points. */
export const GROSS_MARGIN_DROP_BPS = 300;

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
