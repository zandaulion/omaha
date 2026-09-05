// Generated from functions/src/ by tools/bundle-functions.mjs.
// Do not edit — edit the source and run `npm run build` in functions/.


// src/index.js
import { initializeApp } from "firebase-admin/app";

// src/analyze.js
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

// ../server/gemini-client.js
import dotenv from "dotenv";

// ../core/format.js
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

// ../core/scoring.js
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

// ../core/analysis/prompt.js
function buildComprehensivePayload(stock, thesis = null) {
  const sum = stock.summary || {};
  const m = sum.metrics || {};
  const r = sum.ratios || {};
  const dcf = sum.dcf || {};
  const pe = sum.peHistory || {};
  const epv = sum.earningsPower || null;
  const hist = stock.financials?.historical || {};
  const currency = m.reportingCurrency || stock.financials?.reportingCurrency || stock.currency || "USD";
  const NR = "not reported";
  const n = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
  const pct = (v, dp = 1) => n(v) === null ? NR : `${fixed(v * 100, dp)}%`;
  const pctRaw = (v, dp = 1) => n(v) === null ? NR : `${fixed(v, dp)}%`;
  const mult = (v, dp = 2) => n(v) === null ? NR : `${fixed(v, dp)}x`;
  const money = (v) => n(v) === null ? NR : formatMoney(v, currency);
  const signed = (v, dp = 1) => n(v) === null ? NR : `${v >= 0 ? "+" : ""}${fixed(v, dp)}%`;
  const checklistFormatted = (stock.checklist || []).map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    value: c.value,
    benchmark: c.benchmark,
    // 'na' means the measure is absent from the filings, not that it failed.
    status: c.status === "na" ? "not measurable from the filings" : c.status
  }));
  const pillarsFormatted = (stock.pillars || []).map((p) => ({
    name: p.name,
    score: p.score === null ? NR : `${p.score}/${p.max}`,
    measuresAvailable: `${p.measured} of ${p.of}`,
    // Flagged explicitly: a pillar scored on half its measures is a weaker
    // claim than the same number scored on all of them.
    partiallyMeasured: p.measured < p.of
  }));
  const provenance = [];
  if (m.marketCapDerived) {
    provenance.push("Market capitalisation is price x filed share count \u2014 Yahoo did not report it.");
  }
  if (m.totalLiabilitiesDerived) {
    provenance.push("Total liabilities derived from assets minus equity \u2014 not separately filed.");
  }
  if (m.interestExpenseCarried && m.interestExpenseAsOf) {
    provenance.push(
      `Interest expense is the last figure the company filed, for ${m.interestExpenseAsOf}, carried forward because more recent years do not report it.`
    );
  }
  if (m.taxRateEstimated) {
    provenance.push(
      "Effective tax rate was not meaningful this year (loss-making or anomalous), so the 21% statutory rate was used for NOPAT."
    );
  }
  if (m.betaClamped) {
    provenance.push(
      `Reported beta of ${m.beta} was clamped to the [0.6, 2.5] range before the WACC estimate. A trailing beta this far outside the range usually reflects a structural break in the regression window rather than genuine risk, and the unclamped figure would imply a cost of equity below government bonds. Treat the WACC as an estimate with wide error bars.`
    );
  }
  if (m.shareChangeIsAnnual === false && m.shareChangeYears) {
    provenance.push(
      `The share-count change spans ${m.shareChangeYears} fiscal years, not one \u2014 the intervening year is not filed. The annualised rate is the comparable figure.`
    );
  }
  if (pe.available && pe.scoreable === false) {
    provenance.push(
      `The P/E history covers only ${pe.months} months across ${pe.epsPeriods} profitable filed years, so it is too short to read as a valuation range and was excluded from scoring. Do not describe it as a five-year range or draw a percentile conclusion from it.`
    );
  }
  if (sum.coverage && sum.coverage.pct < 100) {
    provenance.push(
      `${sum.coverage.total - sum.coverage.measured} of ${sum.coverage.total} sub-scores could not be measured from the filings.`
    );
  }
  return {
    readMeFirst: {
      dataIntegrity: 'Every figure below comes from filed statements or is derived from them. "not reported" means the company does not disclose that line item \u2014 do not estimate it, do not infer it from a peer, and do not describe it as strong or weak. Saying "the company does not disclose X" is a useful finding; inventing a figure is the one failure that makes this analysis worthless.',
      currencies: m.fx?.needed ? `The shares trade in ${m.tradedCurrency} at ${formatMoney(m.tradedPrice, m.tradedCurrency)}, but the company reports in ${currency}. Every figure below is in ${currency}, including the share price used for every ratio and the discounted-cash-flow comparison (${formatMoney(m.price, currency)}), converted at 1 ${m.tradedCurrency} = ${m.fx.rate} ${currency}. When you quote a price to the reader, give the traded figure in ${m.tradedCurrency} and say the fundamentals are in ${currency}. Never mix the two in one comparison.` : `The shares trade and the company reports in the same currency, ${currency}.`,
      units: `All money figures are in ${currency}, the company's reporting currency, and are pre-formatted \u2014 quote them exactly as written and never convert them. Arrays under growthAndHistory are in BILLIONS of ` + currency + " except the margin arrays, which are percentages, and dilutedSharesByYear, which is billions of shares.",
      asOf: `Today is ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}. Market figures are live; fundamentals are as filed to ${m.fiscalPeriodEnd || "an unstated period"}. Anything you say about the "current" position refers to those dates.`,
      provenance: provenance.length ? provenance : ["Every figure below is filed data with no estimation or carry-forward."]
    },
    company: {
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector || NR,
      industry: stock.industry || NR,
      businessModel: m.isFinancial ? "Bank, insurer or REIT \u2014 working-capital ratios, gross margin and free-cash-flow valuation do not apply" : "Operating company",
      reportingCurrency: currency,
      fiscalPeriodEnd: m.fiscalPeriodEnd || NR,
      tradedPrice: `${formatMoney(m.tradedPrice ?? stock.price, m.tradedCurrency || currency)} (as quoted)`,
      priceUsedForRatios: `${formatMoney(m.price, currency)} (reporting currency)`,
      changePercent: n(stock.change_pct) === null ? NR : signed(stock.change_pct, 2),
      marketCap: money(m.marketCap),
      sharesOutstanding: n(m.sharesOutstanding) === null ? NR : `${fixed(m.sharesOutstanding / 1e6, 1)}M shares`,
      enterpriseValue: money(m.enterpriseValue)
    },
    healthScoring: {
      compositeHealthScore: stock.health_score === null ? "not scored \u2014 too few line items filed to form a composite" : `${stock.health_score}/100`,
      grade: sum.healthGrade || NR,
      label: sum.healthLabel || NR,
      measurementCoverage: sum.coverage ? `${sum.coverage.measured} of ${sum.coverage.total} sub-scores measurable (${sum.coverage.pct}%)` : NR,
      pillars: pillarsFormatted
    },
    incomeAndCashFlow: {
      revenue: money(m.revenue),
      grossProfit: money(stock.financials?.grossProfit),
      operatingIncome: money(stock.financials?.operatingIncome),
      ebit: money(m.ebit),
      ebitda: money(m.ebitda),
      netIncome: money(m.netIncome),
      // A material operating cost for a lender, even though the coverage
      // ratio built from it is not meaningful for one.
      interestExpense: money(m.interestExpense),
      operatingCashFlow: money(m.operatingCashFlow),
      capitalExpenditure: money(stock.financials?.capitalExpenditures),
      freeCashFlow: money(m.freeCashFlow),
      dilutedEPS: n(stock.financials?.dilutedEPS) === null ? NR : formatMoney(stock.financials.dilutedEPS, currency)
    },
    quantitativeKPIs: {
      altmanZScore: {
        score: n(stock.altman_z) === null ? NR : fixed(stock.altman_z, 2),
        zone: n(stock.altman_z) === null ? m.isFinancial ? "not defined for financial institutions" : NR : stock.altman_z >= 3 ? "safe zone" : stock.altman_z >= 1.8 ? "grey zone" : "distress zone"
      },
      piotroskiFScore: m.piotroski ? {
        raw: `${m.piotroski.score} of ${m.piotroski.testable} testable signals`,
        scaled: `${m.piotroski.normalised}/9`,
        note: m.piotroski.testable < 9 ? `${9 - m.piotroski.testable} signal(s) could not be tested from the filings; the scaled figure is comparable with a full 9-signal score but rests on less evidence.` : "all nine signals testable"
      } : NR,
      returnOnInvestedCapital: pctRaw(m.roic),
      estimatedWACC: pctRaw(m.wacc),
      roicSpreadOverWACC: n(m.roicSpread) === null ? NR : `${m.roicSpread >= 0 ? "+" : ""}${fixed(m.roicSpread, 1)} points`,
      returnOnEquity: pct(m.roe),
      returnOnAssets: pct(m.roa),
      assetTurnover: n(m.assetTurnover) === null ? NR : `${fixed(m.assetTurnover, 2)}x`,
      sectorMedianAssetTurnover: n(m.sectorMedianAssetTurnover) === null ? "no sector peers cached for comparison" : `${fixed(m.sectorMedianAssetTurnover, 2)}x`,
      freeCashFlowConversion: n(stock.fcf_conversion_pct) === null ? NR : `${stock.fcf_conversion_pct}% of net income`,
      grossMargin: pct(m.grossMargin),
      operatingMargin: pct(m.operatingMargin),
      freeCashFlowMargin: pct(m.fcfMargin),
      effectiveTaxRate: m.taxRateEstimated ? `${NR} (statutory 21% assumed)` : pct(m.effectiveTaxRate)
    },
    balanceSheet: {
      cashAndShortTermInvestments: money(m.cash),
      totalDebt: money(m.totalDebt),
      netPosition: n(m.netCash) === null ? NR : m.netCash >= 0 ? `${money(m.netCash)} net cash` : `${money(Math.abs(m.netCash))} net debt`,
      shareholderEquity: m.negativeEquity ? "negative book equity" : money(m.equity),
      totalLiabilities: money(m.totalLiabilities),
      workingCapital: money(m.workingCapital),
      currentRatio: n(m.currentRatio) === null ? NR : fixed(m.currentRatio, 2),
      quickRatio: n(m.quickRatio) === null ? NR : fixed(m.quickRatio, 2),
      debtToEquity: m.negativeEquity ? "undefined \u2014 book equity is negative" : mult(m.debtToEquity),
      netDebtToEbitda: mult(m.netDebtToEbitda),
      equityToAssets: pct(m.equityToAssets),
      interestCoverage: m.interestCoverageUnburdened ? "no debt burden to cover" : n(m.interestCoverage) === null ? NR : `${fixed(m.interestCoverage, 1)}x`
    },
    valuation: {
      trailingPE: mult(r.pe, 1),
      forwardPE: mult(r.forwardPE, 1),
      pegRatio: n(r.peg) === null ? NR : r.peg <= 0 ? "undefined \u2014 expected growth is negative" : mult(r.peg),
      priceToBook: mult(r.priceToBook),
      dividendYield: pct(r.dividendYield, 2),
      dividendPayoutOfFreeCashFlow: pct(m.dividendPayoutOnFcf),
      consecutiveDividendYears: n(m.dividendStreakYears) === null || m.dividendStreakYears === 0 ? "no dividend paid in the filed years" : `${m.dividendStreakYears}`,
      freeCashFlowYield: pct(m.fcfYield, 2),
      evToFreeCashFlowYield: pct(m.evToFcfYield, 2),
      // Reported with its true span. Saying "five-year range" for eighteen
      // months of trough-earnings multiples is exactly the kind of confident
      // wrong statement the integrity rule above exists to prevent.
      priceEarningsVersusOwnHistory: pe.available ? {
        currentMultiple: `${pe.current}x`,
        historyCovers: `${pe.months} months across ${pe.epsPeriods} profitable filed years`,
        range: `${pe.min}x to ${pe.max}x, median ${pe.median}x`,
        percentileOfOwnHistory: `${pe.percentile}th`,
        usableAsAValuationRange: pe.scoreable === true,
        caution: pe.scoreable === true ? null : "Too short to be a valuation range. A low percentile here reflects earnings recovering off a trough, not a multiple compressing. Do not present it as a five-year range or draw a cheapness conclusion from it."
      } : `not available \u2014 ${pe.reason || "insufficient history"}`,
      // Which model produced the fair value below. Two of them can now, and a
      // reader comparing a bank with an industrial is comparing two different
      // claims about two different kinds of business.
      fairValueModel: dcf.method === "return-on-tangible-equity" ? "return on tangible equity against its cost \u2014 a discounted cash flow says nothing about a lender, whose free cash flow is deposits and the loan book moving" : dcf.method === "discounted-cash-flow" ? "two-stage discounted free cash flow" : "none applies to this balance sheet",
      dcfFairValue: dcf.applicable ? `${formatMoney(dcf.fairValue, currency)} per share` : `not modelled (${dcf.reason || "inputs unavailable"})`,
      // Per model. This block used to read the discounted model's assumptions
      // whatever had actually run, so a bank arrived carrying a cash flow base
      // of minus 29 billion — the very number its own model exists to avoid.
      dcfAssumptions: !dcf.applicable ? NR : dcf.method === "return-on-tangible-equity" ? {
        returnOnTangibleEquity: `${fixed(dcf.rote * 100, 1)}% \u2014 the median of ${dcf.roteYears} filed years`,
        latestFiledYear: n(dcf.roteLatest) === null ? NR : `${fixed(dcf.roteLatest * 100, 1)}%`,
        rangeAcrossFiledYears: n(dcf.roteLow) === null ? NR : `${fixed(dcf.roteLow * 100, 1)}% to ${fixed(dcf.roteHigh * 100, 1)}%`,
        costOfEquity: `${fixed((dcf.assumptions.costOfEquity ?? 0) * 100, 1)}%`,
        growth: `${fixed((dcf.assumptions.growthRate ?? 0) * 100, 1)}% a year \u2014 ${dcf.assumptions.growthBasis}`,
        payoutRatio: n(dcf.assumptions.payoutRatio) === null ? NR : `${fixed(dcf.assumptions.payoutRatio * 100, 0)}% of earnings`,
        justifiedPriceToTangibleBook: `${dcf.justifiedPTBV}x`,
        tangibleBookValuePerShare: formatMoney(dcf.tangibleBookValuePerShare, currency),
        // Gordon growth divides one small difference by another, so the
        // answer is soft. The band the bank's own record supports is the
        // honest way to say so.
        sensitivity: n(dcf.fairValueAtWorstYear) === null && n(dcf.fairValueAtBestYear) === null ? NR : `on its worst and best filed years the same model gives ${n(dcf.fairValueAtWorstYear) === null ? "no value" : formatMoney(dcf.fairValueAtWorstYear, currency)} and ${n(dcf.fairValueAtBestYear) === null ? "no value" : formatMoney(dcf.fairValueAtBestYear, currency)}. Treat the single figure as the middle of that, not as a precise number.`
      } : {
        cashFlowBase: `${formatMoney(dcf.assumptions.cashFlowBase, currency)} \u2014 ${dcf.assumptions.cashFlowBasis}`,
        latestFiledCashFlow: money(dcf.assumptions.latestFiledCashFlow),
        growth: `${fixed(dcf.assumptions.growthRate * 100, 1)}% a year for 5 years \u2014 ${dcf.assumptions.growthBasis}`,
        terminalMultiple: `${dcf.assumptions.terminalMultiple}x on year-5 free cash flow`,
        discountRate: `${fixed(dcf.assumptions.discountRate * 100, 1)}%`
      },
      // The rate that would reconcile the model with the traded price. Where
      // the two disagree sharply this is the more informative number, and the
      // model should reason from it rather than declaring the market wrong.
      growthRateImpliedByMarketPrice: n(dcf.impliedGrowthRate) === null ? NR : `${fixed(dcf.impliedGrowthRate * 100, 1)}% a year`,
      // The same question where the balance-sheet model runs: what the buyer
      // must believe about the bank's return to pay what it costs.
      returnOnTangibleEquityImpliedByMarketPrice: n(dcf.impliedRote) === null ? NR : `${fixed(dcf.impliedRote * 100, 1)}% \u2014 compare it with what the bank has actually earned above before deciding who is right`,
      modelVersusMarket: dcf.divergenceWarning ? `The modelled fair value is ${dcf.divergenceFactor}x the traded price. A gap this wide usually means the assumptions need revisiting or the market is pricing in something the filings do not show. Say so plainly rather than presenting it as free money.` : "The model and the market are within a normal range of each other.",
      // A second opinion built to disagree: no growth in it at all. Where the
      // two are far apart, the gap is what the market is paying for growth,
      // which is a more useful sentence than either number alone.
      earningsPowerNoGrowth: epv && epv.applicable ? {
        valuePerShare: `${formatMoney(epv.valuePerShare, currency)} per share`,
        builtFrom: `median operating profit of ${formatMoney(epv.normalisedEbit, currency)} across ${epv.ebitYears} filed years, taxed at ${fixed(epv.taxRate * 100, 0)}% and capitalised at ${fixed(epv.waccPct, 1)}%`,
        whatTheMarketPaysForGrowth: n(epv.premiumForGrowthPct) === null ? NR : epv.premiumForGrowthPct >= 0 ? `the price is ${fixed(epv.premiumForGrowthPct, 0)}% above the business as it stands, so that much of it is being paid for growth that has not happened yet` : `the price is ${fixed(Math.abs(epv.premiumForGrowthPct), 0)}% below the business as it stands \u2014 cheap without needing anything to go right, which is a rarer and stronger claim than a favourable discounted cash flow`
      } : `not modelled (${epv && epv.reason || "inputs unavailable"})`,
      marginOfSafety: !dcf.applicable ? NR : n(dcf.marginOfSafetyPct) === null ? NR : dcf.marginOfSafetyPct >= 0 ? `trading ${dcf.marginOfSafetyPct}% below the modelled fair value` : `trading ${dcf.premiumToFairValuePct}% above the modelled fair value`
    },
    growthAndHistory: {
      unitsNote: "Units are in each key name. A null means the company did not report that line that year \u2014 there is no padding or extrapolation anywhere in these arrays.",
      fiscalYears: hist.periods || [],
      // The unit is carried in the key rather than in a note: a model reading
      // an array of -8.9 alongside dollar figures elsewhere will otherwise
      // describe a -8.9% operating margin as "negative $8.9M".
      [`revenueByYear_billions${currency}`]: hist.revenue || [],
      [`freeCashFlowByYear_billions${currency}`]: hist.freeCashFlow || [],
      [`netIncomeByYear_billions${currency}`]: hist.netIncome || [],
      grossMarginByYear_percent: hist.grossMarginPct || [],
      operatingMarginByYear_percent: hist.operatingMarginPct || [],
      dilutedSharesByYear_billionsOfShares: hist.sharesOutstanding || [],
      [`dilutedEPSByYear_${currency}perShare`]: hist.dilutedEPS || [],
      revenueCAGR: n(m.revenueCAGR) === null ? NR : `${fixed(m.revenueCAGR * 100, 1)}% over ${m.cagrYears} years`,
      epsCAGR: n(m.epsCAGR) === null ? `${NR} (undefined when the series crosses zero)` : `${fixed(m.epsCAGR * 100, 1)}%`,
      fcfPerShareCAGR: n(m.fcfPerShareCAGR) === null ? `${NR} (undefined when the series crosses zero)` : `${fixed(m.fcfPerShareCAGR * 100, 1)}%`,
      shareCountChange: n(m.shareChangeYoY) === null ? NR : `${fixed(m.shareChangeYoY * 100, 1)}% over ${m.shareChangeYears || 1} fiscal year${(m.shareChangeYears || 1) === 1 ? "" : "s"} (${m.shareChangeAnnualisedPct >= 0 ? "+" : ""}${m.shareChangeAnnualisedPct}% a year), ${m.shareChangeYoY < 0 ? "buybacks" : "dilution"}`,
      freeCashFlowPositiveYears: `${m.fcfPositiveYears} of ${m.fcfReportedYears} filed years`,
      grossMarginTrend: m.quarterlyGrossMarginTrend ? `${m.quarterlyGrossMarginTrend.changeBps >= 0 ? "+" : ""}${m.quarterlyGrossMarginTrend.changeBps} bps across ${m.quarterlyGrossMarginTrend.quarters} filed quarters (${m.quarterlyGrossMarginTrend.margins.join("% -> ")}%)` : n(m.grossMarginChangeBps) === null ? NR : `${m.grossMarginChangeBps >= 0 ? "+" : ""}${m.grossMarginChangeBps} bps year on year`,
      operatingMarginTrend: n(m.operatingMarginChangeBps) === null ? NR : `${m.operatingMarginChangeBps >= 0 ? "+" : ""}${m.operatingMarginChangeBps} bps year on year`
    },
    twelvePointChecklist: {
      summary: sum.checklistSummary || {},
      items: checklistFormatted
    },
    systemGeneratedFlags: {
      note: "These fire on fixed thresholds and are not an exhaustive assessment. An empty risk list means no threshold tripped, NOT that the company carries no risks \u2014 derive those yourself from the data above.",
      catalysts: (stock.catalysts || []).map((c) => c.title + ": " + c.text),
      risks: (stock.risks || []).map((c) => c.title + ": " + c.text)
    },
    userInvestmentThesis: thesis ? {
      conviction: thesis.conviction,
      targetBuyPrice: thesis.target_buy_price ? formatMoney(thesis.target_buy_price, currency) : null,
      coreRationale: thesis.core_rationale,
      sellGuardrails: thesis.sell_triggers_json ? JSON.parse(thesis.sell_triggers_json) : []
    } : "The user has not written a thesis for this company yet."
  };
}
var RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING" },
    verdictGrade: {
      type: "STRING",
      enum: [
        "PRISTINE_MOAT",
        "SOLID_COMPOUNDER",
        "VALUATION_WATCH",
        "CYCLICAL_LEVERAGE",
        "DISTRESS_RISK",
        "INSUFFICIENT_DATA"
      ]
    },
    verdictBadge: { type: "STRING" },
    buffettPrinciple: { type: "STRING" },
    executiveSummary: { type: "STRING" },
    moatAndProfitability: {
      type: "OBJECT",
      properties: {
        rating: { type: "STRING", enum: ["WIDE_MOAT", "NARROW_MOAT", "NO_MOAT", "NOT_ASSESSABLE"] },
        ratingLabel: { type: "STRING" },
        explanation: { type: "STRING" }
      },
      required: ["rating", "ratingLabel", "explanation"]
    },
    solvencyAndSafety: {
      type: "OBJECT",
      properties: {
        rating: { type: "STRING", enum: ["FORTRESS", "SOLID", "MODERATE", "DISTRESSED", "NOT_ASSESSABLE"] },
        ratingLabel: { type: "STRING" },
        explanation: { type: "STRING" }
      },
      required: ["rating", "ratingLabel", "explanation"]
    },
    valuationAndDCF: {
      type: "OBJECT",
      properties: {
        rating: {
          type: "STRING",
          enum: ["ATTRACTIVE_DISCOUNT", "FAIRLY_VALUED", "RICH_PREMIUM", "HIGH_RISK_BUBBLE", "NOT_ASSESSABLE"]
        },
        ratingLabel: { type: "STRING" },
        explanation: { type: "STRING" }
      },
      required: ["rating", "ratingLabel", "explanation"]
    },
    keyStrengths: {
      type: "ARRAY",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "OBJECT",
        properties: { title: { type: "STRING" }, detail: { type: "STRING" } },
        required: ["title", "detail"]
      }
    },
    keyRisks: {
      type: "ARRAY",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "OBJECT",
        properties: { title: { type: "STRING" }, detail: { type: "STRING" } },
        required: ["title", "detail"]
      }
    },
    // Kept apart from everything else so the interface can label it. The model
    // knows things the filings do not contain — why margins collapsed, who the
    // competitors are — and that context is the most valuable thing it adds.
    // But it is recall, not measurement, and the reader must be able to tell.
    contextFromModelKnowledge: {
      type: "OBJECT",
      properties: {
        hasContext: { type: "BOOLEAN" },
        asOfCaveat: { type: "STRING" },
        points: {
          type: "ARRAY",
          maxItems: 4,
          items: {
            type: "OBJECT",
            properties: {
              claim: { type: "STRING" },
              confidence: { type: "STRING", enum: ["HIGH", "MEDIUM", "LOW"] }
            },
            required: ["claim", "confidence"]
          }
        }
      },
      required: ["hasContext", "points"]
    },
    dataLimitations: { type: "ARRAY", maxItems: 4, items: { type: "STRING" } },
    conclusion: { type: "STRING" },
    buyZone: {
      type: "OBJECT",
      properties: {
        // Numeric so the interface can compare it with the live price rather
        // than parsing prose like "Under $125.00 for 15%+ Margin of Safety".
        maxPrice: { type: "NUMBER" },
        // Named explicitly because the two can differ: a buy zone quoted in
        // the trading currency against a fair value computed in the reporting
        // one is not a comparison, it is a category error.
        currency: { type: "STRING" },
        impliedDiscountToFairValuePct: { type: "NUMBER" },
        alreadyInZone: { type: "BOOLEAN" },
        perspective: { type: "STRING" }
      },
      required: ["maxPrice", "currency", "alreadyInZone", "perspective"]
    },
    whatToWatch: { type: "ARRAY", minItems: 2, maxItems: 4, items: { type: "STRING" } }
  },
  required: [
    "verdict",
    "verdictGrade",
    "verdictBadge",
    "buffettPrinciple",
    "executiveSummary",
    "moatAndProfitability",
    "solvencyAndSafety",
    "valuationAndDCF",
    "keyStrengths",
    "keyRisks",
    "contextFromModelKnowledge",
    "dataLimitations",
    "conclusion",
    "buyZone",
    "whatToWatch"
  ],
  propertyOrdering: [
    "verdict",
    "verdictGrade",
    "verdictBadge",
    "buffettPrinciple",
    "executiveSummary",
    "moatAndProfitability",
    "solvencyAndSafety",
    "valuationAndDCF",
    "keyStrengths",
    "keyRisks",
    "contextFromModelKnowledge",
    "dataLimitations",
    "conclusion",
    "buyZone",
    "whatToWatch"
  ]
};
function buildPrompt(stock, thesis = null) {
  const payloadData = buildComprehensivePayload(stock, thesis);
  return `
You are a fundamental equity analyst working in the tradition of Buffett, Munger
and Graham: business quality first, price second, and an unflinching account of
what you do not know.

Company: ${stock.name} (${stock.ticker})
Sector / industry: ${stock.sector || "not reported"} - ${stock.industry || "not reported"}

## How to use the data package

Read readMeFirst before anything else. It states the reporting currency, the
units of every array, the dates the figures refer to, and \u2014 most importantly \u2014
a provenance list of everything that was derived, estimated, carried forward or
clamped rather than filed.

Three rules follow from it, in order of importance:

1. NEVER INVENT A NUMBER. A field reading "not reported" is absent from this
   company's filings. Do not estimate it, do not borrow a peer's, do not call it
   strong or weak. "The company does not disclose X" is a finding worth stating.

2. HONOUR THE PROVENANCE NOTES. Where readMeFirst.provenance says a figure was
   derived, carried forward, clamped or excluded, treat it with that caveat and
   say so where it matters to the conclusion. If a note tells you not to draw a
   particular inference, do not draw it, even if the underlying number is right
   there. Notably: where the P/E history is marked unusable, a low percentile
   reflects earnings recovering off a trough, not a multiple compressing.

3. SEPARATE MEASUREMENT FROM RECALL. Everything in the package is measured. You
   also know things about this company that are not in it \u2014 why margins moved,
   who it competes with, what its regulatory or end-market situation is \u2014 and
   that context is genuinely valuable, often the most valuable thing you add.
   But it is recall, with a training cutoff, and the reader must be able to tell
   it apart. So: put every claim that is not derivable from the package into
   contextFromModelKnowledge, each with an honest confidence rating, and keep it
   out of the other fields. Do not smuggle unsourced narrative into the
   executive summary or the ratings.

## What makes this analysis good

- Interpret; do not narrate. The reader is looking at these numbers on the
  screen already. Tell them what the numbers mean together, which ones are load
  bearing, and which ones would change your mind. A paragraph that restates
  revenue, margin and cash in sequence has added nothing.
- Weigh the evidence honestly. A pillar marked partiallyMeasured is a weaker
  claim than a fully measured one. Say so. Where the composite score is "not
  scored", do not substitute a grade of your own \u2014 set verdictGrade to
  INSUFFICIENT_DATA, explain which measures were missing, and analyse what can
  be analysed.
- systemGeneratedFlags fire on fixed thresholds and are not exhaustive. An empty
  risk list means nothing tripped, not that the company is safe. Derive the real
  risks yourself.
- Quote money figures exactly as formatted in the package, in the company's own
  reporting currency. Never convert, never re-denominate in dollars.
- Fill dataLimitations with the specific things that constrain your confidence
  here \u2014 drawn from the provenance list and the unmeasured items \u2014 not with
  generic disclaimers.
- buyZone.maxPrice is a number in the REPORTING currency, and buyZone.currency
  must name that currency. Compare it against priceUsedForRatios, not against
  the traded price, and make the perspective text state both figures where the
  two currencies differ. A buy zone in one currency compared against a price in
  another is a category error, not a conclusion.
- Write plainly. No filler, no hedging for its own sake, no restating the
  question. Assume a reader who understands accounting and wants judgement.

## Data package

${JSON.stringify(payloadData, null, 2)}
`.trim();
}

