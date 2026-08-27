var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// core/host/web-shim.js
var ShimHeaders = class {
  constructor(raw) {
    this._byLowerName = {};
    for (const [name, value] of Object.entries(raw || {})) {
      this._byLowerName[String(name).toLowerCase()] = value;
    }
  }
  get(name) {
    const value = this._byLowerName[String(name).toLowerCase()];
    return value === void 0 ? null : value;
  }
};
var ShimResponse = class {
  constructor(raw) {
    this.status = raw.status ?? 0;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new ShimHeaders(raw.headers);
    this.url = raw.url ?? "";
    this._body = typeof raw.body === "string" ? raw.body : "";
  }
  // Async to match the real thing, even though the body is already in hand:
  // callers `await` these, and a synchronous version would work until someone
  // relied on the ordering.
  async text() {
    return this._body;
  }
  async json() {
    return JSON.parse(this._body);
  }
};
var ShimAbortSignal = class _ShimAbortSignal {
  constructor(timeoutMs) {
    this.__timeoutMs = timeoutMs;
    this.aborted = false;
  }
  static timeout(ms) {
    return new _ShimAbortSignal(ms);
  }
};
var ShimURLSearchParams = class {
  constructor(init) {
    this._pairs = [];
    if (typeof init === "string") {
      for (const part of init.replace(/^[?]/, "").split("&")) {
        if (!part) continue;
        const at = part.indexOf("=");
        const name = at === -1 ? part : part.slice(0, at);
        const value = at === -1 ? "" : part.slice(at + 1);
        this._pairs.push([decodeForm(name), decodeForm(value)]);
      }
    } else if (Array.isArray(init)) {
      for (const [name, value] of init) this._pairs.push([String(name), String(value)]);
    } else if (init && typeof init === "object") {
      for (const [name, value] of Object.entries(init)) {
        this._pairs.push([String(name), String(value)]);
      }
    }
  }
  append(name, value) {
    this._pairs.push([String(name), String(value)]);
  }
  set(name, value) {
    const key = String(name);
    const first = this._pairs.findIndex(([n]) => n === key);
    if (first === -1) {
      this._pairs.push([key, String(value)]);
      return;
    }
    this._pairs[first] = [key, String(value)];
    this._pairs = this._pairs.filter(([n], i) => n !== key || i === first);
  }
  get(name) {
    const hit = this._pairs.find(([n]) => n === String(name));
    return hit ? hit[1] : null;
  }
  has(name) {
    return this._pairs.some(([n]) => n === String(name));
  }
  delete(name) {
    this._pairs = this._pairs.filter(([n]) => n !== String(name));
  }
  toString() {
    return this._pairs.map(([n, v]) => encodeForm(n) + "=" + encodeForm(v)).join("&");
  }
};
var encodeForm = (value) => encodeURIComponent(String(value)).replace(/%20/g, "+");
var decodeForm = (value) => decodeURIComponent(String(value).replace(/[+]/g, " "));
function installHostFetch(target = globalThis) {
  if (typeof target.fetch === "function") return false;
  if (typeof target.__httpFetch !== "function") {
    throw new Error(
      "No host HTTP function. The embedding runtime must define __httpFetch before the engine can reach the network."
    );
  }
  target.Response = ShimResponse;
  target.Headers = ShimHeaders;
  target.AbortSignal = ShimAbortSignal;
  if (typeof target.URLSearchParams !== "function") {
    target.URLSearchParams = ShimURLSearchParams;
  }
  target.fetch = async (url, init = {}) => {
    const request = {
      url: String(url),
      method: init.method || "GET",
      headers: init.headers || {},
      body: init.body ?? null,
      timeoutMs: init.signal?.__timeoutMs ?? null
    };
    const raw = await target.__httpFetch(JSON.stringify(request));
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && parsed.error) throw new Error(parsed.error);
    return new ShimResponse(parsed);
  };
  return true;
}

// core/store.js
var active = null;
function setStore(impl) {
  const required = ["read", "save", "searchCached", "sectorFinancials"];
  const missing = required.filter((m) => typeof impl?.[m] !== "function");
  if (missing.length) {
    throw new Error(`Store is missing: ${missing.join(", ")}`);
  }
  active = impl;
}
function getStore() {
  if (!active) {
    throw new Error(
      "No store configured. The host must call setStore() before requesting a stock \u2014 see server/store.js for the SQLite implementation."
    );
  }
  return active;
}
async function sectorMedianAssetTurnover(sector, excludeTicker) {
  if (!sector) return null;
  let rows;
  try {
    rows = await getStore().sectorFinancials(sector, excludeTicker);
  } catch (err) {
    console.warn("[Store] sector lookup failed:", err.message);
    return null;
  }
  const turnovers = [];
  for (const f of rows || []) {
    if (f && f.revenue > 0 && f.totalAssets > 0) {
      turnovers.push(f.revenue / f.totalAssets);
    }
  }
  if (turnovers.length < 3) return null;
  turnovers.sort((a, b) => a - b);
  const mid = Math.floor(turnovers.length / 2);
  return turnovers.length % 2 ? turnovers[mid] : (turnovers[mid - 1] + turnovers[mid]) / 2;
}

// core/time.js
var TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3})\d*)?)?(Z|z|[+-]\d{2}:?\d{2})?$/;
function parseTimestamp(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const m = TIMESTAMP.exec(raw);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, ms, zone] = m;
  let at = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh || 0),
    Number(mm || 0),
    Number(ss || 0),
    Number((ms || "").padEnd(3, "0") || 0)
  );
  if (!Number.isFinite(at)) return null;
  if (zone && zone !== "Z" && zone !== "z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    const offsetMin = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0);
    at -= sign * offsetMin * 6e4;
  }
  return at;
}
function minutesSince(value, nowMs = Date.now()) {
  const at = parseTimestamp(value);
  if (at === null) return Infinity;
  return (nowMs - at) / 6e4;
}

// core/format.js
var BITS = new DataView(new ArrayBuffer(8));
function decompose(magnitude) {
  BITS.setFloat64(0, magnitude);
  const hi = BITS.getUint32(0);
  const lo = BITS.getUint32(4);
  const biasedExponent = hi >>> 20 & 2047;
  const fraction = BigInt(hi & 1048575) << 32n | BigInt(lo);
  if (biasedExponent === 0) return { m: fraction, e: -1074 };
  return { m: fraction | 1n << 52n, e: biasedExponent - 1075 };
}
function roundScaled(magnitude, digits) {
  const { m, e } = decompose(magnitude);
  const numerator = m * 10n ** BigInt(digits);
  if (e >= 0) return numerator << BigInt(e);
  const denominator = 1n << BigInt(-e);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder * 2n;
  return doubled >= denominator ? quotient + 1n : quotient;
}
function fixed(value, digits = 0) {
  const d = Math.trunc(digits);
  if (d < 0 || d > 20) throw new RangeError("digits must be between 0 and 20");
  const x = Number(value);
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "Infinity" : "-Infinity";
  if (Math.abs(x) >= 1e21) return String(x);
  const negative = x < 0;
  const n = roundScaled(Math.abs(x), d);
  let s = n.toString();
  if (d > 0) {
    s = s.padStart(d + 1, "0");
    s = `${s.slice(0, s.length - d)}.${s.slice(s.length - d)}`;
  }
  return negative ? `-${s}` : s;
}

// core/scoring.js
var MIN_COVERAGE = 0.6;
var RISK_FREE_RATE = 0.042;
var EQUITY_RISK_PREMIUM = 0.05;
var DEFAULT_BETA = 1;
var MIN_BETA = 0.6;
var MAX_BETA = 2.5;
var MIN_WACC = 0.06;
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
function ratio(numerator, denominator, { allowNegativeDenominator = false } = {}) {
  const a = num(numerator);
  const b = num(denominator);
  if (a === null || b === null || b === 0) return null;
  if (!allowNegativeDenominator && b < 0) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}
