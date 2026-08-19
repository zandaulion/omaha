import dotenv from 'dotenv';
import { db } from './db.js';

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
  const f = stock.financials || {};
  const hist = f.historical || {};
  const sum = stock.summary || {};
  const r = sum.ratios || {};
  const dcf = sum.dcf || {};

  const checklistFormatted = (stock.checklist || []).map(c => ({
    id: c.id,
    name: c.name,
    category: c.category,
    value: c.value,
    benchmark: c.benchmark,
    status: c.status,
    explanation: c.explanation
  }));

  const pillarsFormatted = (stock.pillars || []).map(p => ({
    name: p.name,
    score: `${p.score}/${p.max}`,
    percentage: `${p.pct}%`
  }));

  const pFScore = stock.piotroski_score;
  const altmanZ = stock.altman_z;
  const roic = stock.roic_pct;
  const fcfConv = stock.fcf_conversion_pct;
  const netCashB = stock.net_cash_b;

  const payloadData = {
    company: {
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector,
      industry: stock.industry,
      price: `$${stock.price.toFixed(2)} ${stock.currency || 'USD'}`,
      changePercent: `${stock.change_pct >= 0 ? '+' : ''}${stock.change_pct.toFixed(2)}%`,
      marketCap: stock.market_cap ? `$${(stock.market_cap / 1e9).toFixed(2)} Billion` : 'N/A'
    },
    healthScoring: {
      compositeHealthScore: `${stock.health_score}/100`,
      grade: sum.healthGrade || 'N/A',
      tier: sum.healthTier || 'N/A',
      label: sum.healthLabel || 'N/A',
      pillars: pillarsFormatted
    },
    advancedQuantitativeKPIs: {
      altmanZScore: {
        score: altmanZ,
        zone: altmanZ >= 3.0 ? 'Safe Zone (Low Distress Probability)' : altmanZ >= 1.8 ? 'Grey / Watch Zone' : 'Distress Alert'
      },
      piotroskiFScore: {
        score: `${pFScore}/9`,
        classification: pFScore >= 8 ? 'Exceptional Fundamental Momentum' : pFScore >= 6 ? 'Solid Quality' : 'Average / Weak'
      },
      returnOnInvestedCapital: `${roic.toFixed(2)}% (Target: >= 15% for durable economic moat)`,
      freeCashFlowConversion: `${fcfConv}% of Net Income (Target: >= 90% for high earnings quality)`,
      balanceSheetLiquidity: {
        cashAndEquivalents: f.cashAndEquivalents ? `$${(f.cashAndEquivalents / 1e9).toFixed(2)} Billion` : 'N/A',
        totalDebt: f.totalDebt ? `$${(f.totalDebt / 1e9).toFixed(2)} Billion` : '$0',
        netCashPosition: netCashB >= 0 ? `+$${netCashB} Billion (Net Cash Fortress)` : `-$${Math.abs(netCashB)} Billion (Net Debt)`,
        currentRatio: f.currentLiabilities > 0 ? (f.currentAssets / f.currentLiabilities).toFixed(2) : 'N/A',
        interestCoverage: f.interestExpense > 0 && f.ebit ? (f.ebit / f.interestExpense).toFixed(1) + 'x' : 'Fortress (> 25x)'
      }
    },
    twelvePointChecklist: {
      summary: sum.checklistSummary || {},
      items: checklistFormatted
    },
    valuationAndDCF: {
      trailingPE: r.pe ? `${r.pe.toFixed(1)}x` : 'N/A',
      forwardPE: r.forwardPE ? `${r.forwardPE.toFixed(1)}x` : 'N/A',
      pegRatio: r.peg ? `${r.peg.toFixed(2)}x` : 'N/A',
      dividendYield: r.dividendYield ? `${(r.dividendYield * 100).toFixed(2)}%` : '0%',
      dcfFairValueEstimated: dcf.fairValue ? `$${dcf.fairValue.toFixed(2)}` : 'N/A',
      dcfMarginOfSafety: dcf.marginOfSafetyPct !== undefined ? `${dcf.marginOfSafetyPct >= 0 ? '+' : ''}${dcf.marginOfSafetyPct}% (${dcf.marginOfSafetyPct >= 0 ? 'Undervalued' : 'Overvalued'})` : 'N/A'
    },
    historical5YearTrends: {
      years: hist.years || [],
      revenueTrajectoryBillion: hist.revenue || [],
      freeCashFlowTrajectoryBillion: hist.freeCashFlow || [],
      grossMarginTrajectoryPercent: hist.grossMarginPct || [],
      operatingMarginTrajectoryPercent: hist.operatingMarginPct || [],
      sharesOutstandingTrajectoryBillion: hist.sharesOutstanding || [],
      revenue3YearCAGR: hist.revenue3yCAGR ? `${(hist.revenue3yCAGR * 100).toFixed(1)}%` : 'N/A',
      shareDilutionYoY: hist.shareDilutionYoY !== undefined ? `${(hist.shareDilutionYoY * 100).toFixed(1)}% (${hist.shareDilutionYoY < 0 ? 'Share Buybacks' : 'Stock Dilution'})` : 'N/A'
    },
    systemGeneratedMoatsAndRisks: {
      catalysts: stock.catalysts || [],
      risks: stock.risks || []
    },
    userInvestmentThesis: thesis ? {
      conviction: thesis.conviction,
      targetBuyPrice: thesis.target_buy_price ? `$${thesis.target_buy_price}` : null,
      coreRationale: thesis.core_rationale,
      sellGuardrails: thesis.sell_triggers_json ? JSON.parse(thesis.sell_triggers_json) : []
    } : null
  };

  return payloadData;
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

Analyze the comprehensive fundamental data, quantitative KPIs, computed metrics, 12-point checklist, and 5-year trends for:
Company: ${stock.name} (${stock.ticker})
Sector / Industry: ${stock.sector} · ${stock.industry}

Here is the complete quantitative data package:
${JSON.stringify(payloadData, null, 2)}

Provide a deeply insightful, rigorous, and plain-English analysis tailored for disciplined long-term value investors.
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
    "explanation": "string: Detailed explanation evaluating ROIC (${stock.roic_pct}%), gross/operating margin stability, pricing power against inflation, customer lock-in, and competitive durability."
  },
  "solvencyAndSafety": {
    "rating": "string: 'FORTRESS' | 'SOLID' | 'MODERATE' | 'DISTRESSED'",
    "ratingLabel": "string: e.g. 'Fortress Balance Sheet (Zero Solvency Risk)'",
    "explanation": "string: Plain-English explanation evaluating the Altman Z-score (${stock.altman_z}), Piotroski F-score (${stock.piotroski_score}/9), cash cushion vs total debt (${stock.net_cash_b}B net position), current ratio, and recession resilience."
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