// ../server/gemini-client.js
dotenv.config();
var ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
function getGeminiApiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}
function getGeminiModel() {
  return (process.env.GEMINI_MODEL || "gemini-3.7-flash").trim();
}
async function callGemini(stock, thesis = null) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured. Please provide a valid Gemini API key.");
  }
  const model = getGeminiModel();
  const promptText = buildPrompt(stock, thesis);
  const requestBody = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      responseMimeType: "application/json",
      // Enforced server-side, so the shape cannot come back malformed.
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
      // Thinking was previously disabled outright. This is a reasoning task
      // over ~2,500 tokens of financial data — weighing partial measurements
      // against each other is exactly what the budget buys.
      thinkingConfig: { thinkingBudget: 4096 },
      maxOutputTokens: 16384
    }
  };
  const url = `${ENDPOINT_BASE}${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(35e3)
  });
  if (!res.ok) {
    let errorDetail = `Gemini API returned status ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson.error?.message) {
        errorDetail = errJson.error.message;
      }
    } catch (e) {
    }
    throw new Error(`Gemini upstream error: ${errorDetail}`);
  }
  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error("Gemini returned an empty response. Please try again.");
  }
  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    try {
      parsed = JSON.parse(rawText.replace(/```json\s*|\s*```/g, "").trim());
    } catch {
      throw new Error(
        "Gemini returned a response that could not be parsed as JSON. Try again."
      );
    }
  }
  return {
    ticker: stock.ticker,
    name: stock.name,
    model,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    // Ties the analysis to the filing period it was written against, so a
    // cached summary can be spotted as stale once new fundamentals land.
    fiscalPeriodEnd: stock.summary?.metrics?.fiscalPeriodEnd || null,
    priceAtGeneration: stock.price ?? null,
    // Whether this analysis was written with the user's own notes in front of
    // it. Recorded rather than inferred: the preference can be changed after
    // the fact, and a cached summary must still be able to say what it was
    // actually built from. `thesis` is null both when the preference is off
    // and when nothing has been written, and in both cases nothing personal
    // left the device — which is exactly what this flag claims.
    //
    // The relay's shared-by-ticker cache reads this field to decide whether
    // an entry may ever be served to a second account (docs/13 §7): `false`
    // only. Getting it wrong there is a privacy leak, not a cache bug, which
    // is why it is computed once, here, rather than trusted from a caller.
    includedNotes: Boolean(thesis),
    currency: stock.currency || "USD",
    ...parsed
  };
}

