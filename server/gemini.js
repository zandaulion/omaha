import { db } from './db.js';

/**
 * Pocket Omaha — Gemini analysis, cached for the PWA.
 *
 * The actual Gemini call lives in `gemini-client.js`, with no storage
 * attached — this file adds only what is specific to the PWA host: a single
 * shared SQLite row per ticker, since the PWA serves one household from one
 * process. `functions/src/analyze.js` (the Cloud Function relay) imports
 * `callGemini` from `gemini-client.js` directly rather than from here, so
 * that importing it never pulls in a local database file a Cloud Function
 * has no use for.
 */

import { callGemini, getGeminiApiKey, getGeminiModel } from './gemini-client.js';

// Re-exported so every existing import site — the route, the prompt-dumping
// script, the cost-measurement script — keeps working unchanged.
export { getGeminiApiKey, getGeminiModel };
export {
  buildComprehensivePayload,
  buildPrompt,
  RESPONSE_SCHEMA
} from './gemini-client.js';

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
 * Generate in-depth Gemini analysis for the PWA, and cache it in SQLite.
 *
 * Thin on purpose: `callGemini` does the actual work. This adds only what is
 * specific to the PWA host.
 */
export async function generateStockAISummary(stock, thesis = null) {
  const result = await callGemini(stock, thesis);
  saveCachedAISummary(stock.ticker, result);
  return result;
}
