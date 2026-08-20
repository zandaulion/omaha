import dotenv from 'dotenv';
import { db } from './db.js';
import { formatMoney } from './scoring.js';

dotenv.config();

/**
 * Pocket Omaha — Gemini Fundamental & Moat Analysis Engine
 * Sends comprehensive stock KPIs, computed scores (Altman Z, Piotroski, ROIC, DCF),
 * 12-point checklist, and trends to Google Gemini to receive a structured
 * Warren Buffett / Charlie Munger style summary, moat breakdown, and actionable conclusion.
 */

const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

export function getGeminiApiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

export function getGeminiModel() {
  return (process.env.GEMINI_MODEL || 'gemini-3.7-flash').trim();
}

/**
 * Retrieve cached AI summary from SQLite
 */
export function getCachedAISummary(ticker) {
  try {
    const row = db.prepare('SELECT * FROM ai_summaries WHERE ticker = ?').get(ticker.toUpperCase());
    if (row && row.summary_json) {
      return {
        ...JSON.parse(row.summary_json),
        createdAt: row.created_at
      };
    }
  } catch (err) {
    console.warn('[Gemini] DB read warning:', err.message);
  }
  return null;
}

/**
 * Save AI summary to SQLite
 */
export function saveCachedAISummary(ticker, summary) {
  try {
    const stmt = db.prepare(`
      INSERT INTO ai_summaries (ticker, summary_json, created_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(ticker) DO UPDATE SET
        summary_json = excluded.summary_json,
        created_at = datetime('now')
    `);
    stmt.run(ticker.toUpperCase(), JSON.stringify(summary));
  } catch (err) {
    console.warn('[Gemini] DB save warning:', err.message);
  }
}

/**
 * Build a structured payload containing all available stock information and computed KPIs
 */