// src/cache-key.js
function cacheLocationFor({ ticker, includedNotes }, uid = null) {
  const symbol = String(ticker || "").toUpperCase();
  if (!symbol) return { scope: "unreachable", reason: "no ticker" };
  if (!includedNotes) {
    return { scope: "shared", path: `aiCache/${symbol}` };
  }
  if (!uid) {
    return { scope: "unreachable", reason: "includedNotes is true but no uid was given" };
  }
  return { scope: "private", path: `users/${uid}/aiCache/${symbol}` };
}

// src/analyze.js
var getAiSummary = onCall(async (request) => {
  const ticker = String(request.data?.ticker || "").trim();
  if (!ticker) throw new HttpsError("invalid-argument", "ticker is required");
  const location = cacheLocationFor({ ticker, includedNotes: false });
  if (location.scope !== "shared") {
    throw new HttpsError("internal", "could not resolve a cache location");
  }
  const doc = await getFirestore().doc(location.path).get();
  return { summary: doc.exists ? doc.data() : null };
});
var generateAiSummary = onCall({ secrets: ["GEMINI_API_KEY"] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign in to generate an analysis");
  const ticker = String(request.data?.ticker || "").trim();
  const stock = request.data?.stock;
  const thesis = request.data?.thesis ?? null;
  if (!ticker || !stock || typeof stock !== "object") {
    throw new HttpsError("invalid-argument", "ticker and stock are required");
  }
  const db = getFirestore();
  const balanceRef = db.doc(`users/${uid}`);
  const afterSpend = await db.runTransaction(async (tx) => {
    const snap = await tx.get(balanceRef);
    const credits = snap.exists ? Number(snap.data().credits || 0) : 0;
    if (credits < 1) {
      throw new HttpsError("resource-exhausted", "no credits remaining");
    }
    tx.set(balanceRef, { credits: credits - 1 }, { merge: true });
    return credits - 1;
  });
  let result;
  try {
    result = await callGemini(stock, thesis);
  } catch (err) {
    await balanceRef.set({ credits: FieldValue.increment(1) }, { merge: true });
    throw new HttpsError("internal", err.message || "Gemini call failed");
  }
  const location = cacheLocationFor(
    { ticker, includedNotes: result.includedNotes },
    uid
  );
  if (location.scope !== "unreachable") {
    await db.doc(location.path).set(result);
  }
  return { summary: result, credits: afterSpend };
});

