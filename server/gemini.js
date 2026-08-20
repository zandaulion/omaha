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

import {
  buildComprehensivePayload,
  buildPrompt,
  RESPONSE_SCHEMA
} from '../core/analysis/prompt.js';

// Re-exported so the prompt-dumping script and the route keep one import site.
export { buildComprehensivePayload, buildPrompt, RESPONSE_SCHEMA };

/**
 * Generate in-depth Gemini analysis
 */
export async function generateStockAISummary(stock, thesis = null) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server. Please provide a valid Gemini API key.');
  }

  const model = getGeminiModel();

  const promptText = buildPrompt(stock, thesis);

  const requestBody = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      responseMimeType: 'application/json',
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
    try {
      // Belt and braces: the schema should prevent a code fence, but a
      // truncated or wrapped body should still fail with a usable message
      // rather than a bare SyntaxError.
      parsed = JSON.parse(rawText.replace(/```json\s*|\s*```/g, '').trim());
    } catch {
      throw new Error(
        'Gemini returned a response that could not be parsed as JSON. Try again.'
      );
    }
  }

  const result = {
    ticker: stock.ticker,
    name: stock.name,
    model,
    generatedAt: new Date().toISOString(),
    // Ties the analysis to the filing period it was written against, so a
    // cached summary can be spotted as stale once new fundamentals land.
    fiscalPeriodEnd: stock.summary?.metrics?.fiscalPeriodEnd || null,
    priceAtGeneration: stock.price ?? null,
    currency: stock.currency || 'USD',
    ...parsed
  };

  saveCachedAISummary(stock.ticker, result);
  return result;
}