export function buildComprehensivePayload(stock, thesis = null) {
  const sum = stock.summary || {};
  const m = sum.metrics || {};
  const r = sum.ratios || {};
  const dcf = sum.dcf || {};
  const hist = stock.financials?.historical || {};
  const currency = stock.currency || 'USD';

  // Anything the filings do not contain is sent as the string "not reported",
  // never as a plausible-looking number. The previous payload asserted
  // "Fortress (> 25x)" interest coverage for every company, so the model
  // confidently explained a ratio that had never been measured.
  const NR = 'not reported';
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const pct = (v, dp = 1) => (n(v) === null ? NR : `${(v * 100).toFixed(dp)}%`);
  const pctRaw = (v, dp = 1) => (n(v) === null ? NR : `${v.toFixed(dp)}%`);
  const mult = (v, dp = 2) => (n(v) === null ? NR : `${v.toFixed(dp)}x`);
  const money = (v) => (n(v) === null ? NR : formatMoney(v, currency));

  const checklistFormatted = (stock.checklist || []).map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    value: c.value,
    benchmark: c.benchmark,
    // 'na' means the measure is absent from the filings, not that it failed.
    status: c.status === 'na' ? 'not measurable from the filings' : c.status,
    explanation: c.explanation
  }));

  const pillarsFormatted = (stock.pillars || []).map((p) => ({
    name: p.name,
    score: p.score === null ? NR : `${p.score}/${p.max}`,
    percentage: p.pct === null ? NR : `${p.pct}%`,
    measuresAvailable: `${p.measured} of ${p.of}`
  }));

  return {
    dataIntegrityNotice:
      'Every field below comes from filed statements. A value of "not reported" ' +
      'means the company does not disclose that line item — do not estimate it, ' +
      'do not infer it, and do not describe it as strong or weak. Say it is not disclosed.',

    company: {
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector || NR,
      industry: stock.industry || NR,
      businessModel: m.isFinancial
        ? 'Bank, insurer or REIT — working-capital ratios, gross margin and free-cash-flow valuation do not apply'
        : 'Operating company',
      reportingCurrency: currency,
      fiscalPeriodEnd: m.fiscalPeriodEnd || NR,
      price: `${formatMoney(stock.price, currency)}`,
      changePercent: n(stock.change_pct) === null ? NR : `${stock.change_pct >= 0 ? '+' : ''}${stock.change_pct.toFixed(2)}%`,
      marketCap: money(m.marketCap)
    },

    healthScoring: {
      compositeHealthScore:
        stock.health_score === null
          ? 'not scored — too few line items filed to form a composite'
          : `${stock.health_score}/100`,
      grade: sum.healthGrade || NR,
      label: sum.healthLabel || NR,
      measurementCoverage: sum.coverage
        ? `${sum.coverage.measured} of ${sum.coverage.total} sub-scores measurable (${sum.coverage.pct}%)`
        : NR,
      pillars: pillarsFormatted
    },

    quantitativeKPIs: {
      altmanZScore: {
        score: n(stock.altman_z) === null ? NR : stock.altman_z,
        zone:
          n(stock.altman_z) === null
            ? (m.isFinancial ? 'not defined for financial institutions' : NR)
            : stock.altman_z >= 3 ? 'safe zone'
            : stock.altman_z >= 1.8 ? 'grey zone'
            : 'distress zone'
      },
      piotroskiFScore:
        n(stock.piotroski_score) === null
          ? NR
          : `${stock.piotroski_score}/9`,
      returnOnInvestedCapital: pctRaw(m.roic),
      estimatedWACC: pctRaw(m.wacc),
      roicSpreadOverWACC: n(m.roicSpread) === null ? NR : `${m.roicSpread >= 0 ? '+' : ''}${m.roicSpread.toFixed(1)} points`,
      returnOnEquity: pct(m.roe),
      freeCashFlowConversion: n(stock.fcf_conversion_pct) === null ? NR : `${stock.fcf_conversion_pct}% of net income`,
      grossMargin: pct(m.grossMargin),
      operatingMargin: pct(m.operatingMargin),
      effectiveTaxRate: m.taxRateEstimated ? `${NR} (statutory 21% assumed)` : pct(m.effectiveTaxRate)
    },

    balanceSheet: {
      cashAndShortTermInvestments: money(m.cash),
      totalDebt: money(m.totalDebt),
      netPosition:
        n(m.netCash) === null ? NR
          : m.netCash >= 0 ? `${money(m.netCash)} net cash`
          : `${money(Math.abs(m.netCash))} net debt`,
      shareholderEquity: m.negativeEquity ? 'negative book equity' : money(m.equity),
      currentRatio: n(m.currentRatio) === null ? NR : m.currentRatio.toFixed(2),
      quickRatio: n(m.quickRatio) === null ? NR : m.quickRatio.toFixed(2),
      debtToEquity: m.negativeEquity ? 'undefined — book equity is negative' : mult(m.debtToEquity),
      netDebtToEbitda: mult(m.netDebtToEbitda),
      interestCoverage: m.interestCoverageUnburdened
        ? 'no debt burden to cover'
        : n(m.interestCoverage) === null ? NR : `${m.interestCoverage.toFixed(1)}x` +
            (m.interestExpenseCarried ? ` (interest expense last filed ${m.interestExpenseAsOf})` : '')
    },

    valuation: {
      trailingPE: mult(r.pe, 1),
      forwardPE: mult(r.forwardPE, 1),
      pegRatio: n(r.peg) === null ? NR : r.peg <= 0 ? 'undefined — expected growth is negative' : mult(r.peg),
      priceToBook: mult(r.priceToBook),
      dividendYield: pct(r.dividendYield, 2),
      peVersusOwnHistory: sum.peHistory?.available
        ? `${sum.peHistory.current}x now, five-year range ${sum.peHistory.min}x to ${sum.peHistory.max}x, ` +
          `median ${sum.peHistory.median}x — currently at the ${sum.peHistory.percentile}th percentile`
        : NR,
      dcfFairValue: dcf.applicable
        ? `${formatMoney(dcf.fairValue, currency)} per share`
        : `not modelled (${dcf.reason || 'inputs unavailable'})`,
      dcfAssumptions: dcf.applicable
        ? `${(dcf.assumptions.growthRate * 100).toFixed(1)}% growth, ` +
          `${dcf.assumptions.terminalMultiple}x terminal multiple, ` +
          `${(dcf.assumptions.discountRate * 100).toFixed(1)}% discount rate`
        : NR,
      marginOfSafety:
        !dcf.applicable ? NR
          : n(dcf.marginOfSafetyPct) === null ? NR
          : dcf.marginOfSafetyPct >= 0
            ? `+${dcf.marginOfSafetyPct}% below fair value`
            : `${dcf.premiumToFairValuePct}% above fair value`
    },

    growthAndHistory: {
      fiscalYears: hist.periods || [],
      revenueByYear: hist.revenue || [],
      freeCashFlowByYear: hist.freeCashFlow || [],
      grossMarginByYear: hist.grossMarginPct || [],
      operatingMarginByYear: hist.operatingMarginPct || [],
      dilutedSharesByYear: hist.sharesOutstanding || [],
      note: 'Arrays carry null for a year the company did not report that line. Only the years listed are filed data — there is no padding or extrapolation.',
      revenueCAGR: n(m.revenueCAGR) === null ? NR : `${(m.revenueCAGR * 100).toFixed(1)}% over ${m.cagrYears} years`,
      epsCAGR: n(m.epsCAGR) === null ? NR : `${(m.epsCAGR * 100).toFixed(1)}%`,
      fcfPerShareCAGR: n(m.fcfPerShareCAGR) === null ? NR : `${(m.fcfPerShareCAGR * 100).toFixed(1)}%`,
      shareCountChangeYoY:
        n(m.shareChangeYoY) === null ? NR
          : `${(m.shareChangeYoY * 100).toFixed(1)}% (${m.shareChangeYoY < 0 ? 'buybacks' : 'dilution'})`,
      grossMarginTrend: m.quarterlyGrossMarginTrend
        ? `${m.quarterlyGrossMarginTrend.changeBps >= 0 ? '+' : ''}${m.quarterlyGrossMarginTrend.changeBps} bps across ${m.quarterlyGrossMarginTrend.quarters} filed quarters`
        : n(m.grossMarginChangeBps) === null ? NR : `${m.grossMarginChangeBps >= 0 ? '+' : ''}${m.grossMarginChangeBps} bps year on year`
    },

    twelvePointChecklist: {
      summary: sum.checklistSummary || {},
      items: checklistFormatted
    },

    systemGeneratedMoatsAndRisks: {
      catalysts: stock.catalysts || [],
      risks: stock.risks || []
    },

    userInvestmentThesis: thesis
      ? {
          conviction: thesis.conviction,
          targetBuyPrice: thesis.target_buy_price
            ? formatMoney(thesis.target_buy_price, currency)
            : null,
          coreRationale: thesis.core_rationale,
          sellGuardrails: thesis.sell_triggers_json ? JSON.parse(thesis.sell_triggers_json) : []
        }
      : null
  };
}

