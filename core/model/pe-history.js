/**
 * Pocket Omaha — the stock's own P/E range.
 *
 * The spec asks for valuation relative to a company's own history rather than
 * to a fixed multiple, which needs price history: monthly closes divided by the
 * diluted EPS of the fiscal year each month falls in.
 *
 * A short series is reported but not scored. Two years of P/E is not a range,
 * and treating it as one would let a company be called cheap or expensive on
 * the strength of almost no evidence.
 */

import { fixed as fixedDecimal } from '../format.js';

/**
 * The stock's own P/E range over the last five years, from monthly closes
 * divided by the diluted EPS of the fiscal year each month falls in. The spec
 * asks for valuation relative to a company's own history; that needs price
 * history, which the previous implementation never fetched, so it compared
 * against fixed absolute multiples instead.
 */
export function buildPeHistory(fundamentals, quote) {
  // A P/E series only exists for months where the company had already filed a
  // positive EPS. For a business recovering from losses that can be a small
  // slice of the five years, computed against trough earnings — TAL's "range"
  // was 18 months divided by a trough EPS, giving a median of 75x against a
  // current 7.6x and a headline of "cheapest 0% of its five-year range". The
  // arithmetic was right and the conclusion was nonsense: earnings recovered
  // sixfold, the multiple did not compress. So the span is measured, reported,
  // and required to be long enough before it is allowed to affect the score.
  const MIN_MONTHS_TO_SCORE = 36;
  const MIN_EPS_PERIODS = 3;

  const empty = (reason) => ({
    available: false, reason, series: [], months: 0,
    min: null, p20: null, median: null, p80: null, max: null,
    current: quote.trailingPE ?? null, percentile: null, vsMedianPct: null
  });

  const prices = fundamentals.priceHistory || [];
  const annual = fundamentals.annual || [];
  if (!prices.length) return empty('no price history');

  const epsPeriods = annual
    .filter((p) => typeof p.dilutedEPS === 'number' && p.dilutedEPS > 0)
    .map((p) => ({ date: p.asOfDate, eps: p.dilutedEPS }));
  if (epsPeriods.length < 2) return empty('fewer than two profitable filed years');

  const series = [];
  for (const point of prices) {
    // The multiple an investor could actually have computed at the time: the
    // most recently filed EPS as of that month.
    let eps = null;
    for (const period of epsPeriods) {
      if (period.date <= point.date) eps = period.eps;
    }
    if (eps === null || eps <= 0) continue;
    const pe = point.close / eps;
    if (pe > 0 && pe < 400) series.push({ date: point.date, pe: Number(fixedDecimal(pe, 2)) });
  }

  const values = series.map((s) => s.pe).sort((a, b) => a - b);
  const current = quote.trailingPE ?? (series.length ? series[series.length - 1].pe : null);

  const base = {
    series,
    months: series.length,
    epsPeriods: epsPeriods.length,
    current: current === null ? null : Number(fixedDecimal(current, 2))
  };

  if (series.length < 12) return { ...empty('too few months of comparable earnings'), ...base };

  const at = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  const median = at(0.5);
  const below = current === null ? null : values.filter((v) => v <= current).length;

  // Long enough to be a fair comparison, or shown for context but not scored.
  const scoreable = series.length >= MIN_MONTHS_TO_SCORE && epsPeriods.length >= MIN_EPS_PERIODS;

  return {
    ...base,
    available: true,
    scoreable,
    reason: scoreable
      ? null
      : `only ${series.length} months of comparable earnings across ` +
        `${epsPeriods.length} profitable filed year${epsPeriods.length === 1 ? '' : 's'}`,
    min: values[0],
    p20: at(0.2),
    median,
    p80: at(0.8),
    max: values[values.length - 1],
    percentile: below === null ? null : Math.round((below / values.length) * 100),
    vsMedianPct:
      median > 0 && current !== null
        ? Number(fixedDecimal((((current - median) / median) * 100), 1))
        : null
  };
}
