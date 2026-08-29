/**
 * Pocket Omaha — reading a credit balance.
 *
 * Found missing while building the Android client, 2026-08-29: every other
 * callable *changes* the balance and returns the result — `redeemPurchase`,
 * `claimFreeGrant`, and now `generateAiSummary` — but nothing let the client
 * simply ask "how many do I have," which the UI needs on screen load and
 * after sign-in, not only right after a mutation.
 *
 * `firestore.rules` denies all client reads (docs/17_AI_RELAY_DEPLOYMENT.md
 * §5), so a direct Firestore listener was never an option — this callable is
 * the only path.
 */

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

export const getBalance = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign in to check your balance');

  const snap = await getFirestore().doc(`users/${uid}`).get();
  return { credits: Number(snap.data()?.credits || 0) };
});
