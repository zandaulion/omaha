/**
 * The DCF sandbox model.
 *
 * Pure, and deliberately here rather than in a client. This arithmetic lived
 * only in `web/app.js`, which was fine while there was one client and becomes
 * a drift generator the moment there are two — the sliders recompute on every
 * drag, so a second implementation would be a second set of fair values, in the
 * place where the app is at its most advice-shaped.
 *
 * The scoring engine already models a DCF (`core/scoring.js`); that one produces
 * the baseline assumptions and the pillar score. This module is the *sandbox*:
 * the same projection run against assumptions a person chose, so they can ask
 * what would have to be true.
 *
 * Nothing here formats. Callers own their own number rendering, since the two
 * clients disagree about currency symbols and neither should learn the other's.
 */

/** Years projected explicitly before the terminal multiple takes over. */
export const PROJECTION_YEARS = 5;

/** Slider bounds, shared so the two clients cannot offer different ranges. */
export const LIMITS = {
  growthPct: { min: -25, max: 45 },
  multiple: { min: 8, max: 45 },
  discountPct: { min: 6, max: 16 }
};

/**
 * Where the sliders start: exactly what the scorecard was built from.
 *
 * Opening on the engine's own assumptions means the first number a person sees
 * in the sandbox agrees with the number on the scorecard behind it. Opening on
 * round defaults would make them disagree immediately and silently.
 */
export function dcfBaselines(dcfSummary) {
  const a = dcfSummary?.assumptions;
  // Clamped here rather than only at the presets, so the baseline the sliders
  // show and the baseline the presets are derived from are the same number.
  // Unclamped, a company with 90% filed growth showed a slider pinned at 45
  // while its bear case was computed from 90 — a bear case bearing no visible
  // relation to the base it claimed to be worse than.
  return clampAssumptions({
    growthPct: Math.round((a?.growthRate ?? 0.06) * 100),
    multiple: Math.round(a?.terminalMultiple ?? 15),
    discountPct: Math.round((a?.discountRate ?? 0.095) * 1000) / 10
  });
}

/**
 * Bear, base and bull, relative to the company's own baseline.
 *
 * The bear case is 35% *worse* rather than 35% lower, which is not the same
 * thing for a shrinking business: a company already contracting has a bear case
 * of faster decline, not slower expansion. Multiplying a negative growth rate
 * by 0.65 would make the bear case optimistic.
 */
export function presetAssumptions(preset, baselines) {
  const g = baselines.growthPct;
  if (preset === 'bear') {
    return clampAssumptions({
      growthPct: Math.round(g >= 0 ? g * 0.65 : g * 1.35),
      multiple: 16,
      discountPct: 11.0
    });
  }
  if (preset === 'bull') {
    return clampAssumptions({
      growthPct: Math.round(g >= 0 ? g * 1.3 : g * 0.7),
      multiple: 32,
      discountPct: 9.0
    });
  }
  return clampAssumptions(baselines);
}

/**
 * Hold every assumption inside the slider's range.
 *
 * Clamped at both ends, which the original did not do: it capped the bear case
 * from below and the bull case from above, each leaving the other end open. A
 * company whose filed growth sits outside the range — a steep decline, or a
 * recovery year off a small base — then produced a preset the slider could not
 * represent, so the control clamped silently while the fair value beneath it
 * was computed from the unclamped figure. The two disagreed, and nothing said so.
 *
 * Baselines go through here too, for the same reason: they come from the
 * filings, and the filings are not obliged to land inside a UI range.
 */
export function clampAssumptions(a) {
  const clamp = (v, { min, max }) => Math.min(max, Math.max(min, v));
  return {
    growthPct: clamp(a.growthPct, LIMITS.growthPct),
    multiple: clamp(a.multiple, LIMITS.multiple),
    discountPct: clamp(a.discountPct, LIMITS.discountPct)
  };
}