// src/billing.js
import { HttpsError as HttpsError2, onCall as onCall2 } from "firebase-functions/v2/https";
import { FieldValue as FieldValue2, getFirestore as getFirestore2 } from "firebase-admin/firestore";
import { google } from "googleapis";

// src/products.js
var PRODUCTS = {
  omaha_credits_10: { credits: 10, consumable: true, label: "10 analysis credits" }
};
function productFor(productId) {
  return PRODUCTS[productId] ?? null;
}
var FREE_GRANT = { credits: 5, label: "5 free analysis credits" };

// src/play-verify.js
var PURCHASE_STATE_PURCHASED = 0;
var ACKNOWLEDGEMENT_STATE_NOT_ACKNOWLEDGED = 0;
function evaluatePurchase(purchase) {
  if (!purchase || typeof purchase !== "object") {
    return { valid: false, reason: "empty response from Play" };
  }
  if (purchase.purchaseState !== PURCHASE_STATE_PURCHASED) {
    return { valid: false, reason: `purchaseState ${purchase.purchaseState} is not PURCHASED` };
  }
  if (!purchase.orderId) {
    return { valid: false, reason: "purchase has no orderId" };
  }
  return {
    valid: true,
    orderId: purchase.orderId,
    needsAcknowledgement: purchase.acknowledgementState === ACKNOWLEDGEMENT_STATE_NOT_ACKNOWLEDGED
  };
}

