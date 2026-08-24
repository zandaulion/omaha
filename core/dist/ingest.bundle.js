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
      if (!res.ok) continue;
      const data = await res.json();
      return (data.quotes || []).filter((q) => ["EQUITY", "ETF", "MUTUALFUND"].includes(q.quoteType)).map((q) => ({
        ticker: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        sector: q.sector || q.industry || "",
        industry: q.industry || "",
        exchange: q.exchDisp || q.exchange || "",
        quoteType: q.quoteType || "EQUITY"
      }));
    } catch {
    }
  }
  return [];
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
var EDGAR_USER_AGENT = "PocketOmaha/1.0 (zandaulion/omaha; contact-not-set@example.com)";
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

// core/host/ingest.js
installHostFetch();
async function ingest(ticker, options = {}) {
  if (options.freshSession !== false) __resetSession();
  try {
    const quote = await getQuote(ticker);
    const statements = await getStatements(ticker);
    return { ok: true, ticker, quote, statements };
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
export {
  ingest
};