/**
 * Generate in-depth Gemini analysis
 */
export async function generateStockAISummary(stock, thesis = null) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server. Please provide a valid Gemini API key.');
  }

  const model = getGeminiModel();
  const payloadData = buildComprehensivePayload(stock, thesis);

  const promptText = `
You are the world's foremost fundamental equity analyst and value investing partner embodying the rigorous intellectual frameworks of Warren Buffett, Charlie Munger, and Benjamin Graham.

Analyse the filed fundamentals, computed KPIs, 12-point checklist and multi-year trends for:
Company: ${stock.name} (${stock.ticker})
Sector / Industry: ${stock.sector || 'not reported'} · ${stock.industry || 'not reported'}

ABSOLUTE RULE ON DATA INTEGRITY
Any field reading "not reported" is absent from this company's filings. You must
not estimate it, infer it from a peer, or characterise it as strong or weak. Where
a measure matters and is missing, say so plainly — "the company does not disclose
X" is a useful finding, and inventing a figure is the one failure mode that makes
this analysis worthless. The same applies to nulls inside the year-by-year arrays.
Where the composite health score reads "not scored", do not substitute a grade of
your own; explain which measures were unavailable and what that limits.

Here is the complete quantitative data package:
${JSON.stringify(payloadData, null, 2)}

Provide a deeply insightful, rigorous, plain-English analysis for a disciplined long-term investor.
Return a valid JSON object matching EXACTLY this structure:

{
  "verdict": "string: A sharp, punchy 1-sentence bottom-line verdict synthesizing business quality and current valuation.",
  "verdictGrade": "string: One of 'PRISTINE_MOAT' | 'SOLID_COMPOUNDER' | 'VALUATION_WATCH' | 'CYCLICAL_LEVERAGE' | 'DISTRESS_RISK'",
  "verdictBadge": "string: Short badge with emoji (e.g. '👑 Wide Moat Compounder', '⚖️ Solid Moat at Fair Value', '⚠️ Stretched Valuation', '🚨 High Debt Risk')",
  "buffettPrinciple": "string: A relevant, memorable Buffett, Munger, or Graham rule or quote that directly applies to this company's profile and current situation.",
  "executiveSummary": "string: A clear, engaging 2-3 paragraph executive summary explaining what the business does, the durability of its economic engine, its balance sheet strength, and where it stands right now.",
  "moatAndProfitability": {
    "rating": "string: 'WIDE_MOAT' | 'NARROW_MOAT' | 'NO_MOAT'",
    "ratingLabel": "string: e.g. 'Wide Moat (High Pricing Power & ROIC)'",
    "explanation": "string: Detailed explanation evaluating return on invested capital, gross and operating margin stability, pricing power against inflation, customer lock-in, and competitive durability."
  },
  "solvencyAndSafety": {
    "rating": "string: 'FORTRESS' | 'SOLID' | 'MODERATE' | 'DISTRESSED'",
    "ratingLabel": "string: e.g. 'Fortress Balance Sheet (Zero Solvency Risk)'",
    "explanation": "string: Plain-English explanation evaluating the Altman Z-score, the Piotroski F-score, cash against total debt, the current ratio, and recession resilience."
  },
  "valuationAndDCF": {
    "rating": "string: 'ATTRACTIVE_DISCOUNT' | 'FAIRLY_VALUED' | 'RICH_PREMIUM' | 'HIGH_RISK_BUBBLE'",
    "ratingLabel": "string: e.g. 'Fairly Valued with Modest Margin of Safety'",
    "explanation": "string: Critical evaluation of current P/E, PEG ratio, free cash flow yield, and DCF intrinsic fair value vs market price. Explain whether the current price offers an adequate margin of safety."
  },
  "keyStrengths": [
    {
      "title": "string: Short concise title (e.g. 'Exceptional Reinvestment Runway (68% ROIC)')",
      "detail": "string: Clear explanation of how this strength drives shareholder value."
    }
  ],
  "keyRisks": [
    {
      "title": "string: Short concise title (e.g. 'Valuation Vulnerability to Growth Deceleration')",
      "detail": "string: Clear explanation of what could go wrong and what risks to monitor."
    }
  ],
  "conclusion": "string: Plain-English, actionable investment conclusion for a long-term compounder investor.",
  "buyZone": {
    "targetRange": "string: e.g. 'Under $125.00 for 15%+ Margin of Safety'",
    "perspective": "string: Concise rationale for the target entry zone based on DCF and normalized earnings."
  },
  "whatToWatch": [
    "string: Concrete metric or catalyst to monitor in upcoming 10-Q/10-K filings (e.g. 'Sustained Gross Margins > 72%')"
  ]
}
`.trim();

  const requestBody = {
    contents: [
      {
        parts: [{ text: promptText }]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 8192
    }
  };

  const url = `${ENDPOINT_BASE}${encodeURIComponent(model)}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(35000)
  });

  if (!res.ok) {
    let errorDetail = `Gemini API returned status ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson.error?.message) {
        errorDetail = errJson.error.message;
      }
    } catch (e) {}
    throw new Error(`Gemini upstream error: ${errorDetail}`);
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returned an empty response. Please try again.');
  }

  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    // If wrapped in markdown code fence
    const cleanJson = rawText.replace(/```json\s*|\s*```/g, '').trim();
    parsed = JSON.parse(cleanJson);
  }

  const result = {
    ticker: stock.ticker,
    name: stock.name,
    model,
    generatedAt: new Date().toISOString(),
    ...parsed
  };

  saveCachedAISummary(stock.ticker, result);
  return result;
}