// src/settlement.js
function settlementFor(product, evaluated) {
  if (product.consumable) return "consume";
  return evaluated.needsAcknowledgement ? "acknowledge" : "none";
}

// src/billing.js
var PACKAGE_NAME = "com.zandaulion.omaha";
var cachedClient = null;
async function androidPublisher() {
  if (cachedClient) return cachedClient;
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/androidpublisher"]
  });
  cachedClient = google.androidpublisher({ version: "v3", auth });
  return cachedClient;
}
var redeemPurchase = onCall2(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError2("unauthenticated", "sign in to redeem a purchase");
  const productId = String(request.data?.productId || "");
  const purchaseToken = String(request.data?.purchaseToken || "");
  if (!productId || !purchaseToken) {
    throw new HttpsError2("invalid-argument", "productId and purchaseToken are required");
  }
  const product = productFor(productId);
  if (!product) throw new HttpsError2("invalid-argument", `unknown product: ${productId}`);
  const publisher = await androidPublisher();
  const response = await publisher.purchases.products.get({
    packageName: PACKAGE_NAME,
    productId,
    token: purchaseToken
  });
  const evaluated = evaluatePurchase(response.data);
  if (!evaluated.valid) {
    throw new HttpsError2("failed-precondition", `purchase not creditable: ${evaluated.reason}`);
  }
  const db = getFirestore2();
  const redemptionRef = db.doc(`redeemedPurchases/${evaluated.orderId}`);
  const balanceRef = db.doc(`users/${uid}`);
  const { newBalance, alreadyRedeemed } = await db.runTransaction(async (tx) => {
    const [redemption, balance] = await Promise.all([tx.get(redemptionRef), tx.get(balanceRef)]);
    const currentCredits = Number(balance.data()?.credits || 0);
    if (redemption.exists) return { newBalance: currentCredits, alreadyRedeemed: true };
    tx.set(redemptionRef, {
      uid,
      productId,
      credits: product.credits,
      redeemedAt: FieldValue2.serverTimestamp()
    });
    tx.set(balanceRef, { credits: FieldValue2.increment(product.credits) }, { merge: true });
    return { newBalance: currentCredits + product.credits, alreadyRedeemed: false };
  });
  if (!alreadyRedeemed) {
    const settlement = settlementFor(product, evaluated);
    if (settlement === "consume") {
      await publisher.purchases.products.consume({
        packageName: PACKAGE_NAME,
        productId,
        token: purchaseToken
      });
    } else if (settlement === "acknowledge") {
      await publisher.purchases.products.acknowledge({
        packageName: PACKAGE_NAME,
        productId,
        token: purchaseToken,
        requestBody: {}
      });
    }
  }
  return { credits: newBalance, productLabel: product.label };
});