/**
 * Why the model cannot be run, or null if it can.
 *
 * Returned as a reason rather than a boolean because each of these needs a
 * different sentence. The previous build substituted $1bn of free cash flow
 * where it was missing and produced a fair value for companies that were
 * burning cash — a confident number for a question the filings do not answer.
 */
export function dcfBlockedReason({ dcfSummary, cashFlowBase, shares }) {
  if (dcfSummary?.applicable === false) return dcfSummary.reason || 'not-applicable';
  if (!isFinite(cashFlowBase) || cashFlowBase <= 0) return 'negative-fcf';
  if (!isFinite(shares) || shares <= 0) return 'no-share-count';
  return null;
}

export const BLOCKED_EXPLANATIONS = {
  'negative-fcf':
    'This company is not generating positive free cash flow, so a discounted cash flow ' +
    'model has nothing to discount. Judge it on the balance sheet and the path back to ' +
    'cash generation instead.',
  'no-share-count':
    'The diluted share count is not in the filings for this listing, so a per-share ' +
    'value cannot be derived.',
  'not-meaningful-for-financials':
    'Free cash flow is not owner earnings for a bank or insurer — deposit and loan flows ' +
    'dominate it. Book value and return on equity are the measures that apply here.'
};

export function explainBlocked(reason) {
  return BLOCKED_EXPLANATIONS[reason] || 'This model cannot be run on the available filings.';
}

/**
 * Two-stage DCF: five explicit years, then a terminal exit multiple.
 *
 * @returns per-year rows, the discounted components, and the fair value.
 */
export function projectDcf({ cashFlowBase, shares, netCash = 0, growthPct, multiple, discountPct }) {
  const g = growthPct / 100;
  const r = discountPct / 100;

  const rows = [];
  let fcf = cashFlowBase;
  let cumulativePV = 0;

  for (let t = 1; t <= PROJECTION_YEARS; t++) {
    fcf = fcf * (1 + g);
    const pv = fcf / Math.pow(1 + r, t);
    cumulativePV += pv;
    rows.push({ year: t, fcf, pv });
  }

  const terminalValue = fcf * multiple;
  const pvTerminal = terminalValue / Math.pow(1 + r, PROJECTION_YEARS);
  const enterpriseValue = cumulativePV + pvTerminal;
  const equityValue = enterpriseValue + netCash;

  return {
    rows,
    cumulativePV,
    terminalValue,
    pvTerminal,
    enterpriseValue,
    equityValue,
    fairValue: equityValue / shares
  };
}

/**
 * What the result means against the traded price.
 *
 * Four outcomes, and three of them exist because the obvious single number is
 * misleading somewhere:
 *
 * - `no-equity-value` — the discounted flows do not cover the debt.
 * - `divergent` — a fair value several multiples from the price almost always
 *   means the assumptions are wrong, or the market is pricing something the
 *   filings do not show. Presenting that as an enormous margin of safety
 *   invites exactly the wrong conclusion.
 * - `undervalued` — a genuine margin of safety.
 * - `overvalued` — stated as a *premium over* fair value rather than a negative
 *   margin of safety, because the margin form reaches −188% on an expensive
 *   stock and stops carrying meaning.
 */
export function dcfVerdict(fairValue, price) {
  if (!isFinite(fairValue) || fairValue <= 0) {
    return { kind: 'no-equity-value', pct: null, factor: null };
  }
  if (!isFinite(price) || price <= 0) {
    return { kind: 'no-price', pct: null, factor: null };
  }

  const factor = fairValue / price;
  if (factor >= 3 || factor <= 1 / 3) {
    return { kind: 'divergent', pct: null, factor };
  }
  if (fairValue > price) {
    return { kind: 'undervalued', pct: ((fairValue - price) / fairValue) * 100, factor };
  }
  return { kind: 'overvalued', pct: ((price - fairValue) / fairValue) * 100, factor };
}
