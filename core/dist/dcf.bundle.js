// core/analysis/dcf.js
var PROJECTION_YEARS = 5;
var LIMITS = {
  growthPct: { min: -25, max: 45 },
  multiple: { min: 8, max: 45 },
  discountPct: { min: 6, max: 16 }
};
function dcfBaselines(dcfSummary) {
  const a = dcfSummary?.assumptions;
  return clampAssumptions({
    growthPct: Math.round((a?.growthRate ?? 0.06) * 100),
    multiple: Math.round(a?.terminalMultiple ?? 15),
    discountPct: Math.round((a?.discountRate ?? 0.095) * 1e3) / 10
  });
}
function presetAssumptions(preset, baselines) {
  const g = baselines.growthPct;
  if (preset === "bear") {
    return clampAssumptions({
      growthPct: Math.round(g >= 0 ? g * 0.65 : g * 1.35),
      multiple: 16,
      discountPct: 11
    });
  }
  if (preset === "bull") {
    return clampAssumptions({
      growthPct: Math.round(g >= 0 ? g * 1.3 : g * 0.7),
      multiple: 32,
      discountPct: 9
    });
  }
  return clampAssumptions(baselines);
}
function clampAssumptions(a) {
  const clamp = (v, { min, max }) => Math.min(max, Math.max(min, v));
  return {
    growthPct: clamp(a.growthPct, LIMITS.growthPct),
    multiple: clamp(a.multiple, LIMITS.multiple),
    discountPct: clamp(a.discountPct, LIMITS.discountPct)
  };
}
function dcfBlockedReason({ dcfSummary, cashFlowBase, shares }) {
  if (dcfSummary?.applicable === false) return dcfSummary.reason || "not-applicable";
  if (!isFinite(cashFlowBase) || cashFlowBase <= 0) return "negative-fcf";
  if (!isFinite(shares) || shares <= 0) return "no-share-count";
  return null;
}
var BLOCKED_EXPLANATIONS = {
  "negative-fcf": "This company is not generating positive free cash flow, so a discounted cash flow model has nothing to discount. Judge it on the balance sheet and the path back to cash generation instead.",
  "no-share-count": "The diluted share count is not in the filings for this listing, so a per-share value cannot be derived.",
  "not-meaningful-for-financials": "Free cash flow is not owner earnings for a bank or insurer \u2014 deposit and loan flows dominate it. Book value and return on equity are the measures that apply here."
};
function explainBlocked(reason) {
  return BLOCKED_EXPLANATIONS[reason] || "This model cannot be run on the available filings.";
}
function projectDcf({ cashFlowBase, shares, netCash = 0, growthPct, multiple, discountPct }) {
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
function dcfVerdict(fairValue, price) {
  if (!isFinite(fairValue) || fairValue <= 0) {
    return { kind: "no-equity-value", pct: null, factor: null };
  }
  if (!isFinite(price) || price <= 0) {
    return { kind: "no-price", pct: null, factor: null };
  }
  const factor = fairValue / price;
  if (factor >= 3 || factor <= 1 / 3) {
    return { kind: "divergent", pct: null, factor };
  }
  if (fairValue > price) {
    return { kind: "undervalued", pct: (fairValue - price) / fairValue * 100, factor };
  }
  return { kind: "overvalued", pct: (price - fairValue) / fairValue * 100, factor };
}
var BANK_LIMITS = {
  rotePct: { min: -5, max: 30 },
  coePct: { min: 6, max: 16 },
  payoutPct: { min: 0, max: 100 }
};
function bankBaselines(dcfSummary) {
  const a = dcfSummary?.assumptions || {};
  return clampBank({
    rotePct: Math.round((dcfSummary?.rote ?? 0.1) * 1e3) / 10,
    coePct: Math.round((a.costOfEquity ?? 0.095) * 1e3) / 10,
    payoutPct: Math.round((a.payoutRatio ?? 0.5) * 100)
  });
}
function bankPresets(preset, dcfSummary, baselines) {
  if (preset === "bear" && isFiniteNum(dcfSummary?.roteLow)) {
    return clampBank({ ...baselines, rotePct: Math.round(dcfSummary.roteLow * 1e3) / 10, coePct: 11 });
  }
  if (preset === "bull" && isFiniteNum(dcfSummary?.roteHigh)) {
    return clampBank({ ...baselines, rotePct: Math.round(dcfSummary.roteHigh * 1e3) / 10, coePct: 9 });
  }
  return clampBank(baselines);
}
function isFiniteNum(v) {
  return typeof v === "number" && isFinite(v);
}
function clampBank(a) {
  const clamp = (v, { min, max }) => Math.min(max, Math.max(min, v));
  return {
    rotePct: clamp(a.rotePct, BANK_LIMITS.rotePct),
    coePct: clamp(a.coePct, BANK_LIMITS.coePct),
    payoutPct: clamp(a.payoutPct, BANK_LIMITS.payoutPct)
  };
}
function projectBank({ rotePct, coePct, payoutPct, tangibleBookValuePerShare, maxGrowth = 0.04 }) {
  const rote = rotePct / 100;
  const coe = coePct / 100;
  const payout = payoutPct / 100;
  const tbvps = Number(tangibleBookValuePerShare);
  if (!isFiniteNum(tbvps) || tbvps <= 0) return { blocked: "no-tangible-equity" };
  if (rote <= 0) return { blocked: "not-earning-on-equity" };
  const growth = Math.min(rote * (1 - payout), maxGrowth);
  if (growth >= coe) return { blocked: "growth-exceeds-cost-of-equity" };
  const justifiedPTBV = (rote - growth) / (coe - growth);
  return {
    blocked: null,
    growth,
    justifiedPTBV,
    tangibleBookValuePerShare: tbvps,
    fairValue: tbvps * justifiedPTBV
  };
}
var BANK_BLOCKED_EXPLANATIONS = {
  "not-earning-on-equity": "At this return the bank earns nothing on the capital it holds, so there is no justified multiple of book to apply. Raise the return to see a value.",
  "growth-exceeds-cost-of-equity": "Retained growth has reached the cost of equity. Past that point the model divides by nothing and the answer runs to infinity \u2014 pay more out, or demand a higher return.",
  "no-tangible-equity": "Tangible book value is not in the filings for this listing, so there is nothing to apply a multiple to."
};
export {
  BANK_BLOCKED_EXPLANATIONS,
  BANK_LIMITS,
  BLOCKED_EXPLANATIONS,
  LIMITS,
  PROJECTION_YEARS,
  bankBaselines,
  bankPresets,
  clampAssumptions,
  dcfBaselines,
  dcfBlockedReason,
  dcfVerdict,
  explainBlocked,
  presetAssumptions,
  projectBank,
  projectDcf
};