var round = (v, dp = 2) => v === null ? null : Number(fixed(v, dp));
function calculateAltmanZScore(params) {
  const {
    workingCapital,
    retainedEarnings,
    ebit,
    marketCap,
    totalLiabilities,
    totalRevenue,
    totalAssets
  } = params;
  const assets = num(totalAssets);
  if (assets === null || assets <= 0) return null;
  const X1 = ratio(workingCapital, assets, { allowNegativeDenominator: true });
  const X2 = ratio(retainedEarnings, assets);
  const X3 = ratio(ebit, assets);
  const X4 = ratio(marketCap, totalLiabilities);
  const X5 = ratio(totalRevenue, assets);
  if ([X1, X2, X3, X4, X5].some((t) => t === null)) return null;
  return round(1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * X4 + 0.999 * X5);
}
function calculatePiotroskiFScore(current, prior) {
  if (!current || !prior) return null;
  const details = [];
  let score = 0;
  let testable = 0;
  const test = (id, name, passed) => {
    if (passed === null) {
      details.push({ id, name, passed: null, available: false });
      return;
    }
    testable++;
    if (passed) score++;
    details.push({ id, name, passed, available: true });
  };
  const gt = (a, b) => num(a) === null || num(b) === null ? null : a > b;
  const lte = (a, b) => num(a) === null || num(b) === null ? null : a <= b;
  test("f1", "Positive net income", num(current.netIncome) === null ? null : current.netIncome > 0);
  test("f2", "Positive operating cash flow", num(current.operatingCashFlow) === null ? null : current.operatingCashFlow > 0);
  test(
    "f3",
    "Return on assets improved",
    gt(ratio(current.netIncome, current.totalAssets), ratio(prior.netIncome, prior.totalAssets))
  );
  test("f4", "Operating cash flow exceeds net income", gt(current.operatingCashFlow, current.netIncome));
  test(
    "f5",
    "Leverage steady or lower",
    lte(
      ratio(current.longTermDebt ?? current.totalDebt, current.totalAssets),
      ratio(prior.longTermDebt ?? prior.totalDebt, prior.totalAssets)
    )
  );
  test(
    "f6",
    "Current ratio improved",
    gt(
      ratio(current.currentAssets, current.currentLiabilities),
      ratio(prior.currentAssets, prior.currentLiabilities)
    )
  );
  test("f7", "No share dilution", lte(current.dilutedShares, prior.dilutedShares));
  test(
    "f8",
    "Gross margin expanded",
    gt(ratio(current.grossProfit, current.revenue), ratio(prior.grossProfit, prior.revenue))
  );
  test(
    "f9",
    "Asset turnover improved",
    gt(ratio(current.revenue, current.totalAssets), ratio(prior.revenue, prior.totalAssets))
  );
  if (testable < 6) return null;
  return {
    score,
    testable,
    maxScore: 9,
    // Scaled to the canonical 0-9 range when a filer omits a line item, so a
    // bank's 7-of-7 is comparable with an industrial's 9-of-9.
    normalised: testable === 9 ? score : Math.round(score / testable * 9),
    details
  };
}
function calculateROIC({ ebit, taxRate, totalDebt, equity, cash }) {
  const operating = num(ebit);
  if (operating === null) return null;
  const rate = num(taxRate);
  const effectiveTax = rate !== null && rate >= 0 && rate < 0.6 ? rate : null;
  if (effectiveTax === null) return null;
  const debt = num(totalDebt) ?? 0;
  const eq = num(equity);
  const liquid = num(cash) ?? 0;
  if (eq === null) return null;
  const invested = debt + eq - liquid;
  if (invested <= 0) return null;
  return round(operating * (1 - effectiveTax) / invested * 100);
}
function estimateWACC({ beta, marketCap, totalDebt, interestExpense, taxRate }) {
  const equityValue = num(marketCap);
  if (equityValue === null || equityValue <= 0) return null;
  const debt = num(totalDebt) ?? 0;
  const total = equityValue + debt;
  if (total <= 0) return null;
  const rawBeta = num(beta) ?? DEFAULT_BETA;
  const usedBeta = Math.min(MAX_BETA, Math.max(MIN_BETA, rawBeta));
  const costOfEquity = RISK_FREE_RATE + usedBeta * EQUITY_RISK_PREMIUM;
  let costOfDebt = ratio(interestExpense, debt);
  if (costOfDebt === null || costOfDebt <= 0 || costOfDebt > 0.25) {
    costOfDebt = RISK_FREE_RATE + 0.015;
  }
  const tax = num(taxRate);
  const afterTaxDebt = costOfDebt * (1 - (tax !== null && tax >= 0 && tax < 0.6 ? tax : 0.21));
  const wacc = costOfEquity * (equityValue / total) + afterTaxDebt * (debt / total);
  return round(Math.max(MIN_WACC, wacc) * 100);
}
function calculateDCFFairValue(params) {
  const {
    trailingFCF,
    growthRate = 0.12,
    terminalMultiple = 20,
    discountRate = 0.095,
    cashReserves = 0,
    totalDebt = 0,
    sharesOutstanding
  } = params;
  const fcf0 = num(trailingFCF);
  const shares = num(sharesOutstanding);
  if (fcf0 === null || fcf0 <= 0) {
    return { applicable: false, reason: "negative-fcf", fairValuePerShare: null };
  }
  if (shares === null || shares <= 0) {
    return { applicable: false, reason: "no-share-count", fairValuePerShare: null };
  }
  if (discountRate <= 0) {
    return { applicable: false, reason: "invalid-discount-rate", fairValuePerShare: null };
  }
  const pvCashFlows = [];
  let currentFCF = fcf0;
  for (let t = 1; t <= 5; t++) {
    currentFCF *= 1 + growthRate;
    pvCashFlows.push({
      year: t,
      projectedFCF: currentFCF,
      presentValue: currentFCF / Math.pow(1 + discountRate, t)
    });
  }
  const cumulativePV = pvCashFlows.reduce((s, i) => s + i.presentValue, 0);
  const terminalValue = currentFCF * terminalMultiple;
  const pvTerminalValue = terminalValue / Math.pow(1 + discountRate, 5);
  const enterpriseValue = cumulativePV + pvTerminalValue;
  const equityValue = enterpriseValue + (num(cashReserves) ?? 0) - (num(totalDebt) ?? 0);
  return {
    applicable: true,
    fairValuePerShare: round(equityValue / shares),
    cumulativePV: round(cumulativePV),
    terminalValue: round(terminalValue),
    pvTerminalValue: round(pvTerminalValue),
    enterpriseValue: round(enterpriseValue),
    equityValue: round(equityValue),
    pvCashFlows
  };
}
function deriveMetrics(model) {
  const q = model.quote || {};
  const cur = model.latest || {};
  const prior = model.prior || {};
  const hist = model.history || {};
  const carried = model.latestReported || {};
  const withCarry = (field) => {
    const direct = num(cur[field]);
    if (direct !== null) return { value: direct, asOf: cur.asOfDate, carried: false };
    const fallback = carried[field];
    if (fallback && num(fallback.value) !== null) {
      return { value: fallback.value, asOf: fallback.asOfDate, carried: true };
    }
    return { value: null, asOf: null, carried: false };
  };
  const totalAssetsRaw = num(cur.totalAssets);
  const equityRaw = num(cur.equity);
  const liabilitiesRaw = num(cur.totalLiabilities);
  const totalLiabilities = liabilitiesRaw ?? (totalAssetsRaw !== null && equityRaw !== null ? totalAssetsRaw - equityRaw : null);
  const cash = sum(cur.cash, cur.shortTermInvestments);
  const totalDebt = num(cur.totalDebt);
  const netCash = cash === null || totalDebt === null ? null : cash - totalDebt;
  const workingCapital = num(cur.currentAssets) === null || num(cur.currentLiabilities) === null ? null : cur.currentAssets - cur.currentLiabilities;
  const reportedTaxRate = ratio(cur.taxProvision, cur.pretaxIncome);
  const taxRateUsable = reportedTaxRate !== null && reportedTaxRate >= 0 && reportedTaxRate < 0.6;
  const effectiveTaxRate = taxRateUsable ? reportedTaxRate : null;
  const appliedTaxRate = taxRateUsable ? reportedTaxRate : 0.21;
  const operatingIncome = num(cur.operatingIncome) ?? num(cur.ebit);
  const grossMargin = ratio(cur.grossProfit, cur.revenue);
  const operatingMargin = ratio(operatingIncome, cur.revenue);
  const priorGrossMargin = ratio(prior.grossProfit, prior.revenue);
  const priorOperatingMargin = ratio(
    num(prior.operatingIncome) ?? num(prior.ebit),
    prior.revenue
  );
  const interest = withCarry("interestExpense");
  let interestCoverage = null;
  let interestCoverageUnburdened = false;
  if (totalDebt === 0 || totalDebt !== null && interest.value === 0) {
    interestCoverageUnburdened = true;
  } else if (totalDebt !== null) {
    interestCoverage = ratio(cur.ebit ?? operatingIncome, interest.value, {
      allowNegativeDenominator: false
    });
  }
  const equity = num(cur.equity);
  const sharesForCap = num(q.sharesOutstanding) ?? num(cur.dilutedShares);
  const priceReporting = num(q.priceReporting) ?? (model.fx?.needed ? null : num(q.price));
  const marketCap = num(q.marketCapReporting) ?? (priceReporting !== null && sharesForCap !== null ? priceReporting * sharesForCap : null);
  const enterpriseValue = marketCap === null || totalDebt === null || cash === null ? null : marketCap + totalDebt - cash;
  const roic = calculateROIC({
    ebit: cur.ebit ?? operatingIncome,
    taxRate: appliedTaxRate,
    totalDebt,
    equity,
    cash
  });
  const wacc = estimateWACC({
    beta: q.beta,
    marketCap,
    totalDebt,
    interestExpense: interest.value,
    taxRate: appliedTaxRate
  });
  const altmanZ = model.isFinancial ? null : calculateAltmanZScore({
    workingCapital,
    retainedEarnings: cur.retainedEarnings,
    ebit: cur.ebit ?? operatingIncome,
    marketCap,
    totalLiabilities,
    totalRevenue: cur.revenue,
    totalAssets: cur.totalAssets
  });
  const piotroski = calculatePiotroskiFScore(
    model.latest ? { ...cur, longTermDebt: cur.longTermDebt } : null,
    model.prior ? { ...prior, longTermDebt: prior.longTermDebt } : null
  );
  const fcf = num(cur.freeCashFlow);
  const dividendPayoutOnFcf = ratio(cur.dividendsPaid, cur.freeCashFlow);
  return {
    fiscalPeriodEnd: cur.asOfDate || null,
    isFinancial: Boolean(model.isFinancial),
    revenue: num(cur.revenue),
    netIncome: num(cur.netIncome),
    ebit: num(cur.ebit) ?? operatingIncome,
    ebitda: num(cur.ebitda),
    freeCashFlow: fcf,
    operatingCashFlow: num(cur.operatingCashFlow),
    cash,
    totalDebt,
    netCash,
    netCashB: netCash === null ? null : round(netCash / 1e9),
    equity,
    workingCapital,
    grossMargin,
    operatingMargin,
    fcfMargin: ratio(cur.freeCashFlow, cur.revenue),
    grossMarginChangeBps: grossMargin === null || priorGrossMargin === null ? null : Math.round((grossMargin - priorGrossMargin) * 1e4),
    operatingMarginChangeBps: operatingMargin === null || priorOperatingMargin === null ? null : Math.round((operatingMargin - priorOperatingMargin) * 1e4),
    currentRatio: ratio(cur.currentAssets, cur.currentLiabilities),
    quickRatio: num(cur.currentAssets) === null || num(cur.currentLiabilities) === null ? null : ratio(cur.currentAssets - (num(cur.inventory) ?? 0), cur.currentLiabilities),
    interestCoverage,
    interestCoverageUnburdened,
    interestExpense: interest.value,
    interestExpenseAsOf: interest.asOf,
    interestExpenseCarried: interest.carried,
    equityToAssets: ratio(cur.equity, cur.totalAssets),
    totalLiabilities,
    totalLiabilitiesDerived: liabilitiesRaw === null && totalLiabilities !== null,
    netDebtToEbitda: netCash === null || num(cur.ebitda) === null || cur.ebitda <= 0 ? null : round(-netCash / cur.ebitda),
    debtToEquity: equity !== null && equity > 0 ? ratio(totalDebt, equity) : null,
    negativeEquity: equity !== null && equity <= 0,
    beta: num(q.beta),
    betaClamped: num(q.beta) !== null && (q.beta < 0.6 || q.beta > 2.5),
    effectiveTaxRate,
    appliedTaxRate,
    taxRateEstimated: !taxRateUsable,
    roic,
    wacc,
    roicSpread: roic === null || wacc === null ? null : round(roic - wacc),
    roa: ratio(cur.netIncome, cur.totalAssets),
    roe: equity !== null && equity > 0 ? ratio(cur.netIncome, equity) : null,
    assetTurnover: ratio(cur.revenue, cur.totalAssets),
    fcfConversion: ratio(cur.freeCashFlow, cur.netIncome),
    fcfYield: ratio(cur.freeCashFlow, marketCap),
    evToFcfYield: ratio(cur.freeCashFlow, enterpriseValue),
    enterpriseValue,
    altmanZ,
    piotroski,
    revenueCAGR: hist.revenueCAGR ?? null,
    revenueChangeLatest: hist.revenueChangeLatest ?? null,
    revenueChangeYears: hist.revenueChangeYears ?? null,
    freeCashFlowLatest: hist.freeCashFlowLatest ?? null,
    freeCashFlowNormalised: hist.freeCashFlowNormalised ?? null,
    epsCAGR: hist.epsCAGR ?? null,
    fcfPerShareCAGR: hist.fcfPerShareCAGR ?? null,
    shareChangeYoY: hist.shareChangeYoY ?? null,
    shareChangeYears: hist.shareChangeYears ?? null,
    shareChangeIsAnnual: hist.shareChangeIsAnnual ?? null,
    cagrYears: hist.cagrYears ?? null,
    // Compound annual rate implied by the change, so a multi-year span is
    // comparable with a genuine one-year move.
    shareChangeAnnualisedPct: (() => {
      const change = hist.shareChangeYoY;
      if (change === null || change === void 0) return null;
      const years = hist.shareChangeYears || 1;
      if (years <= 1) return Number(fixed(change * 100, 2));
      return Number(fixed((Math.pow(1 + change, 1 / years) - 1) * 100, 2));
    })(),
    fcfPositiveYears: (hist.freeCashFlow || []).filter((v) => v !== null && v > 0).length,
    fcfReportedYears: (hist.freeCashFlow || []).filter((v) => v !== null).length,
    quarterlyGrossMarginTrend: quarterlyMarginTrend(model.quarterly),
    dividendYield: num(q.dividendYield),
    dividendPayoutOnFcf,
    dividendStreakYears: dividendStreak(model.annual),
    trailingPE: num(q.trailingPE),
    forwardPE: num(q.forwardPE),
    pegRatio: num(q.pegRatio),
    priceToBook: num(q.priceToBook),
    marketCap,
    marketCapDerived: num(q.marketCapReporting) === null && marketCap !== null,
    // `price` is the figure every ratio here is computed against, so it is the
    // one in the reporting currency. The traded price is carried separately.
    price: priceReporting,
    tradedPrice: num(q.price),
    tradedCurrency: model.tradedCurrency ?? q.currency ?? null,
    reportingCurrency: model.reportingCurrency ?? null,
    fx: model.fx ?? null,
    sharesOutstanding: sharesForCap
  };
}
function sum(...values) {
  const present = values.map(num).filter((v) => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}
function quarterlyMarginTrend(quarters) {
  if (!Array.isArray(quarters) || quarters.length < 3) return null;
  const margins = quarters.map((q) => ratio(q.grossProfit, q.revenue)).filter((m) => m !== null);
  if (margins.length < 3) return null;
  let declines = 0;
  for (let i = 1; i < margins.length; i++) {
    if (margins[i] < margins[i - 1]) declines++;
  }
  return {
    quarters: margins.length,
    changeBps: Math.round((margins[margins.length - 1] - margins[0]) * 1e4),
    consecutiveDeclines: declines,
    margins: margins.map((m) => Number(fixed(m * 100, 1)))
  };
}
function dividendStreak(annual) {
  if (!Array.isArray(annual) || !annual.length) return null;
  let streak = 0;
  for (let i = annual.length - 1; i >= 0; i--) {
    const paid = num(annual[i].dividendsPaid);
    if (paid === null) break;
    if (paid > 0) streak++;
    else break;
  }
  return streak;
}
function band(value, bands, max) {
  if (value === null || value === void 0) {
    return { points: null, max, available: false };
  }
  for (const [threshold, points] of bands) {
    if (value >= threshold) return { points, max, available: true };
  }
  return { points: 0, max, available: true };
}
var fixed2 = (points, max) => ({ points, max, available: true });
var unavailable = (max) => ({ points: null, max, available: false });
function scorePillars(m) {
  const pillars = [];
  const p1 = [];
  if (m.isFinancial) {
    p1.push({
      // The plain-language form of the regulatory leverage ratio, and the
      // right solvency question to ask of a lender.
      name: "Equity to assets",
      ...band(
        m.equityToAssets === null ? null : m.equityToAssets * 100,
        [[10, 5], [8, 4], [6, 2.5]],
        5
      )
    });
  } else {
    p1.push({ name: "Altman Z-Score", ...band(m.altmanZ, [[3, 5], [1.8, 3]], 5) });
    p1.push({
      name: "Net debt / EBITDA",
      ...m.netCash !== null && m.netCash > 0 ? fixed2(5, 5) : band(
        m.netDebtToEbitda === null ? null : -m.netDebtToEbitda,
        [[-1.5, 4], [-3, 2]],
        5
      )
    });
    p1.push({
      name: "Interest coverage",
      ...m.interestCoverageUnburdened ? fixed2(5, 5) : band(m.interestCoverage, [[8, 5], [4, 3], [1.5, 1]], 5)
    });
    p1.push({
      name: "Current & quick ratio",
      ...m.currentRatio === null ? unavailable(5) : m.currentRatio >= 1.5 && (m.quickRatio === null || m.quickRatio >= 1) ? fixed2(5, 5) : band(m.currentRatio, [[1.5, 4], [1, 3]], 5)
    });
  }
  pillars.push({ name: "Financial Health & Solvency", items: p1 });
  const p2 = [];
  p2.push({
    name: "Piotroski F-Score",
    ...band(m.piotroski?.normalised ?? null, [[8, 5], [6, 3.5], [4, 2]], 5)
  });
  if (m.isFinancial) {
    p2.push({
      name: "Return on equity",
      ...band(m.roe === null ? null : m.roe * 100, [[15, 5], [10, 3.5], [6, 2]], 5)
    });
  } else {
    p2.push({ name: "Return on invested capital", ...band(m.roic, [[15, 5], [10, 3.5], [5, 2]], 5) });
    p2.push({
      // The spec scores the trend, not the level: a 25% margin compressing from
      // 40% is a different business from one expanding towards 25%.
      name: "Operating margin trend",
      ...band(m.operatingMarginChangeBps, [[100, 5], [-50, 3.5], [-200, 1.5]], 5)
    });
  }
  p2.push({
    name: "Free cash flow conversion",
    ...band(
      m.fcfConversion === null ? null : m.fcfConversion * 100,
      [[100, 5], [80, 3.5], [50, 2]],
      5
    )
  });
  pillars.push({ name: "Profitability & Moat Quality", items: p2 });
  const p3 = [];
  p3.push({
    name: "Forward P/E vs. own history",
    ...m.peVsHistoryPct === null || m.peVsHistoryPct === void 0 ? band(m.forwardPE === null ? null : -m.forwardPE, [[-18, 5], [-26, 3.5], [-35, 2]], 5) : band(-m.peVsHistoryPct, [[15, 5], [-10, 3.5], [-25, 2]], 5)
  });
  p3.push({
    // A negative PEG means earnings are shrinking; that is a growth signal,
    // not a cheapness signal, so it is excluded rather than scored as cheap.
    name: "PEG ratio",
    ...m.pegRatio === null || m.pegRatio <= 0 ? unavailable(5) : band(-m.pegRatio, [[-1, 5], [-1.8, 3.5], [-2.5, 2]], 5)
  });
  p3.push({
    name: "EV / free cash flow yield",
    ...band(
      m.evToFcfYield === null ? null : m.evToFcfYield * 100,
      [[6, 5], [4, 3.5], [2, 2]],
      5
    )
  });
  p3.push({
    name: "Discount to DCF fair value",
    ...band(m.dcfDiscountPct, [[20, 5], [-10, 3], [-20, 1]], 5)
  });
  pillars.push({ name: "Valuation & Margin of Safety", items: p3 });
  const p4 = [];
  p4.push({
    name: "Revenue CAGR",
    ...band(m.revenueCAGR === null ? null : m.revenueCAGR * 100, [[15, 5], [8, 3.5], [3, 2]], 5)
  });
  p4.push({
    name: "Diluted EPS CAGR",
    ...band(m.epsCAGR === null ? null : m.epsCAGR * 100, [[20, 5], [10, 3.5], [0, 1.5]], 5)
  });
  if (!m.isFinancial) {
    p4.push({
      name: "FCF per share CAGR",
      ...band(
        m.fcfPerShareCAGR === null ? null : m.fcfPerShareCAGR * 100,
        [[15, 5], [5, 3.5], [0, 1.5]],
        5
      )
    });
    p4.push({
      name: "Gross margin trajectory",
      ...m.quarterlyGrossMarginTrend ? band(m.quarterlyGrossMarginTrend.changeBps, [[0, 5], [-100, 3.5], [-300, 1.5]], 5) : band(m.grossMarginChangeBps, [[0, 5], [-100, 3.5], [-300, 1.5]], 5)
    });
  }
  pillars.push({ name: "Growth & Operating Leverage", items: p4 });
  const p5 = [];
  p5.push({
    name: "Buybacks vs. dilution",
    // Annualised where a filing gap makes the change span more than one year,
    // so a two-year buyback is not scored as if it happened in twelve months.
    ...band(
      m.shareChangeAnnualisedPct === null ? null : -m.shareChangeAnnualisedPct,
      [[2, 7], [-0.5, 5], [-2, 2]],
      7
    )
  });
  const isPayer = m.dividendYield !== null && m.dividendYield > 0;
  if (isPayer) {
    const covered = m.dividendPayoutOnFcf !== null && m.dividendPayoutOnFcf < 0.6;
    const longStreak = (m.dividendStreakYears ?? 0) >= 5;
    p5.push({
      name: "Dividend safety & coverage",
      ...m.dividendPayoutOnFcf === null ? unavailable(7) : fixed2(covered && longStreak ? 7 : covered ? 5.5 : m.dividendPayoutOnFcf < 0.9 ? 3 : 1, 7)
    });
  } else {
    p5.push({
      name: "Reinvestment quality",
      ...band(m.roic, [[15, 7], [10, 5], [5, 3]], 7)
    });
  }
  p5.push({
    // Scored against the sector when enough peers are cached, because a
    // grocer and a software company are not comparable on turnover.
    name: "Asset turnover efficiency",
    ...m.sectorMedianAssetTurnover ? band(
      m.assetTurnover === null ? null : m.assetTurnover / m.sectorMedianAssetTurnover,
      [[1.25, 6], [0.9, 4.5], [0.6, 3]],
      6
    ) : band(m.assetTurnover, [[0.8, 6], [0.4, 4]], 6)
  });
  pillars.push({ name: "Capital Allocation & Returns", items: p5 });
  return pillars;
}
var NA = { status: "na", value: "Not reported" };
function buildChecklist(m, fmt) {
  const pct = (v, dp = 1) => v === null ? null : `${fixed(v * 100, dp)}%`;
  const item = (id, name, category, explanation, body) => ({
    id,
    name,
    category,
    explanation,
    ...body || NA
  });
  return [
    item(
      1,
      "Altman Z-Score",
      "Solvency",
      "Probability of financial distress within two years, from working capital, retained earnings and asset efficiency. Not defined for banks, insurers or REITs.",
      m.altmanZ === null ? m.isFinancial ? { status: "na", value: "N/A for financials", benchmark: "Z \u2265 3.0" } : { status: "na", value: "Not reported", benchmark: "Z \u2265 3.0" } : {
        value: fixed(m.altmanZ, 2),
        benchmark: "Z \u2265 3.0 safe zone",
        status: m.altmanZ >= 3 ? "pass" : m.altmanZ >= 1.8 ? "watch" : "fail"
      }
    ),
    item(
      2,
      "Interest Coverage",
      "Solvency",
      "Operating profit as a multiple of interest owed. A company with no debt has no interest burden to cover.",
      m.interestCoverageUnburdened ? { value: "No debt burden", benchmark: "> 6.0\xD7 EBIT / interest", status: "pass" } : m.interestCoverage === null ? { ...NA, benchmark: "> 6.0\xD7 EBIT / interest" } : {
        value: `${fixed(m.interestCoverage, 1)}\xD7`,
        benchmark: "> 6.0\xD7 EBIT / interest",
        status: m.interestCoverage >= 6 ? "pass" : m.interestCoverage >= 2.5 ? "watch" : "fail"
      }
    ),
    item(
      3,
      "Current Ratio",
      "Liquidity",
      "Short-term assets against short-term obligations. Banks do not classify their balance sheets this way.",
      m.currentRatio === null ? { status: "na", value: m.isFinancial ? "N/A for financials" : "Not reported", benchmark: "\u2265 1.50" } : {
        value: fixed(m.currentRatio, 2) + (m.quickRatio !== null ? ` (quick ${fixed(m.quickRatio, 2)})` : ""),
        benchmark: "\u2265 1.50 current assets / liabilities",
        status: m.currentRatio >= 1.5 ? "pass" : m.currentRatio >= 1 ? "watch" : "fail"
      }
    ),
    item(
      4,
      "Debt to Equity",
      "Solvency",
      "Leverage against book equity. Negative equity \u2014 usually from sustained buybacks \u2014 is reported as its own state rather than scored as low leverage.",
      m.negativeEquity ? { value: "Negative book equity", benchmark: "< 0.8\xD7 or net cash", status: "fail" } : m.netCash !== null && m.netCash > 0 ? { value: `Net cash ${fmt(m.netCash)}`, benchmark: "< 0.8\xD7 or net cash", status: "pass" } : m.debtToEquity === null ? { ...NA, benchmark: "< 0.8\xD7 or net cash" } : {
        value: `${fixed(m.debtToEquity, 2)}\xD7`,
        benchmark: "< 0.8\xD7 or net cash",
        status: m.debtToEquity < 0.8 ? "pass" : m.debtToEquity <= 1.8 ? "watch" : "fail"
      }
    ),
    item(
      5,
      "Free Cash Flow History",
      "Cash Flow",
      "Owner earnings after the capital spending needed to keep the business running, across every filed year.",
      m.fcfReportedYears === 0 ? { ...NA, benchmark: "Positive every filed year" } : {
        value: `${m.fcfPositiveYears} of ${m.fcfReportedYears} years positive`,
        benchmark: "Positive every filed year",
        status: m.fcfPositiveYears === m.fcfReportedYears ? "pass" : m.fcfReportedYears - m.fcfPositiveYears === 1 ? "watch" : "fail"
      }
    ),
    item(
      6,
      "Piotroski F-Score",
      "Quality",
      "Nine fundamental tests across profitability, leverage and efficiency, six of which compare against the prior filed year.",
      !m.piotroski ? { ...NA, benchmark: "\u2265 7 of 9" } : {
        value: `${m.piotroski.score}/${m.piotroski.testable}` + (m.piotroski.testable < 9 ? ` (${m.piotroski.normalised}/9 scaled)` : ""),
        benchmark: "\u2265 7 of 9 points",
        status: m.piotroski.normalised >= 7 ? "pass" : m.piotroski.normalised >= 5 ? "watch" : "fail"
      }
    ),
    item(
      7,
      "ROIC vs. Cost of Capital",
      "Economic Moat",
      "Return on invested capital against an estimated WACC (CAPM cost of equity from the stock beta, plus its actual cost of debt). A durable moat earns well above its cost of capital.",
      m.roic === null ? { ...NA, benchmark: "ROIC \u2265 WACC + 5 pts" } : m.wacc === null ? {
        value: `${fixed(m.roic, 1)}% ROIC`,
        benchmark: "ROIC \u2265 15%",
        status: m.roic >= 15 ? "pass" : m.roic >= 9 ? "watch" : "fail"
      } : {
        value: `${fixed(m.roic, 1)}% vs ${fixed(m.wacc, 1)}% WACC`,
        benchmark: "ROIC \u2265 WACC + 5 pts",
        status: m.roicSpread >= 5 ? "pass" : m.roicSpread >= 0 ? "watch" : "fail"
      }
    ),
    item(
      8,
      "Gross Margin Consistency",
      "Pricing Power",
      "Direction of gross margin, which is where pricing power shows up first. Measured across filed quarters where available, otherwise year on year.",
      (() => {
        const t = m.quarterlyGrossMarginTrend;
        if (t) {
          return {
            value: `${t.changeBps >= 0 ? "+" : ""}${t.changeBps} bps over ${t.quarters} quarters`,
            benchmark: "Expanding or steady",
            status: t.changeBps >= 0 ? "pass" : t.changeBps >= -100 ? "watch" : "fail"
          };
        }
        if (m.grossMarginChangeBps === null) return { ...NA, benchmark: "Expanding or steady" };
        return {
          value: `${m.grossMarginChangeBps >= 0 ? "+" : ""}${m.grossMarginChangeBps} bps YoY` + (m.grossMargin !== null ? ` (now ${pct(m.grossMargin)})` : ""),
          benchmark: "Expanding or steady",
          status: m.grossMarginChangeBps >= 0 ? "pass" : m.grossMarginChangeBps >= -100 ? "watch" : "fail"
        };
      })()
    ),
    item(
      9,
      "Share Dilution & Buybacks",
      "Capital Return",
      "Change in the diluted share count. Buybacks lift per-share value; stock compensation quietly erodes it.",
      m.shareChangeYoY === null ? { ...NA, benchmark: "Shrinking or < 0.5% a year" } : {
        value: `${m.shareChangeYoY <= 0 ? "" : "+"}${fixed(m.shareChangeYoY * 100, 1)}%` + (m.shareChangeYoY < 0 ? " (buybacks)" : " dilution") + // Say so when a filing gap means this is not a one-year change.
        (m.shareChangeIsAnnual === false && m.shareChangeYears ? ` over ${m.shareChangeYears} years` : ""),
        benchmark: "Shrinking or < 0.5% a year",
        status: m.shareChangeAnnualisedPct <= 0.5 ? "pass" : m.shareChangeAnnualisedPct <= 2.5 ? "watch" : "fail"
      }
    ),
    item(
      10,
      "FCF / Net Income Quality",
      "Earnings Quality",
      "How much reported profit arrives as cash. A persistent gap points to aggressive accrual accounting.",
      m.fcfConversion === null ? { ...NA, benchmark: "> 90% conversion" } : {
        value: `${fixed(m.fcfConversion * 100, 0)}% conversion`,
        benchmark: "> 90% conversion",
        status: m.fcfConversion >= 0.9 ? "pass" : m.fcfConversion >= 0.6 ? "watch" : "fail"
      }
    ),
    item(
      11,
      "Valuation PEG Ratio",
      "Valuation",
      "Price/earnings against expected growth. Undefined when growth is negative \u2014 a shrinking business is not cheap, it is shrinking.",
      m.pegRatio === null ? { ...NA, benchmark: "PEG \u2264 1.50" } : m.pegRatio <= 0 ? { status: "na", value: "N/A \u2014 negative growth", benchmark: "PEG \u2264 1.50" } : {
        value: `${fixed(m.pegRatio, 2)}\xD7`,
        benchmark: "PEG \u2264 1.50",
        status: m.pegRatio <= 1.5 ? "pass" : m.pegRatio <= 2.2 ? "watch" : "fail"
      }
    ),
    item(
      12,
      "Revenue Growth",
      "Growth",
      "Compound revenue growth across the filed years.",
      m.revenueCAGR === null ? { ...NA, benchmark: "> 8% CAGR" } : {
        value: `${m.revenueCAGR >= 0 ? "+" : ""}${fixed(m.revenueCAGR * 100, 1)}% CAGR` + (m.cagrYears ? ` (${m.cagrYears}Y)` : ""),
        benchmark: "> 8% CAGR",
        status: m.revenueCAGR >= 0.08 ? "pass" : m.revenueCAGR >= 0.02 ? "watch" : "fail"
      }
    )
  ];
}
function buildInsights(m, fmt) {
  const catalysts = [];
  const risks = [];
  if (m.netCash !== null && m.netCash > 0 && m.cash !== null && m.totalDebt !== null && !m.isFinancial) {
    catalysts.push({
      icon: "\u{1F48E}",
      title: "Fortress balance sheet",
      text: `Cash and short-term investments of ${fmt(m.cash)} exceed total debt of ${fmt(m.totalDebt)}, leaving ${fmt(m.netCash)} net cash.`
    });
  }
  if (m.roic !== null && m.roic >= 18) {
    catalysts.push({
      icon: "\u{1F680}",
      title: "Elite capital efficiency",
      text: `ROIC of ${fixed(m.roic, 1)}%${m.wacc !== null ? `, ${fixed(m.roic - m.wacc, 1)} points above its estimated ${fixed(m.wacc, 1)}% cost of capital` : ""}.`
    });
  }
  if (m.fcfConversion !== null && m.fcfConversion >= 1) {
    catalysts.push({
      icon: "\u{1F4B0}",
      title: "Earnings arrive as cash",
      text: `Free cash flow is ${fixed(m.fcfConversion * 100, 0)}% of reported net income.`
    });
  }
  if (m.grossMargin !== null && m.grossMargin >= 0.6) {
    catalysts.push({
      icon: "\u26A1",
      title: "Pricing power",
      text: `Gross margin of ${fixed(m.grossMargin * 100, 1)}% absorbs input-cost inflation without repricing.`
    });
  }
  if (m.shareChangeYoY !== null && m.shareChangeYoY < -0.01) {
    const span = m.shareChangeIsAnnual === false && m.shareChangeYears ? `over ${m.shareChangeYears} filed years` : "year on year";
    catalysts.push({
      icon: "\u{1F4C8}",
      title: "Accretive buybacks",
      text: `Diluted share count fell ${fixed(Math.abs(m.shareChangeYoY * 100), 1)}% ${span}.`
    });
  }
  if (m.operatingMarginChangeBps !== null && m.operatingMarginChangeBps >= 150) {
    catalysts.push({
      icon: "\u{1F4CA}",
      title: "Operating leverage",
      text: `Operating margin expanded ${m.operatingMarginChangeBps} bps year on year.`
    });
  }
  if (m.negativeEquity) {
    risks.push({
      icon: "\u26A0\uFE0F",
      title: "Negative book equity",
      text: "Liabilities exceed assets on a book basis. Common after sustained buybacks, but it removes the equity cushion and makes leverage ratios undefined."
    });
  }
  if (m.netDebtToEbitda !== null && m.netDebtToEbitda > 3) {
    risks.push({
      icon: "\u26A0\uFE0F",
      title: "Elevated leverage",
      text: `Net debt is ${fixed(m.netDebtToEbitda, 1)}\xD7 EBITDA, which limits flexibility if rates stay high.`
    });
  }
  if (m.shareChangeAnnualisedPct !== null && m.shareChangeAnnualisedPct > 2) {
    risks.push({
      icon: "\u26A0\uFE0F",
      title: "Shareholder dilution",
      text: `Diluted share count rose ${fixed(m.shareChangeAnnualisedPct, 1)}% a year.`
    });
  }
  if (m.forwardPE !== null && m.forwardPE > 40) {
    risks.push({
      icon: "\u26A0\uFE0F",
      title: "Demanding valuation",
      text: `A forward P/E of ${fixed(m.forwardPE, 1)}\xD7 leaves little room for execution error.`
    });
  }
  if (m.altmanZ !== null && m.altmanZ < 1.8) {
    risks.push({
      icon: "\u{1F6A8}",
      title: "Altman Z distress zone",
      text: `An Altman Z-Score of ${fixed(m.altmanZ, 2)} sits in the distress range.`
    });
  }
  if (m.roicSpread !== null && m.roicSpread < 0) {
    risks.push({
      icon: "\u26A0\uFE0F",
      title: "Returns below cost of capital",
      text: `ROIC of ${fixed(m.roic, 1)}% is under the estimated ${fixed(m.wacc, 1)}% WACC, so growth is destroying value.`
    });
  }
  if (m.fcfConversion !== null && m.fcfConversion < 0.6 && m.netIncome !== null && m.netIncome > 0) {
    risks.push({
      icon: "\u26A0\uFE0F",
      title: "Weak cash conversion",
      text: `Only ${fixed(m.fcfConversion * 100, 0)}% of net income converted to free cash flow.`
    });
  }
  if (m.quarterlyGrossMarginTrend && m.quarterlyGrossMarginTrend.changeBps <= -200) {
    risks.push({
      icon: "\u26A0\uFE0F",
      title: "Margin compression",
      text: `Gross margin fell ${Math.abs(m.quarterlyGrossMarginTrend.changeBps)} bps across the last ${m.quarterlyGrossMarginTrend.quarters} filed quarters.`
    });
  }
  return { catalysts: catalysts.slice(0, 4), risks: risks.slice(0, 4) };
}
function dcfCashFlowBase(m) {
  const latest = num(m.freeCashFlowLatest) ?? num(m.freeCashFlow);
  const normal = num(m.freeCashFlowNormalised);
  if (latest === null) return { value: null, basis: "unavailable", latest, normalised: normal };
  if (normal === null || normal <= 0) {
    return { value: latest, basis: "latest filed year", latest, normalised: normal };
  }
  const ratio2 = latest / normal;
  if (ratio2 > 1.35 || ratio2 < 0.65) {
    return {
      value: normal,
      basis: "three-year median \u2014 the latest filed year is an outlier",
      latest,
      normalised: normal,
      outlierRatio: round(ratio2)
    };
  }
  return { value: latest, basis: "latest filed year", latest, normalised: normal };
}
function dcfGrowthRate(m) {
  const rates = [m.revenueCAGR, m.epsCAGR, m.fcfPerShareCAGR].filter(
    (r) => r !== null && r !== void 0
  );
  let base;
  if (!rates.length) {
    base = 0.04;
  } else {
    const sorted = [...rates].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    base = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  const latestChange = num(m.revenueChangeLatest);
  if (latestChange !== null && latestChange < 0) {
    return {
      rate: Number(fixed(Math.max(-0.15, latestChange), 4)),
      basis: "revenue declined in the latest filed year, so the decline is projected rather than growth",
      unbounded: Number(fixed(base, 4))
    };
  }
  const ceiling = m.revenueCAGR !== null && m.revenueCAGR !== void 0 ? Math.min(0.2, m.revenueCAGR + 0.05) : 0.1;
  const rate = Number(fixed(Math.min(ceiling, Math.max(0, base)), 4));
  return {
    rate,
    basis: rate < base ? "capped at revenue growth plus 5 points \u2014 cash flow cannot outgrow the top line indefinitely" : "median of the filed compound growth rates",
    unbounded: Number(fixed(base, 4))
  };
}
function dcfTerminalMultiple(m) {
  let multiple = 15;
  if (m.roic !== null) {
    if (m.roic >= 25) multiple += 6;
    else if (m.roic >= 15) multiple += 4;
    else if (m.roic >= 10) multiple += 1;
    else if (m.roic < 6) multiple -= 3;
    if (m.roic < 0) multiple -= 2;
  }
  if (m.grossMargin !== null && m.grossMargin >= 0.6) multiple += 2;
  if (m.netCash !== null && m.netCash > 0) multiple += 1;
  if (m.netDebtToEbitda !== null && m.netDebtToEbitda > 3) multiple -= 2;
  return Math.min(26, Math.max(8, multiple));
}
function impliedGrowthRate({ price, fcf0, terminalMultiple, discountRate, cash, debt, shares }) {
  if ([price, fcf0, shares].some((v) => num(v) === null) || fcf0 <= 0 || shares <= 0 || price <= 0) {
    return null;
  }
  const valueAt = (g) => {
    let f = fcf0;
    let cum = 0;
    for (let t = 1; t <= 5; t++) {
      f *= 1 + g;
      cum += f / Math.pow(1 + discountRate, t);
    }
    const ev = cum + f * terminalMultiple / Math.pow(1 + discountRate, 5);
    return (ev + (cash ?? 0) - (debt ?? 0)) / shares;
  };
  let lo = -0.95;
  let hi = 1;
  if (valueAt(lo) > price) return null;
  if (valueAt(hi) < price) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (valueAt(mid) > price) hi = mid;
    else lo = mid;
  }
  return Number(fixed((lo + hi) / 2, 4));
}
function computeComprehensiveHealth(model = {}) {
  const metrics = deriveMetrics(model);
  const currency = model.reportingCurrency || model.quote?.currency || "USD";
  const fmt = (v) => formatMoney(v, currency);
  metrics.sectorMedianAssetTurnover = model.sectorMedianAssetTurnover ?? null;
  metrics.peVsHistoryPct = model.peVsHistoryPct ?? null;
  const cashFlowBase = dcfCashFlowBase(metrics);
  const growth = dcfGrowthRate(metrics);
  const terminalMultiple = dcfTerminalMultiple(metrics);
  const dcfInput = {
    trailingFCF: cashFlowBase.value,
    growthRate: growth.rate,
    terminalMultiple,
    discountRate: 0.095,
    cashReserves: metrics.cash ?? 0,
    totalDebt: metrics.totalDebt ?? 0,
    sharesOutstanding: metrics.sharesOutstanding
  };
  const dcf = model.isFinancial ? { applicable: false, reason: "not-meaningful-for-financials", fairValuePerShare: null } : calculateDCFFairValue(dcfInput);
  let dcfDiscountPct = null;
  let premiumToFairValuePct = null;
  if (dcf.applicable && dcf.fairValuePerShare !== null && metrics.price !== null) {
    if (dcf.fairValuePerShare > 0) {
      dcfDiscountPct = round(
        (dcf.fairValuePerShare - metrics.price) / dcf.fairValuePerShare * 100,
        1
      );
      premiumToFairValuePct = round(
        (metrics.price - dcf.fairValuePerShare) / dcf.fairValuePerShare * 100,
        1
      );
    } else {
      dcfDiscountPct = -100;
    }
  }
  metrics.dcfDiscountPct = dcfDiscountPct;
  const impliedGrowth = dcf.applicable ? impliedGrowthRate({
    price: metrics.price,
    fcf0: cashFlowBase.value,
    terminalMultiple,
    discountRate: 0.095,
    cash: metrics.cash,
    debt: metrics.totalDebt,
    shares: metrics.sharesOutstanding
  }) : null;
  const divergenceFactor = dcf.applicable && dcf.fairValuePerShare > 0 && metrics.price > 0 ? round(dcf.fairValuePerShare / metrics.price) : null;
  const divergenceWarning = divergenceFactor !== null && (divergenceFactor >= 3 || divergenceFactor <= 0.33);
  const rawPillars = scorePillars(metrics);
  let earned = 0;
  let possible = 0;
  let availableItems = 0;
  let totalItems = 0;
  const pillars = rawPillars.map((p) => {
    let pEarned = 0;
    let pPossible = 0;
    for (const it of p.items) {
      totalItems++;
      if (!it.available) continue;
      availableItems++;
      pEarned += it.points;
      pPossible += it.max;
    }
    earned += pEarned;
    possible += pPossible;
    const score = pPossible > 0 ? Number(fixed(pEarned / pPossible * 20, 1)) : null;
    return {
      name: p.name,
      score,
      max: 20,
      pct: score === null ? null : Math.round(score / 20 * 100),
      measured: p.items.filter((i) => i.available).length,
      of: p.items.length,
      items: p.items.map((i) => ({
        name: i.name,
        points: i.points,
        max: i.max,
        available: i.available
      }))
    };
  });
  const coveragePct = totalItems ? availableItems / totalItems : 0;
  const sufficient = coveragePct >= MIN_COVERAGE && possible > 0;
  const healthScore = sufficient ? Math.min(100, Math.max(0, Math.round(earned / possible * 100))) : null;
  let healthLabel, healthGrade, healthTier;
  if (healthScore === null) {
    healthLabel = "Not enough filed data to score";
    healthGrade = "INSUFFICIENT";
    healthTier = "insufficient";
  } else if (healthScore >= 85) {
    healthLabel = "Pristine financial health";
    healthGrade = "PRISTINE";
    healthTier = "pristine";
  } else if (healthScore >= 70) {
    healthLabel = "Solid moat and financials";
    healthGrade = "GOOD";
    healthTier = "good";
  } else if (healthScore >= 50) {
    healthLabel = "Mixed \u2014 watch the flagged items";
    healthGrade = "MODERATE";
    healthTier = "moderate";
  } else {
    healthLabel = "High leverage or distress risk";
    healthGrade = "RISK";
    healthTier = "risk";
  }
  const checklist = buildChecklist(metrics, fmt);
  const { catalysts, risks } = buildInsights(metrics, fmt);
  const counts = { pass: 0, watch: 0, fail: 0, na: 0 };
  for (const c of checklist) counts[c.status]++;
  const scored = counts.pass + counts.watch + counts.fail;
  return {
    healthScore,
    healthLabel,
    healthGrade,
    healthTier,
    altmanZ: metrics.altmanZ,
    piotroskiScore: metrics.piotroski ? metrics.piotroski.normalised : null,
    piotroskiDetails: metrics.piotroski ? metrics.piotroski.details : [],
    roicPct: metrics.roic,
    fcfConversionPct: metrics.fcfConversion === null ? null : Math.round(metrics.fcfConversion * 100),
    netCashB: metrics.netCashB,
    metrics,
    coverage: {
      measured: availableItems,
      total: totalItems,
      pct: Math.round(coveragePct * 100),
      sufficient
    },
    pillars,
    checklistSummary: {
      passCount: counts.pass,
      watchCount: counts.watch,
      failCount: counts.fail,
      naCount: counts.na,
      total: checklist.length,
      scored,
      passPct: scored ? Math.round(counts.pass / scored * 100) : null
    },
    checklist,
    catalysts,
    risks,
    dcf: {
      applicable: dcf.applicable,
      reason: dcf.reason || null,
      fairValue: dcf.fairValuePerShare,
      currentPrice: metrics.price,
      marginOfSafetyPct: dcfDiscountPct,
      premiumToFairValuePct,
      cumulativePV: dcf.cumulativePV ?? null,
      terminalValue: dcf.terminalValue ?? null,
      pvTerminalValue: dcf.pvTerminalValue ?? null,
      equityValue: dcf.equityValue ?? null,
      cashReserves: metrics.cash,
      totalDebt: metrics.totalDebt,
      sharesOutstanding: metrics.sharesOutstanding,
      assumptions: {
        growthRate: dcfInput.growthRate,
        growthBasis: growth.basis,
        growthBeforeBounding: growth.unbounded,
        terminalMultiple: dcfInput.terminalMultiple,
        discountRate: dcfInput.discountRate,
        cashFlowBase: cashFlowBase.value,
        cashFlowBasis: cashFlowBase.basis,
        latestFiledCashFlow: cashFlowBase.latest,
        normalisedCashFlow: cashFlowBase.normalised
      },
      impliedGrowthRate: impliedGrowth,
      divergenceFactor,
      divergenceWarning,
      pvCashFlows: dcf.pvCashFlows || []
    }
  };
}
var CURRENCY_SYMBOLS = {
  USD: "$",
  EUR: "\u20AC",
  GBP: "\xA3",
  GBp: "p",
  JPY: "\xA5",
  CHF: "CHF ",
  CAD: "C$",
  AUD: "A$",
  RON: "RON ",
  SEK: "SEK ",
  DKK: "DKK ",
  NOK: "NOK ",
  HKD: "HK$",
  CNY: "\xA5",
  INR: "\u20B9",
  BRL: "R$"
};
function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] ?? `${code || ""} `;
}
function formatMoney(value, currency = "USD") {
  if (value === null || value === void 0 || !Number.isFinite(value)) return "\u2014";
  const sym = currencySymbol(currency);
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${sym}${fixed(abs / 1e12, 2)}T`;
  if (abs >= 1e9) return `${sign}${sym}${fixed(abs / 1e9, 2)}B`;
  if (abs >= 1e6) return `${sign}${sym}${fixed(abs / 1e6, 1)}M`;
  return `${sign}${sym}${fixed(abs, 2)}`;
}

// core/providers/yahoo.js
var yahoo_exports = {};
__export(yahoo_exports, {
  __resetSession: () => __resetSession,
  fetchFundamentals: () => fetchFundamentals,
  fetchFxRate: () => fetchFxRate,
  fetchPeers: () => fetchPeers,
  fetchPriceHistory: () => fetchPriceHistory,
  fetchQuote: () => fetchQuote,
  getSession: () => getSession,
  search: () => search
});

// core/errors.js
var IngestError = class extends Error {
  /**
   * @param {IngestErrorKind} kind
   * @param {string} message
   * @param {{status?: number|null, retryAfterMs?: number|null, cause?: unknown}} [detail]
   */
  constructor(kind, message, detail = {}) {
    super(message);
    this.name = "IngestError";
    this.kind = kind;
    this.status = detail.status ?? null;
    this.retryAfterMs = detail.retryAfterMs ?? null;
    if (detail.cause !== void 0) this.cause = detail.cause;
  }
  /** True when waiting and trying again is the correct response. */
  get retryable() {
    return this.kind === "rate_limited" || this.kind === "network";
  }
};
function kindForStatus(status) {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  return "upstream";
}
function parseRetryAfter(value, nowMs = Date.now()) {
  if (value === null || value === void 0) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw) * 1e3;
    return Number.isFinite(ms) ? ms : null;
  }
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  const delta = at - nowMs;
  return delta > 0 ? delta : 0;
}

// core/providers/yahoo.js
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var TIMESERIES_BASE = "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/";
var QUOTESUMMARY_BASE = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/";
var session = { cookie: null, crumb: null, expires: 0 };
async function getSession(force = false) {
  if (!force && session.cookie && session.crumb && Date.now() < session.expires) {
    return session;
  }
  const headers = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
  };
  try {
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers,
      signal: AbortSignal.timeout(5e3)
    });
    const cookie = cookieRes.headers.get("set-cookie");
    if (!cookie) return { cookie: null, crumb: null, expires: 0 };
    const crumbRes = await fetch(
      "https://query2.finance.yahoo.com/v1/test/getcrumb",
      { headers: { ...headers, Cookie: cookie }, signal: AbortSignal.timeout(5e3) }
    );
    if (!crumbRes.ok) return { cookie: null, crumb: null, expires: 0 };
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes("Too Many Requests") || crumb.includes("<html")) {
      return { cookie: null, crumb: null, expires: 0 };
    }
    session = { cookie, crumb, expires: Date.now() + 6 * 3600 * 1e3 };
    return session;
  } catch (err) {
    console.warn("[Yahoo] session init failed:", err.message);
    return { cookie: null, crumb: null, expires: 0 };
  }
}
function authHeaders(sess) {
  const h = { "User-Agent": UA };
  if (sess.cookie) h.Cookie = sess.cookie;
  return h;
}
function __resetSession() {
  session = { cookie: null, crumb: null, expires: 0 };
}
async function doFetch(url, sess, timeoutMs, label) {
  let res;
  try {
    res = await fetch(url, {
      headers: authHeaders(sess),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    throw new IngestError("network", `${label} unreachable: ${err.message}`, {
      cause: err
    });
  }
  return res;
}
async function authedFetch(buildUrl, { timeoutMs, label }) {
  let sess = await getSession();
  let res = await doFetch(buildUrl(sess), sess, timeoutMs, label);
  if (res.status === 401 || res.status === 403) {
    sess = await getSession(true);
    res = await doFetch(buildUrl(sess), sess, timeoutMs, label);
  }
  if (!res.ok) {
    throw new IngestError(
      kindForStatus(res.status),
      `${label} HTTP ${res.status}`,
      {
        status: res.status,
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after"))
      }
    );
  }
  return res;
}
var FIELD_MAP = {
  revenue: ["TotalRevenue"],
  costOfRevenue: ["CostOfRevenue"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncome"],
  ebit: ["EBIT"],
  ebitda: ["EBITDA", "NormalizedEBITDA"],
  interestExpense: ["InterestExpense", "InterestExpenseNonOperating"],
  netIncome: ["NetIncome", "NetIncomeCommonStockholders"],
  pretaxIncome: ["PretaxIncome"],
  taxProvision: ["TaxProvision"],
  dilutedEPS: ["DilutedEPS"],
  dilutedShares: ["DilutedAverageShares", "BasicAverageShares"],
  totalAssets: ["TotalAssets"],
  totalLiabilities: ["TotalLiabilitiesNetMinorityInterest"],
  equity: ["StockholdersEquity", "TotalEquityGrossMinorityInterest"],
  currentAssets: ["CurrentAssets"],
  currentLiabilities: ["CurrentLiabilities"],
  inventory: ["Inventory"],
  retainedEarnings: ["RetainedEarnings"],
  cash: ["CashAndCashEquivalents"],
  shortTermInvestments: ["OtherShortTermInvestments", "AvailableForSaleSecurities"],
  totalDebt: ["TotalDebt"],
  longTermDebt: ["LongTermDebt"],
  currentDebt: ["CurrentDebt"],
  freeCashFlow: ["FreeCashFlow"],
  operatingCashFlow: ["OperatingCashFlow"],
  capitalExpenditure: ["CapitalExpenditure"],
  dividendsPaid: ["CashDividendsPaid", "CommonStockDividendPaid"],
  buybacks: ["RepurchaseOfCapitalStock"]
};
var ANNUAL_KEYS = [...new Set(Object.values(FIELD_MAP).flat())];
var QUARTERLY_KEYS = ["TotalRevenue", "GrossProfit", "OperatingIncome", "NetIncome"];
var KEY_TO_FIELD = {};
for (const [field, keys] of Object.entries(FIELD_MAP)) {
  keys.forEach((k, rank) => {
    if (!(k in KEY_TO_FIELD)) KEY_TO_FIELD[k] = { field, rank };
  });
}
function parseTimeseries(json, prefix) {
  const byDate = /* @__PURE__ */ new Map();
  let currency = null;
  const rankUsed = /* @__PURE__ */ new Map();
  for (const series of json?.timeseries?.result || []) {
    const type = series?.meta?.type?.[0];
    if (!type || !type.startsWith(prefix)) continue;
    const mapping = KEY_TO_FIELD[type.slice(prefix.length)];
    if (!mapping) continue;
    const { field, rank } = mapping;
    for (const point of series[type] || []) {
      if (!point || point.reportedValue?.raw === void 0) continue;
      const date = point.asOfDate;
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, { asOfDate: date });
      const row = byDate.get(date);
      const slot = `${date}|${field}`;
      const bestSoFar = rankUsed.get(slot);
      if (bestSoFar === void 0 || rank < bestSoFar) {
        row[field] = point.reportedValue.raw;
        rankUsed.set(slot, rank);
      }
      if (!currency && point.currencyCode) currency = point.currencyCode;
    }
  }
  const all = [...byDate.values()].sort(
    (a, b) => a.asOfDate < b.asOfDate ? -1 : 1
  );
  const periods = all.filter(
    (p) => p.revenue !== void 0 || p.totalAssets !== void 0
  );
  for (const p of all) {
    if (typeof p.capitalExpenditure === "number") {
      p.capitalExpenditure = Math.abs(p.capitalExpenditure);
    }
    if (typeof p.interestExpense === "number") {
      p.interestExpense = Math.abs(p.interestExpense);
    }
    if (typeof p.dividendsPaid === "number") {
      p.dividendsPaid = Math.abs(p.dividendsPaid);
    }
    for (const field of Object.keys(FIELD_MAP)) {
      if (p[field] === void 0) p[field] = null;
    }
  }
  const latestReported = {};
  for (const p of all) {
    for (const field of Object.keys(FIELD_MAP)) {
      const v = p[field];
      if (v === null || v === void 0) continue;
      latestReported[field] = { value: v, asOfDate: p.asOfDate };
    }
  }
  return { periods, currency, latestReported };
}
async function timeseriesRequest(ticker, types) {
  const buildUrl = (sess) => {
    const params = new URLSearchParams({
      symbol: ticker,
      type: types.join(","),
      period1: "1200000000",
      period2: String(Math.floor(Date.now() / 1e3))
    });
    if (sess.crumb) params.set("crumb", sess.crumb);
    return `${TIMESERIES_BASE}${encodeURIComponent(ticker)}?${params}`;
  };
  const res = await authedFetch(buildUrl, {
    timeoutMs: 9e3,
    label: "timeseries"
  });
  return res.json();
}
async function fetchFundamentals(ticker) {
  const annualJson = await timeseriesRequest(
    ticker,
    ANNUAL_KEYS.map((k) => `annual${k}`)
  );
  const { periods: annual, currency, latestReported } = parseTimeseries(
    annualJson,
    "annual"
  );
  let quarterly = [];
  try {
    const qJson = await timeseriesRequest(
      ticker,
      QUARTERLY_KEYS.map((k) => `quarterly${k}`)
    );
    quarterly = parseTimeseries(qJson, "quarterly").periods;
  } catch (err) {
    console.warn(
      `[Yahoo] quarterly series unavailable for ${ticker}: ${err.kind || "error"}`
    );
  }
  return { annual, quarterly, latestReported, reportingCurrency: currency };
}
async function fetchQuote(ticker) {
  const modules = "price,summaryProfile,summaryDetail,financialData,defaultKeyStatistics";
  const buildUrl = (sess) => {
    const params = new URLSearchParams({ modules });
    if (sess.crumb) params.set("crumb", sess.crumb);
    return `${QUOTESUMMARY_BASE}${encodeURIComponent(ticker)}?${params}`;
  };
  const res = await authedFetch(buildUrl, {
    timeoutMs: 8e3,
    label: "quoteSummary"
  });
  const result = (await res.json())?.quoteSummary?.result?.[0];
  if (!result) return null;
  const p = result.price || {};
  const sd = result.summaryDetail || {};
  const ks = result.defaultKeyStatistics || {};
  const sp = result.summaryProfile || {};
  const fd = result.financialData || {};
  const raw = (...candidates) => {
    for (const c of candidates) {
      if (c?.raw !== void 0 && c.raw !== null && Number.isFinite(c.raw)) {
        return c.raw;
      }
    }
    return null;
  };
  const price = raw(p.regularMarketPrice, fd.currentPrice);
  if (price === null) return null;
  return {
    ticker,
    name: p.longName || p.shortName || ticker,
    sector: sp.sector || null,
    industry: sp.industry || null,
    currency: p.currency || null,
    price,
    changePct: (raw(p.regularMarketChangePercent) ?? 0) * 100,
    marketCap: raw(p.marketCap, sd.marketCap),
    sharesOutstanding: raw(ks.sharesOutstanding, p.sharesOutstanding),
    trailingPE: raw(sd.trailingPE, ks.trailingPE),
    forwardPE: raw(sd.forwardPE, ks.forwardPE),
    pegRatio: raw(ks.pegRatio, ks.trailingPegRatio),
    priceToBook: raw(ks.priceToBook),
    dividendYield: raw(sd.dividendYield, sd.trailingAnnualDividendYield),
    payoutRatio: raw(sd.payoutRatio),
    fiveYearAvgDividendYield: raw(sd.fiveYearAvgDividendYield),
    beta: raw(sd.beta, ks.beta),
    // financialData is genuine TTM for these, and useful as a cross-check —
    // but the statements are the reporting basis, so these stay separate.
    ttm: {
      revenue: raw(fd.totalRevenue),
      ebitda: raw(fd.ebitda),
      grossMargin: raw(fd.grossMargins),
      operatingMargin: raw(fd.operatingMargins),
      profitMargin: raw(fd.profitMargins),
      currentRatio: raw(fd.currentRatio),
      quickRatio: raw(fd.quickRatio),
      debtToEquity: raw(fd.debtToEquity),
      totalCash: raw(fd.totalCash),
      totalDebt: raw(fd.totalDebt),
      freeCashFlow: raw(fd.freeCashflow),
      operatingCashFlow: raw(fd.operatingCashflow),
      returnOnEquity: raw(fd.returnOnEquity),
      revenueGrowth: raw(fd.revenueGrowth),
      earningsGrowth: raw(fd.earningsGrowth)
    }
  };
}
async function fetchPriceHistory(ticker) {
  const buildUrl = () => `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1mo&range=5y`;
  const res = await authedFetch(buildUrl, { timeoutMs: 8e3, label: "chart" });
  const result = (await res.json())?.chart?.result?.[0];
  const stamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  if (!stamps.length) return [];
  const out = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i];
    if (typeof close !== "number" || !Number.isFinite(close)) continue;
    out.push({ date: new Date(stamps[i] * 1e3).toISOString().slice(0, 10), close });
  }
  return out;
}
var fxCache = /* @__PURE__ */ new Map();
var FX_TTL_MS = 6 * 3600 * 1e3;
async function fetchFxRate(from, to) {
  if (!from || !to) return null;
  if (from === to) return 1;
  const pair = `${from}${to}=X`;
  const hit = fxCache.get(pair);
  if (hit && Date.now() < hit.expires) return hit.rate;
  try {
    const buildUrl = () => `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair)}?interval=1d&range=5d`;
    const res = await authedFetch(buildUrl, {
      timeoutMs: 6e3,
      label: `FX ${pair}`
    });
    const meta = (await res.json())?.chart?.result?.[0]?.meta;
    const rate = meta?.regularMarketPrice;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("no usable rate");
    }
    fxCache.set(pair, { rate, expires: Date.now() + FX_TTL_MS });
    return rate;
  } catch (err) {
    console.warn(`[Yahoo] FX ${pair} failed: ${err.message}`);
    return hit ? hit.rate : null;
  }
}
async function search(query) {
  const clean = (query || "").trim();
  if (!clean) return [];
  let lastFailure = null;
  const urls = [
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(clean)}&quotesCount=14&newsCount=0`,
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(clean)}&quotesCount=14&newsCount=0`
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(4e3)
      });
      if (!res.ok) {
        lastFailure = new IngestError(
          kindForStatus(res.status),
          `search failed: HTTP ${res.status}`,
          {
            status: res.status,
            retryAfterMs: parseRetryAfter(res.headers?.get?.("retry-after"))
          }
        );
        continue;
      }
      const data = await res.json();
      return (data.quotes || []).filter((q) => ["EQUITY", "ETF", "MUTUALFUND"].includes(q.quoteType)).map((q) => ({
        ticker: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        sector: q.sector || q.industry || "",
        industry: q.industry || "",
        exchange: q.exchDisp || q.exchange || "",
        quoteType: q.quoteType || "EQUITY"
      }));
    } catch (err) {
      lastFailure = err instanceof IngestError ? err : new IngestError(
        "network",
        `search unreachable: ${err.message}`,
        { cause: err }
      );
    }
  }
  throw lastFailure ?? new IngestError("network", "search unreachable");
}
async function fetchPeers(ticker) {
  const buildUrl = () => "https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/" + encodeURIComponent(ticker);
  try {
    const res = await authedFetch(buildUrl, {
      timeoutMs: 6e3,
      label: "peers"
    });
    const rows = (await res.json())?.finance?.result?.[0]?.recommendedSymbols || [];
    return rows.map((r) => r.symbol).filter((s) => s && s !== ticker).slice(0, 6);
  } catch {
    return [];
  }
}

// core/providers/edgar.js
var TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
var COMPANYFACTS_BASE = "https://data.sec.gov/api/xbrl/companyfacts/CIK";
var EDGAR_USER_AGENT = "PocketOmaha/1.0 (zandaulion/omaha; zandaulion@gmail.com)";
var DURATION = "duration";
var INSTANT = "instant";
var US_GAAP = {
  revenue: [DURATION, [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet"
  ]],
  costOfRevenue: [DURATION, ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfServices"]],
  grossProfit: [DURATION, ["GrossProfit"]],
  operatingIncome: [DURATION, ["OperatingIncomeLoss"]],
  netIncome: [DURATION, ["NetIncomeLoss", "ProfitLoss"]],
  pretaxIncome: [DURATION, [
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"
  ]],
  taxProvision: [DURATION, ["IncomeTaxExpenseBenefit"]],
  interestExpense: [DURATION, ["InterestExpense", "InterestExpenseDebt", "InterestIncomeExpenseNet"]],
  dilutedEPS: [DURATION, ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"]],
  dilutedShares: [DURATION, [
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "WeightedAverageNumberOfSharesOutstandingBasic"
  ]],
  depreciationAmortisation: [DURATION, [
    "DepreciationDepletionAndAmortization",
    "DepreciationAmortizationAndAccretionNet",
    "DepreciationAndAmortization"
  ]],
  totalAssets: [INSTANT, ["Assets"]],
  totalLiabilities: [INSTANT, ["Liabilities"]],
  equity: [INSTANT, [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"
  ]],
  currentAssets: [INSTANT, ["AssetsCurrent"]],
  currentLiabilities: [INSTANT, ["LiabilitiesCurrent"]],
  inventory: [INSTANT, ["InventoryNet"]],
  retainedEarnings: [INSTANT, ["RetainedEarningsAccumulatedDeficit"]],
  cash: [INSTANT, [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"
  ]],
  shortTermInvestments: [INSTANT, [
    "ShortTermInvestments",
    "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
    "MarketableSecuritiesCurrent"
  ]],
  longTermDebt: [INSTANT, ["LongTermDebtNoncurrent", "LongTermDebt"]],
  currentDebt: [INSTANT, ["LongTermDebtCurrent", "DebtCurrent"]],
  operatingCashFlow: [DURATION, [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"
  ]],
  capitalExpenditure: [DURATION, [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets"
  ]],
  dividendsPaid: [DURATION, ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"]],
  buybacks: [DURATION, ["PaymentsForRepurchaseOfCommonStock"]]
};
var IFRS = {
  revenue: [DURATION, ["Revenue", "RevenueFromContractsWithCustomers"]],
  costOfRevenue: [DURATION, ["CostOfSales"]],
  grossProfit: [DURATION, ["GrossProfit"]],
  operatingIncome: [DURATION, ["ProfitLossFromOperatingActivities"]],
  netIncome: [DURATION, ["ProfitLoss", "ProfitLossAttributableToOwnersOfParent"]],
  pretaxIncome: [DURATION, ["ProfitLossBeforeTax"]],
  taxProvision: [DURATION, ["IncomeTaxExpenseContinuingOperations"]],
  interestExpense: [DURATION, ["InterestExpense", "FinanceCosts"]],
  dilutedEPS: [DURATION, ["DilutedEarningsLossPerShare"]],
  dilutedShares: [DURATION, [
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "WeightedAverageShares"
  ]],
  depreciationAmortisation: [DURATION, [
    "DepreciationAndAmortisationExpense",
    "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss"
  ]],
  totalAssets: [INSTANT, ["Assets"]],
  totalLiabilities: [INSTANT, ["Liabilities"]],
  equity: [INSTANT, ["Equity", "EquityAttributableToOwnersOfParent"]],
  currentAssets: [INSTANT, ["CurrentAssets"]],
  currentLiabilities: [INSTANT, ["CurrentLiabilities"]],
  inventory: [INSTANT, ["Inventories"]],
  retainedEarnings: [INSTANT, ["RetainedEarnings"]],
  cash: [INSTANT, ["CashAndCashEquivalents"]],
  shortTermInvestments: [INSTANT, ["OtherCurrentFinancialAssets"]],
  longTermDebt: [INSTANT, ["NoncurrentPortionOfNoncurrentBorrowings", "LongtermBorrowings"]],
  currentDebt: [INSTANT, ["ShorttermBorrowings", "CurrentPortionOfLongtermBorrowings"]],
  operatingCashFlow: [DURATION, ["CashFlowsFromUsedInOperatingActivities"]],
  capitalExpenditure: [DURATION, [
    "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
    "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets",
    "PurchaseOfInterestsInJointVenturesClassifiedAsInvestingActivities"
  ]],
  dividendsPaid: [DURATION, ["DividendsPaidClassifiedAsFinancingActivities", "DividendsPaid"]],
  buybacks: [DURATION, ["PaymentsToAcquireOrRedeemEntitysShares"]]
};
var ALL_FIELDS = [
  .../* @__PURE__ */ new Set([...Object.keys(US_GAAP), ...Object.keys(IFRS)]),
  // Derived below rather than filed. Listed so they are nulled like the rest.
  "ebit",
  "ebitda",
  "freeCashFlow",
  "totalDebt"
];
var DAY_MS = 864e5;
var tickerMapCache = null;
async function edgarFetch(url, { timeoutMs = 15e3, label } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": EDGAR_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    throw new IngestError("network", `EDGAR ${label} request failed: ${err.message}`, {
      cause: err
    });
  }
  if (!res.ok) {
    const kind = res.status === 403 ? "rate_limited" : kindForStatus(res.status);
    throw new IngestError(kind, `EDGAR ${label} returned ${res.status}`, {
      status: res.status,
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after"))
    });
  }
  return res.json();
}
async function resolveCik(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  if (!symbol) {
    throw new IngestError("not_found", "No ticker supplied");
  }
  if (!tickerMapCache) {
    const json = await edgarFetch(TICKER_MAP_URL, { label: "ticker map", timeoutMs: 12e3 });
    const map = /* @__PURE__ */ new Map();
    for (const row of Object.values(json || {})) {
      if (row?.ticker && row?.cik_str !== void 0) {
        map.set(String(row.ticker).toUpperCase(), String(row.cik_str));
      }
    }
    if (map.size === 0) {
      throw new IngestError("upstream", "EDGAR ticker map was empty");
    }
    tickerMapCache = map;
  }
  const cik = tickerMapCache.get(symbol);
  if (!cik) {
    throw new IngestError("not_found", `${symbol} is not an SEC registrant`);
  }
  return cik.padStart(10, "0");
}
function selectTaxonomy(facts) {
  const hasUs = Boolean(facts?.["us-gaap"]);
  const hasIfrs = Boolean(facts?.["ifrs-full"]);
  if (hasUs && !hasIfrs) return { name: "us-gaap", map: US_GAAP };
  if (hasIfrs && !hasUs) return { name: "ifrs-full", map: IFRS };
  if (!hasUs && !hasIfrs) return null;
  const score = (name, map) => Object.values(map).filter(([, tags]) => tags.some((t) => facts[name]?.[t])).length;
  return score("us-gaap", US_GAAP) >= score("ifrs-full", IFRS) ? { name: "us-gaap", map: US_GAAP } : { name: "ifrs-full", map: IFRS };
}
function daysBetween(start, end) {
  return (Date.parse(end) - Date.parse(start)) / DAY_MS;
}
function isAnnualDuration(fact) {
  if (!fact.start || !fact.end) return false;
  const d = daysBetween(fact.start, fact.end);
  return d >= 340 && d <= 400;
}
function isQuarterDuration(fact) {
  if (!fact.start || !fact.end) return false;
  const d = daysBetween(fact.start, fact.end);
  return d >= 80 && d <= 100;
}
function pickByPeriod(facts, accept) {
  const best = /* @__PURE__ */ new Map();
  for (const fact of facts) {
    if (typeof fact?.val !== "number" || !fact.end) continue;
    if (!accept(fact)) continue;
    const existing = best.get(fact.end);
    if (!existing || String(fact.filed) > String(existing.filed)) {
      best.set(fact.end, fact);
    }
  }
  return best;
}
function factsForField(facts, taxonomyName, tags, currencyHint) {
  let best = null;
  tags.forEach((tag, rank) => {
    const entry = facts?.[taxonomyName]?.[tag];
    if (!entry?.units) return;
    const unitKeys = Object.keys(entry.units);
    const preferred = unitKeys.find((u) => u === currencyHint) || unitKeys.find((u) => u === "shares") || unitKeys.find((u) => u.startsWith(`${currencyHint}/`)) || unitKeys[0];
    const rows = entry.units[preferred];
    if (!Array.isArray(rows) || rows.length === 0) return;
    let latest = "";
    for (const row of rows) {
      if (row?.end && row.end > latest) latest = row.end;
    }
    const candidate = { rows, unit: preferred, tag, latest, count: rows.length, rank };
    if (!best || candidate.latest > best.latest || candidate.latest === best.latest && candidate.count > best.count) {
      best = candidate;
    }
  });
  return best;
}
function detectReportingCurrency(facts, taxonomyName, map) {
  for (const field of ["revenue", "totalAssets", "netIncome", "equity"]) {
    const spec = map[field];
    if (!spec) continue;
    for (const tag of spec[1]) {
      const units = facts?.[taxonomyName]?.[tag]?.units;
      if (!units) continue;
      const monetary = Object.keys(units).find((u) => /^[A-Z]{3}$/.test(u));
      if (monetary) return monetary;
    }
  }
  return "USD";
}
function derive(period) {
  const has = (k) => typeof period[k] === "number";
  period.freeCashFlow = has("operatingCashFlow") && has("capitalExpenditure") ? period.operatingCashFlow - period.capitalExpenditure : null;
  period.totalDebt = has("longTermDebt") || has("currentDebt") ? (period.longTermDebt || 0) + (period.currentDebt || 0) : null;
  period.ebit = has("operatingIncome") ? period.operatingIncome : has("pretaxIncome") && has("interestExpense") ? period.pretaxIncome + period.interestExpense : null;
  period.ebitda = typeof period.ebit === "number" && has("depreciationAmortisation") ? period.ebit + period.depreciationAmortisation : null;
  return period;
}
function parseCompanyFacts(json) {
  const facts = json?.facts;
  const taxonomy = selectTaxonomy(facts);
  if (!taxonomy) {
    throw new IngestError("upstream", "EDGAR returned no recognised taxonomy");
  }
  const { name, map } = taxonomy;
  const currency = detectReportingCurrency(facts, name, map);
  const build = (accept) => {
    const byDate = /* @__PURE__ */ new Map();
    for (const [field, [kind, tags]] of Object.entries(map)) {
      if (kind !== DURATION) continue;
      const found = factsForField(facts, name, tags, currency);
      if (!found) continue;
      for (const [end, fact] of pickByPeriod(found.rows, accept)) {
        if (!byDate.has(end)) byDate.set(end, { asOfDate: end });
        byDate.get(end)[field] = fact.val;
      }
    }
    for (const [field, [kind, tags]] of Object.entries(map)) {
      if (kind !== INSTANT) continue;
      const found = factsForField(facts, name, tags, currency);
      if (!found) continue;
      for (const [end, fact] of pickByPeriod(found.rows, (f) => !f.start)) {
        if (byDate.has(end)) byDate.get(end)[field] = fact.val;
      }
    }
    const periods = [...byDate.values()].filter((p) => p.revenue !== void 0 || p.netIncome !== void 0).sort((a, b) => a.asOfDate < b.asOfDate ? -1 : 1);
    for (const p of periods) {
      for (const k of ["capitalExpenditure", "interestExpense", "dividendsPaid", "buybacks"]) {
        if (typeof p[k] === "number") p[k] = Math.abs(p[k]);
      }
      derive(p);
      for (const field of ALL_FIELDS) {
        if (p[field] === void 0) p[field] = null;
      }
    }
    return periods;
  };
  const annual = build(isAnnualDuration);
  const quarterly = build(isQuarterDuration);
  const latestReported = {};
  for (const p of annual) {
    for (const field of ALL_FIELDS) {
      const v = p[field];
      if (v === null || v === void 0) continue;
      latestReported[field] = { value: v, asOfDate: p.asOfDate };
    }
  }
  return { annual, quarterly, latestReported, reportingCurrency: currency };
}
async function fetchFundamentals2(ticker) {
  const cik = await resolveCik(ticker);
  const json = await edgarFetch(`${COMPANYFACTS_BASE}${cik}.json`, {
    label: "companyfacts",
    timeoutMs: 2e4
  });
  return parseCompanyFacts(json);
}

// core/providers/index.js
var quoteSource = yahoo_exports;
async function fetchStatementsHybrid(ticker) {
  let reason;
  try {
    const result = await fetchFundamentals2(ticker);
    if (result?.annual?.length) return result;
    reason = "no usable annual periods";
  } catch (err) {
    reason = err?.kind || err?.message || "error";
    if (err?.kind !== "not_found") {
      console.warn(`[Providers] EDGAR statements failed for ${ticker}: ${reason}`);
    }
  }
  console.warn(`[Providers] statements for ${ticker} fall back to Yahoo (${reason})`);
  return fetchFundamentals(ticker);
}
var getStatements = (ticker) => fetchStatementsHybrid(ticker);
var getQuote = (ticker) => quoteSource.fetchQuote(ticker);
var getPriceHistory = (ticker) => quoteSource.fetchPriceHistory(ticker);
var getFxRate = (from, to) => quoteSource.fetchFxRate(from, to);

// core/model/assemble.js
var NON_INDUSTRIAL_SECTORS = /* @__PURE__ */ new Set(["Financial Services", "Real Estate"]);
function buildModel(quote, fundamentals) {
  const annual = fundamentals.annual || [];
  const latest = annual[annual.length - 1] || null;
  const prior = annual.length >= 2 ? annual[annual.length - 2] : null;
  const isFinancial = NON_INDUSTRIAL_SECTORS.has(quote.sector || "") || /bank|insurance|capital market|reit|asset management/i.test(
    quote.industry || ""
  );
  return {
    quote,
    latest,
    prior,
    annual,
    quarterly: fundamentals.quarterly || [],
    latestReported: fundamentals.latestReported || {},
    isFinancial,
    reportingCurrency: fundamentals.reportingCurrency || quote.currency || null,
    history: buildHistory(annual)
  };
}
function buildHistory(annual) {
  const pct = (num2, den) => num2 === null || den === null || !den ? null : Number(fixed(num2 / den * 100, 1));
  const bn = (v) => v === null || v === void 0 ? null : Number(fixed(v / 1e9, 2));
  const years = annual.map((p) => Number(String(p.asOfDate).slice(0, 4)));
  return {
    periods: annual.map((p) => p.asOfDate),
    years,
    revenue: annual.map((p) => bn(p.revenue)),
    freeCashFlow: annual.map((p) => bn(p.freeCashFlow)),
    operatingCashFlow: annual.map((p) => bn(p.operatingCashFlow)),
    netIncome: annual.map((p) => bn(p.netIncome)),
    grossMarginPct: annual.map((p) => pct(p.grossProfit, p.revenue)),
    operatingMarginPct: annual.map(
      (p) => pct(p.operatingIncome ?? p.ebit, p.revenue)
    ),
    sharesOutstanding: annual.map((p) => bn(p.dilutedShares)),
    dilutedEPS: annual.map((p) => p.dilutedEPS ?? null),
    cash: annual.map((p) => bn(sumOrNull(p.cash, p.shortTermInvestments))),
    totalDebt: annual.map((p) => bn(p.totalDebt)),
    // Direction of the most recent filed year, which a multi-year CAGR hides:
    // Bumble's revenue CAGR is +2.2% while its latest year fell 9.3%.
    ...(() => {
      const change = yoyChange(annual.map((p) => p.revenue));
      return { revenueChangeLatest: change.value, revenueChangeYears: change.years };
    })(),
    // A single year is a fragile base for a five-year projection when it is an
    // outlier. Both are carried so the model can pick and say which it used.
    freeCashFlowLatest: latestOf(annual.map((p) => p.freeCashFlow)),
    freeCashFlowNormalised: normalised(annual.map((p) => p.freeCashFlow)),
    revenueCAGR: cagr(annual.map((p) => p.revenue)),
    epsCAGR: cagr(annual.map((p) => p.dilutedEPS)),
    fcfPerShareCAGR: cagr(
      annual.map(
        (p) => p.freeCashFlow !== null && p.dilutedShares ? p.freeCashFlow / p.dilutedShares : null
      )
    ),
    ...(() => {
      const change = yoyChange(annual.map((p) => p.dilutedShares));
      return {
        shareChangeYoY: change.value,
        shareChangeYears: change.years,
        shareChangeIsAnnual: change.consecutive
      };
    })(),
    // The span the CAGRs actually cover, so the UI can label them honestly.
    cagrYears: countableSpan(annual.map((p) => p.revenue))
  };
}
function latestOf(series) {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null && series[i] !== void 0) return series[i];
  }
  return null;
}
function normalised(series) {
  const points = series.filter((v) => v !== null && v !== void 0).slice(-3);
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function sumOrNull(...values) {
  const present = values.filter((v) => v !== null && v !== void 0);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}
function cagr(series) {
  const points = series.filter((v) => v !== null && v !== void 0);
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const periods = points.length - 1;
  if (first <= 0 || last <= 0) return null;
  return Number(fixed(Math.pow(last / first, 1 / periods) - 1, 4));
}
function countableSpan(series) {
  const points = series.filter((v) => v !== null && v !== void 0);
  return points.length >= 2 ? points.length - 1 : null;
}
function yoyChange(series) {
  const last = series.length - 1;
  if (last < 1) return { value: null, years: null, consecutive: false };
  const curr = series[last];
  if (curr === null || curr === void 0) {
    return { value: null, years: null, consecutive: false };
  }
  let idx = last - 1;
  while (idx >= 0 && (series[idx] === null || series[idx] === void 0)) idx--;
  if (idx < 0 || !series[idx]) return { value: null, years: null, consecutive: false };
  const span = last - idx;
  return {
    value: Number(fixed((curr - series[idx]) / series[idx], 4)),
    years: span,
    consecutive: span === 1
  };
}
async function applyFxNormalisation(model) {
  const quote = model.quote;
  const reporting = model.reportingCurrency;
  const traded = quote.currency;
  model.tradedCurrency = traded;
  model.fx = { needed: false, rate: 1, from: traded, to: reporting, available: true };
  if (!reporting || !traded || reporting === traded) {
    quote.priceReporting = quote.price;
    quote.marketCapReporting = quote.marketCap;
    return;
  }
  const rate = await getFxRate(traded, reporting);
  model.fx = {
    needed: true,
    rate,
    from: traded,
    to: reporting,
    available: rate !== null
  };
  if (rate === null) {
    quote.priceReporting = null;
    quote.marketCapReporting = null;
    return;
  }
  quote.priceReporting = quote.price * rate;
  quote.marketCapReporting = quote.marketCap !== null && quote.marketCap !== void 0 ? quote.marketCap * rate : null;
}

// core/model/pe-history.js
function buildPeHistory(fundamentals, quote) {
  const MIN_MONTHS_TO_SCORE = 36;
  const MIN_EPS_PERIODS = 3;
  const empty = (reason) => ({
    available: false,
    reason,
    series: [],
    months: 0,
    min: null,
    p20: null,
    median: null,
    p80: null,
    max: null,
    current: quote.trailingPE ?? null,
    percentile: null,
    vsMedianPct: null
  });
  const prices = fundamentals.priceHistory || [];
  const annual = fundamentals.annual || [];
  if (!prices.length) return empty("no price history");
  const epsPeriods = annual.filter((p) => typeof p.dilutedEPS === "number" && p.dilutedEPS > 0).map((p) => ({ date: p.asOfDate, eps: p.dilutedEPS }));
  if (epsPeriods.length < 2) return empty("fewer than two profitable filed years");
  const series = [];
  for (const point of prices) {
    let eps = null;
    for (const period of epsPeriods) {
      if (period.date <= point.date) eps = period.eps;
    }
    if (eps === null || eps <= 0) continue;
    const pe = point.close / eps;
    if (pe > 0 && pe < 400) series.push({ date: point.date, pe: Number(fixed(pe, 2)) });
  }
  const values = series.map((s) => s.pe).sort((a, b) => a - b);
  const current = quote.trailingPE ?? (series.length ? series[series.length - 1].pe : null);
  const base = {
    series,
    months: series.length,
    epsPeriods: epsPeriods.length,
    current: current === null ? null : Number(fixed(current, 2))
  };
  if (series.length < 12) return { ...empty("too few months of comparable earnings"), ...base };
  const at = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  const median = at(0.5);
  const below = current === null ? null : values.filter((v) => v <= current).length;
  const scoreable = series.length >= MIN_MONTHS_TO_SCORE && epsPeriods.length >= MIN_EPS_PERIODS;
  return {
    ...base,
    available: true,
    scoreable,
    reason: scoreable ? null : `only ${series.length} months of comparable earnings across ${epsPeriods.length} profitable filed year${epsPeriods.length === 1 ? "" : "s"}`,
    min: values[0],
    p20: at(0.2),
    median,
    p80: at(0.8),
    max: values[values.length - 1],
    percentile: below === null ? null : Math.round(below / values.length * 100),
    vsMedianPct: median > 0 && current !== null ? Number(fixed((current - median) / median * 100, 1)) : null
  };
}

// core/model/record.js
function toRecord(ticker, quote, fundamentals, model, score) {
  const latest = model.latest || {};
  const cash = sumOrNull(latest.cash, latest.shortTermInvestments);
  return {
    ticker,
    name: quote.name,
    sector: quote.sector,
    industry: quote.industry,
    price: quote.price,
    change_pct: quote.changePct,
    // The currency the shares trade in, which is what a broker screen shows.
    currency: quote.currency || model.reportingCurrency,
    market_cap: quote.marketCap,
    health_score: score.healthScore,
    altman_z: score.altmanZ,
    piotroski_score: score.piotroskiScore,
    roic_pct: score.roicPct,
    fcf_conversion_pct: score.fcfConversionPct,
    net_cash_b: score.netCashB,
    financials_json: JSON.stringify({
      reportingCurrency: model.reportingCurrency,
      tradedCurrency: model.tradedCurrency,
      fx: model.fx,
      fiscalPeriodEnd: latest.asOfDate || null,
      isFinancial: model.isFinancial,
      revenue: latest.revenue ?? null,
      grossProfit: latest.grossProfit ?? null,
      operatingIncome: latest.operatingIncome ?? null,
      ebit: latest.ebit ?? null,
      ebitda: latest.ebitda ?? null,
      interestExpense: latest.interestExpense ?? null,
      netIncome: latest.netIncome ?? null,
      operatingCashFlow: latest.operatingCashFlow ?? null,
      capitalExpenditures: latest.capitalExpenditure ?? null,
      freeCashFlow: latest.freeCashFlow ?? null,
      cashAndEquivalents: cash,
      totalDebt: latest.totalDebt ?? null,
      currentAssets: latest.currentAssets ?? null,
      currentLiabilities: latest.currentLiabilities ?? null,
      inventory: latest.inventory ?? null,
      totalAssets: latest.totalAssets ?? null,
      totalLiabilities: latest.totalLiabilities ?? null,
      totalStockholderEquity: latest.equity ?? null,
      retainedEarnings: latest.retainedEarnings ?? null,
      dilutedShares: latest.dilutedShares ?? null,
      dilutedEPS: latest.dilutedEPS ?? null,
      grossMargin: score.metrics.grossMargin,
      operatingMargin: score.metrics.operatingMargin,
      historical: model.history
    }),
    checklist_json: JSON.stringify(score.checklist),
    catalysts_json: JSON.stringify(score.catalysts),
    risks_json: JSON.stringify(score.risks),
    pillars_json: JSON.stringify(score.pillars),
    summary_json: JSON.stringify({
      healthGrade: score.healthGrade,
      healthLabel: score.healthLabel,
      healthTier: score.healthTier,
      checklistSummary: score.checklistSummary,
      dcf: score.dcf,
      metrics: score.metrics,
      coverage: score.coverage,
      peHistory: score.peHistory || null,
      ratios: {
        pe: quote.trailingPE,
        forwardPE: quote.forwardPE,
        peg: quote.pegRatio,
        priceToBook: quote.priceToBook,
        dividendYield: quote.dividendYield,
        beta: quote.beta
      }
    }),
    statements_json: JSON.stringify(fundamentals)
  };
}
function formatCachedStock(row, opts = {}) {
  const summary = JSON.parse(row.summary_json || "{}");
  return {
    ticker: row.ticker,
    name: row.name,
    sector: row.sector,
    industry: row.industry,
    price: row.price,
    change_pct: row.change_pct,
    currency: row.currency || "USD",
    market_cap: row.market_cap,
    health_score: row.health_score,
    altman_z: row.altman_z,
    piotroski_score: row.piotroski_score,
    roic_pct: row.roic_pct,
    fcf_conversion_pct: row.fcf_conversion_pct,
    net_cash_b: row.net_cash_b,
    financials: JSON.parse(row.financials_json || "{}"),
    checklist: JSON.parse(row.checklist_json || "[]"),
    catalysts: JSON.parse(row.catalysts_json || "[]"),
    risks: JSON.parse(row.risks_json || "[]"),
    pillars: JSON.parse(row.pillars_json || "[]"),
    summary,
    last_fetched_at: row.last_fetched_at,
    financials_fetched_at: row.financials_fetched_at || null,
    stale: Boolean(opts.stale),
    // Why the data is stale, when known: 'rate_limited', 'network', ...
    // Lets the alert sweep stop rather than keep asking, and lets the client
    // say something more useful than "offline".
    staleReason: opts.reason ?? null
  };
}

// core/stock.js
var QUOTE_TTL_MIN = 15;
var FUNDAMENTALS_TTL_HOURS = 24;
var modelObserver = null;
async function getStockData(tickerSymbol, forceRefresh = false) {
  const ticker = tickerSymbol.trim().toUpperCase();
  const cached = await readCache(ticker);
  if (!forceRefresh && cached) {
    const quoteFresh = minutesSince(cached.last_fetched_at) < QUOTE_TTL_MIN;
    const fundamentalsFresh = cached.financials_fetched_at && minutesSince(cached.financials_fetched_at) < FUNDAMENTALS_TTL_HOURS * 60;
    if (quoteFresh && fundamentalsFresh) return formatCachedStock(cached);
  }
  let quote = null;
  let failure = null;
  try {
    quote = await getQuote(ticker);
  } catch (err) {
    failure = err;
    console.warn(`[Finance] quote fetch failed for ${ticker}: ${err.message}`);
  }
  if (!quote) {
    if (cached) {
      return formatCachedStock(cached, { stale: true, reason: failure?.kind ?? null });
    }
    if (failure?.retryable) throw failure;
    return null;
  }
  let fundamentals = null;
  const storedFresh = cached?.financials_fetched_at && minutesSince(cached.financials_fetched_at) < FUNDAMENTALS_TTL_HOURS * 60;
  if (!forceRefresh && storedFresh) {
    try {
      const stored = JSON.parse(cached.statements_json || "null");
      if (stored?.annual?.length) fundamentals = stored;
    } catch {
      fundamentals = null;
    }
  }
  if (!fundamentals) {
    try {
      const [statements, prices] = await Promise.all([
        getStatements(ticker),
        getPriceHistory(ticker).catch(() => [])
      ]);
      fundamentals = { ...statements, priceHistory: prices };
    } catch (err) {
      console.warn(
        `[Finance] fundamentals fetch failed for ${ticker}: ${err.message}`
      );
      try {
        fundamentals = JSON.parse(cached?.statements_json || "null");
      } catch {
        fundamentals = null;
      }
    }
  }
  if (!fundamentals) {
    fundamentals = {
      annual: [],
      quarterly: [],
      priceHistory: [],
      latestReported: {},
      reportingCurrency: null
    };
  }
  const model = buildModel(quote, fundamentals);
  await applyFxNormalisation(model);
  model.sectorMedianAssetTurnover = await sectorMedianAssetTurnover(quote.sector, ticker);
  const peHistory = buildPeHistory(fundamentals, quote);
  model.peVsHistoryPct = peHistory.scoreable ? peHistory.vsMedianPct : null;
  model.peHistory = peHistory;
  const score = computeComprehensiveHealth(model);
  modelObserver?.(ticker, model, score);
  score.peHistory = peHistory;
  const record = toRecord(ticker, quote, fundamentals, model, score);
  await saveStockToCache(record, Boolean(fundamentals.annual.length));
  return formatCachedStock(record);
}
async function saveStockToCache(r, hasFundamentals) {
  await getStore().save(r, hasFundamentals);
}
async function readCache(ticker) {
  return getStore().read(ticker);
}

// core/host/stock.js
installHostFetch();
async function host(name, payload) {
  const fn = globalThis[name];
  if (typeof fn !== "function") {
    throw new Error(`Host did not provide ${name}`);
  }
  const raw = await fn(JSON.stringify(payload));
  if (raw === void 0 || raw === null || raw === "") return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}
setStore({
  read: (ticker) => host("__storeRead", { ticker }),
  save: (record, hasFundamentals) => host("__storeSave", { record, hasFundamentals }),
  searchCached: (query) => host("__storeSearch", { query }).then((rows) => rows || []),
  sectorFinancials: (sector, excludeTicker) => host("__storeSector", { sector, excludeTicker }).then((rows) => rows || [])
});
async function stock(ticker, options = {}) {
  if (options.freshSession === true) __resetSession();
  try {
    const data = await getStockData(ticker, options.forceRefresh === true);
    if (!data) {
      return {
        ok: false,
        ticker,
        error: { kind: "not_found", message: `No listing found for ${ticker}.` }
      };
    }
    return { ok: true, ticker, data };
  } catch (err) {
    return {
      ok: false,
      ticker,
      error: {
        kind: err?.kind ?? "unknown",
        message: err?.message ?? String(err),
        status: err?.status ?? null,
        retryAfterMs: err?.retryAfterMs ?? null,
        retryable: err?.retryable ?? false
      }
    };
  }
}

// core/alerts/triggers.js
var SCORE_SHIFT_THRESHOLD = 3;
var GROSS_MARGIN_DROP_BPS = 300;
var CHECK_NAMES = {
  1: "Altman Z-Score",
  2: "Interest coverage",
  3: "Current ratio",
  4: "Debt to equity",
  5: "Free cash flow",
  6: "Piotroski F-Score",
  7: "ROIC vs cost of capital",
  8: "Gross margin",
  9: "Share count",
  10: "Cash conversion",
  11: "PEG ratio",
  12: "Revenue growth"
};
var RANK = { pass: 3, watch: 2, fail: 1 };
var both = (a, b) => typeof a === "number" && typeof b === "number";
function evaluateTriggers(stock2, prev, settings) {
  const alerts = [];
  if (!prev) return alerts;
  const m = stock2.summary?.metrics || {};
  const t = stock2.ticker;
  if (settings.notify_earnings_filings) {
    const delta = both(stock2.health_score, prev.health_score) ? stock2.health_score - prev.health_score : null;
    const flips = [];
    for (const check of stock2.checklist || []) {
      const before = prev.checklist[check.id];
      const after = check.status;
      if (!before || before === after) continue;
      if (before === "na" || after === "na") continue;
      flips.push({ id: check.id, from: before, to: after, worse: RANK[after] < RANK[before] });
    }
    if (delta !== null && Math.abs(delta) >= SCORE_SHIFT_THRESHOLD || flips.length) {
      const up = delta !== null && delta > 0;
      const worsened = flips.filter((f) => f.worse);
      const parts = [];
      if (delta !== null && Math.abs(delta) >= SCORE_SHIFT_THRESHOLD) {
        parts.push(`Health ${up ? "up" : "down"} ${Math.abs(delta)} points to ${stock2.health_score}/100.`);
      }
      for (const f of flips.slice(0, 2)) {
        parts.push(`${CHECK_NAMES[f.id] || `Check ${f.id}`}: ${f.from} \u2192 ${f.to}.`);
      }
      alerts.push({
        type: "EARNINGS_HEALTH_SHIFT",
        ticker: t,
        title: `${t} ${up && !worsened.length ? "health upgrade" : "health change"}${stock2.health_score !== null ? ` (${stock2.health_score}/100)` : ""}`,
        body: parts.join(" "),
        severity: worsened.length ? "warning" : "positive",
        url: `/?tab=deepdive&ticker=${t}`
      });
    }
  }
  if (settings.notify_red_flags) {
    const breaches = [];
    if (both(stock2.altman_z, prev.altman_z) && stock2.altman_z < 1.8 && prev.altman_z >= 1.8) {
      breaches.push(`Altman Z fell to ${fixed(stock2.altman_z, 2)}, into the distress zone.`);
    }
    if (both(m.currentRatio, prev.current_ratio) && m.currentRatio < 1 && prev.current_ratio >= 1) {
      breaches.push(`Current ratio dropped below 1.0 to ${fixed(m.currentRatio, 2)}.`);
    }
    if (both(m.grossMargin, prev.gross_margin)) {
      const dropBps = Math.round((prev.gross_margin - m.grossMargin) * 1e4);
      if (dropBps > GROSS_MARGIN_DROP_BPS) {
        breaches.push(`Gross margin compressed ${dropBps} bps to ${fixed(m.grossMargin * 100, 1)}%.`);
      }
    }
    if (both(stock2.piotroski_score, prev.piotroski_score) && stock2.piotroski_score <= 4 && prev.piotroski_score > 4) {
      breaches.push(`Piotroski F-Score downgraded to ${stock2.piotroski_score}/9.`);
    }
    if (breaches.length) {
      alerts.push({
        type: "RED_FLAG_WARNING",
        ticker: t,
        title: `\u26A0\uFE0F ${t}: ${breaches.length > 1 ? `${breaches.length} warning signs` : "warning sign"}`,
        body: breaches.join(" "),
        severity: "critical",
        url: `/?tab=deepdive&ticker=${t}&subtab=checklist`
      });
    }
  }
  if (settings.notify_margin_of_safety && typeof stock2.health_score === "number" && stock2.health_score >= 85) {
    const peUsable = stock2.summary?.peHistory?.scoreable === true;
    const pePercentile = peUsable ? stock2.summary.peHistory.percentile ?? null : null;
    const peg = m.pegRatio;
    const crossedIntoCheapPe = typeof pePercentile === "number" && pePercentile <= 20 && typeof prev.pe_percentile === "number" && prev.pe_percentile > 20;
    const crossedIntoCheapPeg = typeof peg === "number" && peg > 0 && peg <= 1.3 && typeof prev.peg_ratio === "number" && prev.peg_ratio > 1.3;
    if (crossedIntoCheapPe || crossedIntoCheapPeg) {
      const reason = crossedIntoCheapPe ? `Its P/E has fallen into the cheapest ${pePercentile}% of its own history.` : `Its PEG has fallen to ${fixed(peg, 2)}, from ${fixed(prev.peg_ratio, 2)}.`;
      alerts.push({
        type: "MARGIN_OF_SAFETY",
        ticker: t,
        title: `\u{1F3AF} ${t} entry point (${stock2.health_score}/100)`,
        body: `Health is strong and the price has come in. ${reason}`,
        severity: "info",
        url: `/?tab=deepdive&ticker=${t}`
      });
    }
  }
  if (settings.notify_capital_returns && both(m.shareChangeYoY, prev.share_change)) {
    if (m.shareChangeYoY < -0.02 && prev.share_change >= -0.02) {
      alerts.push({
        type: "CAPITAL_RETURN",
        ticker: t,
        title: `\u{1F4C8} ${t} stepped up buybacks`,
        body: `Diluted share count is down ${fixed(Math.abs(m.shareChangeYoY * 100), 1)}% year on year.`,
        severity: "positive",
        url: `/?tab=deepdive&ticker=${t}`
      });
    }
  }
  return alerts;
}

// core/alerts/sweep.js
var DEFAULT_NOTIFICATION_SETTINGS = {
  notify_earnings_filings: 1,
  notify_red_flags: 1,
  notify_margin_of_safety: 1,
  notify_capital_returns: 0,
  notify_sunday_digest: 1
};
var COOLDOWN_DAYS = {
  MARGIN_OF_SAFETY: 14,
  CAPITAL_RETURN: 14,
  RED_FLAG_WARNING: 3,
  EARNINGS_HEALTH_SHIFT: 1,
  WEEKLY_DIGEST: 6
};
var DEFAULT_COOLDOWN_DAYS = 3;
var SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1e3;
var SWEEP_SPACING_MS = 1200;
var DIGEST_WEEKDAY = 0;
var DIGEST_HOUR = 9;
var DIGEST_MOVER_THRESHOLD = 2;
var DIGEST_BASELINE_DAYS = 6;
function snapshotOf(stock2) {
  const m = stock2?.summary?.metrics || {};
  return {
    ticker: stock2?.ticker ?? null,
    health_score: stock2?.health_score ?? null,
    checklist: Object.fromEntries(
      (stock2?.checklist || []).map((c) => [c.id, c.status])
    ),
    altman_z: stock2?.altman_z ?? null,
    piotroski_score: stock2?.piotroski_score ?? null,
    current_ratio: m.currentRatio ?? null,
    gross_margin: m.grossMargin ?? null,
    // Only a P/E history long enough to mean something is carried forward. A
    // percentile over four quarters is not a valuation range, and letting one
    // through would make `MARGIN_OF_SAFETY` fire on earnings recovering off a
    // trough — the cheap-looking case that is not cheap.
    pe_percentile: stock2?.summary?.peHistory?.scoreable === true ? stock2.summary.peHistory.percentile ?? null : null,
    peg_ratio: m.pegRatio ?? null,
    share_change: m.shareChangeYoY ?? null
  };
}
function cooldownDays(alertType) {
  return COOLDOWN_DAYS[alertType] ?? DEFAULT_COOLDOWN_DAYS;
}
function isWithinCooldown(alert, lastDeliveredAt, nowMs = Date.now()) {
  if (lastDeliveredAt === null || lastDeliveredAt === void 0) return false;
  const at = parseStamp(lastDeliveredAt);
  if (at === null) return false;
  return nowMs - at < cooldownDays(alert?.type) * 864e5;
}
function parseStamp(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|z)?$/.exec(String(value).trim());
  if (!m) return null;
  const at = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] || 0),
    Number(m[5] || 0),
    Number(m[6] || 0)
  );
  return Number.isFinite(at) ? at : null;
}
function sweepDecision(stock2) {
  if (!stock2) return "skip";
  if (stock2.staleReason === "rate_limited") return "abandon";
  if (stock2.stale) return "skip";
  return "evaluate";
}
function isSweepAbandonError(err) {
  return err?.kind === "rate_limited";
}
function rollBaseline(previous, nowIso) {
  const held = previous?.week_ago_score ?? null;
  const heldAt = previous?.week_ago_at ?? null;
  const nowMs = parseStamp(nowIso) ?? Date.now();
  const heldAtMs = heldAt === null ? null : parseStamp(heldAt);
  const age = heldAtMs === null ? Infinity : nowMs - heldAtMs;
  const stale = heldAt === null || age >= DIGEST_BASELINE_DAYS * 864e5;
  if (!stale) return { score: held, at: heldAt };
  const adopting = previous?.health_score ?? null;
  return adopting === null ? { score: null, at: null } : { score: adopting, at: nowIso };
}
function buildDigest({ listName, holdings } = {}) {
  const rows = (holdings || []).filter((h) => typeof h.healthScore === "number");
  if (!rows.length) return null;
  const totalCap = rows.reduce((s, r) => s + (r.marketCap || 0), 0);
  const composite = totalCap ? Math.round(rows.reduce((s, r) => s + r.healthScore * (r.marketCap || 0), 0) / totalCap) : Math.round(rows.reduce((s, r) => s + r.healthScore, 0) / rows.length);
  const movers = rows.filter((r) => typeof r.previousScore === "number").map((r) => ({ ticker: r.ticker, delta: r.healthScore - r.previousScore })).filter((mv) => Math.abs(mv.delta) >= DIGEST_MOVER_THRESHOLD).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const moverText = movers.length ? ` Movers: ${movers.slice(0, 3).map((mv) => `${mv.ticker} ${mv.delta > 0 ? "+" : ""}${mv.delta}`).join(", ")}.` : " No material health changes this week.";
  return {
    type: "WEEKLY_DIGEST",
    ticker: "",
    title: `\u{1F3A9} ${listName}: ${composite}/100`,
    body: `${rows.length} holdings scored.${moverText}`,
    severity: "info",
    url: "/?tab=watchlist"
  };
}

// core/host/alerts.js
async function host2(name, payload) {
  const fn = globalThis[name];
  if (typeof fn !== "function") {
    throw new Error(`Host did not provide ${name}`);
  }
  const raw = await fn(JSON.stringify(payload));
  if (raw === void 0 || raw === null || raw === "") return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}
function defaults() {
  return DEFAULT_NOTIFICATION_SETTINGS;
}
function spacingMs() {
  return SWEEP_SPACING_MS;
}
function intervalMs() {
  return SWEEP_INTERVAL_MS;
}
function digestSlot() {
  return { weekday: DIGEST_WEEKDAY, hour: DIGEST_HOUR };
}
async function sweepTicker(ticker, settings) {
  const result = await stock(ticker);
  if (!result.ok) {
    if (isSweepAbandonError(result.error)) {
      return done(ticker, "abandon", "rate_limited");
    }
    return done(ticker, "skipped", result.error?.kind ?? "unknown");
  }
  const data = result.data;
  const decision = sweepDecision(data);
  if (decision === "abandon") return done(ticker, "abandon", "rate_limited");
  if (decision === "skip") return done(ticker, "skipped", data?.staleReason ?? "stale");
  const prev = await host2("__alertSnapshotRead", { ticker });
  const alerts = [];
  const suppressed = [];
  for (const alert of evaluateTriggers(data, prev, settings)) {
    const last = await host2("__alertLastDelivered", {
      type: alert.type,
      ticker: alert.ticker || ""
    });
    if (isWithinCooldown(alert, last?.at ?? null)) {
      suppressed.push(`${alert.ticker} ${alert.type}`);
      continue;
    }
    alerts.push(alert);
  }
  const baseline = rollBaseline(prev, (/* @__PURE__ */ new Date()).toISOString());
  return {
    ticker,
    action: "evaluated",
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
function digest(input) {
  return buildDigest(input);
}
function cooledDown(alert, lastDeliveredAt) {
  return isWithinCooldown(alert, lastDeliveredAt ?? null);
}
export {
  cooledDown,
  defaults,
  digest,
  digestSlot,
  intervalMs,
  spacingMs,
  sweepTicker
};