// src/free-grant.js
import { HttpsError as HttpsError3, onCall as onCall3 } from "firebase-functions/v2/https";
import { FieldValue as FieldValue3, getFirestore as getFirestore3 } from "firebase-admin/firestore";
var claimFreeGrant = onCall3(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError3("unauthenticated", "sign in to claim the free grant");
  const db = getFirestore3();
  const balanceRef = db.doc(`users/${uid}`);
  const { newBalance, granted } = await db.runTransaction(async (tx) => {
    const balance = await tx.get(balanceRef);
    const data = balance.data() || {};
    const currentCredits = Number(data.credits || 0);
    if (data.freeGrantClaimedAt) {
      return { newBalance: currentCredits, granted: false };
    }
    tx.set(
      balanceRef,
      {
        credits: FieldValue3.increment(FREE_GRANT.credits),
        freeGrantClaimedAt: FieldValue3.serverTimestamp()
      },
      { merge: true }
    );
    return { newBalance: currentCredits + FREE_GRANT.credits, granted: true };
  });
  return { credits: newBalance, granted, productLabel: FREE_GRANT.label };
});

// src/balance.js
import { HttpsError as HttpsError4, onCall as onCall4 } from "firebase-functions/v2/https";
import { getFirestore as getFirestore4 } from "firebase-admin/firestore";
var getBalance = onCall4(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError4("unauthenticated", "sign in to check your balance");
  const snap = await getFirestore4().doc(`users/${uid}`).get();
  return { credits: Number(snap.data()?.credits || 0) };
});

// src/index.js
initializeApp();
export {
  claimFreeGrant,
  generateAiSummary,
  getAiSummary,
  getBalance,
  redeemPurchase
};
