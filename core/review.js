/** Personal review reminders, derived only from recorded data. No health verdicts. */
import { parseTimestamp } from './time.js';

export const REVIEW_INTERVAL_DAYS = 90;
const ASSESSMENTS = new Set(['intact', 'watch', 'changed']);
const ORDER = { changed: 0, due: 1, setup: 2, unreviewed: 3, reviewed: 4 };

// parseTimestamp deliberately accepts SQLite UTC dates. Reject impossible dates
// and clock-skewed future entries here so they cannot acknowledge later changes.
function validDate(value, now) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(?:[Zz]|([+-])(\d{2}):?(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour = '0', minute = '0', second = '0', , zoneHour = '0', zoneMinute = '0'] = match;
  if (+month < 1 || +month > 12 || +day < 1 ||
      +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate() ||
      +hour > 23 || +minute > 59 || +second > 59 || +zoneHour > 23 || +zoneMinute > 59) return null;
  const at = parseTimestamp(value);
  return at !== null && at <= now ? at : null;
}

/**
 * All inputs are local records. An ordinary note never acknowledges an alert,
 * and an empty queue never implies a sound business or a sound investment.
 */
export function buildReviewQueue({ companies = [], theses = [], alerts = [], now }) {
  const nowMs = parseTimestamp(now);
  if (nowMs === null) throw new Error('A valid current timestamp is required.');
  const thesisByTicker = new Map(theses.map(t => [String(t.ticker).toUpperCase(), t]));
  const seen = new Set();
  return companies.filter(company => {
    const ticker = String(company.ticker || '').trim().toUpperCase();
    if (!ticker || seen.has(ticker)) return false;
    seen.add(ticker);
    return true;
  }).map(company => {
    const ticker = company.ticker.trim().toUpperCase();
    const thesis = thesisByTicker.get(ticker) || {};
    const rules = Array.isArray(thesis.sellTriggers) ? thesis.sellTriggers : [];
    const hasThesis = Boolean(String(thesis.coreRationale || '').trim() ||
      String(thesis.mustRemainTrue || '').trim() || rules.some(rule => String(rule.text || '').trim()));
    const reviews = (Array.isArray(thesis.journalEntries) ? thesis.journalEntries : [])
      .filter(entry => entry.kind === 'review' && ASSESSMENTS.has(entry.assessment))
      .map(entry => ({ entry, at: validDate(entry.date, nowMs) }))
      .filter(review => review.at !== null)
      .sort((a, b) => b.at - a.at);
    const latest = reviews[0];
    const changes = alerts.filter(alert => String(alert.ticker || '').toUpperCase() === ticker)
      .map(alert => ({ alert, at: validDate(alert.at, nowMs) }))
      .filter(change => change.at !== null && (!latest || change.at > latest.at))
      .sort((a, b) => b.at - a.at)
      .map(({ alert, at }) => ({
        title: String(alert.title || 'Recorded change'), body: String(alert.body || ''),
        severity: String(alert.severity || 'info'), at: new Date(at).toISOString()
      }));
    let status, label, reason;
    if (changes.length) {
      status = 'changed'; label = 'Recorded changes';
      reason = `${changes.length} recorded ${changes.length === 1 ? 'change' : 'changes'} to review against your reasons.`;
    } else if (latest && nowMs - latest.at >= REVIEW_INTERVAL_DAYS * 86_400_000) {
      status = 'due'; label = 'Review due';
      reason = 'It has been at least 90 days since your last review.';
    } else if (!hasThesis) {
      status = 'setup'; label = 'Add your reasons';
      reason = 'Record why you follow this company and what must remain true.';
    } else if (!latest) {
      status = 'unreviewed'; label = 'First review';
      reason = 'Your reasons are saved. Record your first assessment.';
    } else {
      status = 'reviewed'; label = 'Reviewed';
      reason = 'No newer recorded alerts. This is not a judgment of the business.';
    }
    const flagged = rules.filter(rule => rule.triggered === true && String(rule.text || '').trim()).length;
    if (flagged) reason += ` You manually flagged ${flagged} ${flagged === 1 ? 'condition' : 'conditions'}.`;
    return {
      ticker, name: company.name || ticker, status, label, reason,
      lastReviewedAt: latest ? new Date(latest.at).toISOString() : null,
      assessment: ASSESSMENTS.has(latest?.entry.assessment) ? latest.entry.assessment : null,
      changeCount: changes.length, hasThesis, changes
    };
  }).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.ticker.localeCompare(b.ticker));
}
