/**
 * Is a cached AI analysis still describing the company it was written about?
 *
 * Pure. Takes what the analysis recorded about itself and what is true now,
 * and returns what to say — not what to do. Nothing here regenerates anything:
 * every call costs money and latency, the alert sweep already touches every
 * watchlist holding four times a day, and silently rewriting an analysis
 * somebody may have read and acted on is worse than telling them it is old.
 *
 * Lives in `core/` because both clients ask the same question and a second
 * implementation would eventually answer it differently.
 */

/**
 * How far the price may drift before the valuation sections stop meaning what
 * they say. 15% is the figure the backlog settled on: large enough that normal
 * volatility does not cry wolf, small enough that a re-rating trips it.
 */
export const PRICE_DRIFT_THRESHOLD = 0.15;

/**
 * @param {object} summary  the cached analysis; reads `fiscalPeriodEnd` and
 *                          `priceAtGeneration`
 * @param {object} current  the live stock; reads `summary.metrics.fiscalPeriodEnd`
 *                          and `price`
 * @returns {{
 *   stale: boolean,
 *   filingsChanged: boolean,
 *   priceDrifted: boolean,
 *   driftRatio: number|null,
 *   scope: 'none'|'valuation'|'all',
 *   headline: string|null,
 *   detail: string|null
 * }}
 */
export function assessSummaryStaleness(summary, current, promptVersion = 0) {
  const fresh = {
    stale: false,
    filingsChanged: false,
    priceDrifted: false,
    supersededByNewerAnalysis: false,
    driftRatio: null,
    scope: 'none',
    headline: null,
    detail: null
  };

  if (!summary || !current) return fresh;

  const writtenAgainst = summary.fiscalPeriodEnd || null;
  const filedNow = current.summary?.metrics?.fiscalPeriodEnd || null;

  // Only a difference between two known periods is evidence. An analysis
  // cached before the field existed, or a stock whose period did not parse,
  // must not be reported as superseded on the strength of a missing value.
  const filingsChanged = Boolean(
    writtenAgainst && filedNow && writtenAgainst !== filedNow
  );

  const priceThen = numberOrNull(summary.priceAtGeneration);
  const priceNow = numberOrNull(current.price);

  let driftRatio = null;
  if (priceThen !== null && priceNow !== null && priceThen > 0) {
    driftRatio = (priceNow - priceThen) / priceThen;
  }

  // Compared with a slack of one part in a billion rather than exactly.
  // A price exactly 15% above the recorded one does not reach the threshold in
  // binary: 100 * 1.15 is 114.99999999999999, which yields a ratio of
  // 0.14999999999999991. The boundary is a judgement rather than a physical
  // constant, so a figure a person would read as 15% should trip it.
  const priceDrifted =
    driftRatio !== null && Math.abs(driftRatio) >= PRICE_DRIFT_THRESHOLD - 1e-9;

  // The app can learn to say something it could not say before while the
  // filings sit still and the price does not move. An analysis written before
  // the bank model existed carried no fair value for a lender at all, and
  // nothing here could see that, so it was served as current indefinitely.
  //
  // A summary from before the stamp existed counts as superseded: it was
  // certainly written against an older prompt, and treating unknown as current
  // is the favourable reading rather than the true one.
  const writtenWith = numberOrNull(summary.promptVersion);
  const supersededByNewerAnalysis = writtenWith === null || writtenWith < promptVersion;

  if (!filingsChanged && !priceDrifted && !supersededByNewerAnalysis) return fresh;

  // Newer filings undermine the whole analysis: every section was reasoned
  // from figures that have since been superseded. Price movement undermines
  // only the parts that depend on price — the moat and solvency reasoning is
  // just as good as it was. Saying so is the difference between a caveat a
  // person can act on and one they learn to dismiss.
  // A newer analysis supersedes the whole thing for the same reason newer
  // filings do: the sections were reasoned without figures that now exist.
  const scope = filingsChanged || supersededByNewerAnalysis ? 'all' : 'valuation';

  // Filings first where both apply. New statements are the more concrete
  // reason and the one a reader can check for themselves.
  const headline = filingsChanged
    ? 'Newer financial statements have been filed since this was written.'
    : supersededByNewerAnalysis
      ? 'The app has learned to measure things this analysis was never shown.'
      : 'The share price has moved materially since this was written.';

  const detail = filingsChanged
    ? `Written against ${writtenAgainst}; the latest filed period is now ${filedNow}. ` +
      'Every section was reasoned from the older figures.'
    : supersededByNewerAnalysis
      ? 'It was written against an earlier version of what this app measures, so it ' +
        'could not have taken the newer figures into account. Re-analysing costs one ' +
        'model call.'
      : `${formatSignedPercent(driftRatio)} since the analysis was generated. ` +
        'The valuation and buy-zone sections are affected; the moat and solvency ' +
        'reasoning is unchanged.';

  return {
    stale: true,
    filingsChanged,
    priceDrifted,
    supersededByNewerAnalysis,
    driftRatio,
    scope,
    headline,
    detail
  };
}

function numberOrNull(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Formatted here rather than in each client, so both say it the same way.
 * Deliberately not `toFixed` — see `core/format.js` for why that is not
 * portable across the engines this runs in.
 */
function formatSignedPercent(ratio) {
  const pct = ratio * 100;
  const rounded = Math.round(Math.abs(pct) * 10) / 10;
  const whole = Math.floor(rounded);
  const tenth = Math.round((rounded - whole) * 10);
  const text = tenth === 0 ? `${whole}` : `${whole}.${tenth}`;
  return `${pct >= 0 ? '+' : '−'}${text}%`;
}
