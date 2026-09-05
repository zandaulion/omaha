import dotenv from 'dotenv';

dotenv.config();

/**
 * Pocket Omaha — the Gemini call itself, with no storage attached.
 *
 * Split out of `gemini.js` so it can be imported without pulling in SQLite.
 * `functions/src/analyze.js` (the Cloud Function relay) imports `callGemini`
 * directly from here — a Cloud Function has no business opening a local
 * `omaha.db` file it will never use, and importing `gemini.js` used to mean
 * doing exactly that, since `import { db } from './db.js'` runs at module
 * load regardless of which export is actually used.
 *
 * `gemini.js` still exists and still does the PWA's own caching; it imports
 * `callGemini` from here rather than duplicating it.
 */

const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

export function getGeminiApiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

export function getGeminiModel() {
  return (process.env.GEMINI_MODEL || 'gemini-3.7-flash').trim();
}

import {
  buildComprehensivePayload,
  buildPrompt,
  RESPONSE_SCHEMA,
  PROMPT_VERSION
} from '../core/analysis/prompt.js';

// Re-exported so the prompt-dumping script and the PWA route keep one import
// site regardless of which of the two gemini files they actually need.
export { buildComprehensivePayload, buildPrompt, RESPONSE_SCHEMA };

/**
 * Call Gemini and return the parsed, shaped result. No caching, no storage.
 *
 * The PWA's own caching (SQLite, one shared row per ticker — see `gemini.js`)
 * and the relay's (Firestore, split between a shared cache and a per-account
 * private one — see `functions/src/cache-key.js`) are genuinely different:
 * one process serving one household, one function serving every installed
 * phone. That difference is real, so it stays outside this function rather
 * than being papered over by a shared cache abstraction neither host
 * actually wants.
 */
export async function callGemini(stock, thesis = null) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please provide a valid Gemini API key.');
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

  return {
    ticker: stock.ticker,
    name: stock.name,
    model,
    generatedAt: new Date().toISOString(),
    // Ties the analysis to the filing period it was written against, so a
    // cached summary can be spotted as stale once new fundamentals land.
    fiscalPeriodEnd: stock.summary?.metrics?.fiscalPeriodEnd || null,
    priceAtGeneration: stock.price ?? null,
    // What the model was told, as a number. The filings can be unchanged and
    // the price flat while the app has learned to say something it could not
    // say before; without this, such an analysis is served as current forever.
    promptVersion: PROMPT_VERSION,
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
    currency: stock.currency || 'USD',
    ...parsed
  };
}
