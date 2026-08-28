/**
 * Pocket Omaha — the two callable entry points for AI analysis.
 *
 * `getAiSummary` needs no identity at all — reading a cache hit is
 * unauthenticated by design, decided 2026-08-28 (docs/13_ANDROID_ARCHITECTURE.md
 * §7): most people may never spend a credit, because a popular ticker is
 * likely already cached from someone else's. `generateAiSummary` is the one
 * path that spends money and therefore the one path that requires
 * Google-Sign-In-backed Firebase Auth.
 *
 * Both are thin. `callGemini` — the actual prompt-building and Gemini call —
 * is the same function `server/gemini.js`'s PWA path calls, from
 * `server/gemini-client.js`; nothing here is a
 * second implementation of what the model is asked or told.
 */

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import { callGemini } from '../../server/gemini-client.js';
import { cacheLocationFor } from './cache-key.js';

/**
 * `{ticker: string}` in, `{summary: object|null}` out. No auth required.
 */
export const getAiSummary = onCall(async (request) => {
  const ticker = String(request.data?.ticker || '').trim();
  if (!ticker) throw new HttpsError('invalid-argument', 'ticker is required');

  const location = cacheLocationFor({ ticker, includedNotes: false });
  if (location.scope !== 'shared') {
    // Cannot actually happen for includedNotes: false, but a defensive check
    // costs nothing and turns a future refactor's mistake into a clear error
    // rather than a Firestore path built from garbage.
    throw new HttpsError('internal', 'could not resolve a cache location');
  }

  const doc = await getFirestore().doc(location.path).get();
  return { summary: doc.exists ? doc.data() : null };
});

/**
 * `{ticker: string, stock: object, thesis: object|null}` in, the generated
 * summary out. Requires an authenticated (Google Sign-In) caller and spends
 * one credit — refunded if the Gemini call itself fails, since the credit is
 * for a successful analysis, not for an attempt.
 *
 * `secrets: ['GEMINI_API_KEY']` is not decoration. A function does not get a
 * secret injected into `process.env` just because it exists in Secret
 * Manager — only a function that names it here does. Without this,
 * `callGemini` would read an empty string and fail every call with "Gemini
 * API key not configured," despite `firebase functions:secrets:set` having
 * succeeded. `getAiSummary` and `redeemPurchase` deliberately do not declare
 * it: neither calls Gemini, and a secret only reaches the functions that ask
 * for it.
 */
export const generateAiSummary = onCall({ secrets: ['GEMINI_API_KEY'] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign in to generate an analysis');

  const ticker = String(request.data?.ticker || '').trim();
  const stock = request.data?.stock;
  const thesis = request.data?.thesis ?? null;

  if (!ticker || !stock || typeof stock !== 'object') {
    throw new HttpsError('invalid-argument', 'ticker and stock are required');
  }

  const db = getFirestore();
  const balanceRef = db.doc(`users/${uid}`);

  // Decrement first, refund on failure — not the other way round. Crediting
  // after a successful call would let two concurrent requests both pass a
  // "do I have credits" check before either spends one; a transactional
  // decrement up front is what makes the balance a real limit rather than an
  // advisory one.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(balanceRef);
    const credits = snap.exists ? Number(snap.data().credits || 0) : 0;
    if (credits < 1) {
      throw new HttpsError('resource-exhausted', 'no credits remaining');
    }
    tx.set(balanceRef, { credits: credits - 1 }, { merge: true });
  });

  let result;
  try {
    result = await callGemini(stock, thesis);
  } catch (err) {
    // The credit bought a successful analysis, not an attempt at one.
    // FieldValue.increment is atomic on its own — an unconditional +1 needs
    // no read-check-write transaction, unlike the decrement above, which had
    // to look at the balance before deciding whether to allow it at all.
    await balanceRef.set({ credits: FieldValue.increment(1) }, { merge: true });
    throw new HttpsError('internal', err.message || 'Gemini call failed');
  }

  const location = cacheLocationFor(
    { ticker, includedNotes: result.includedNotes },
    uid
  );
  if (location.scope !== 'unreachable') {
    await db.doc(location.path).set(result);
  }

  return { summary: result };
});
