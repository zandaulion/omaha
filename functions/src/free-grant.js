/**
 * Pocket Omaha — the 5-credit first-launch grant.
 *
 * **Found live, 2026-08-29.** The original design
 * (docs/13_ANDROID_ARCHITECTURE.md §7) made this a non-consumable Play
 * product priced at $0.00, so Play's own "no second purchase of a
 * non-consumable already owned by an account" rule enforced "once per
 * account" for free, with no code here to do it. Play Console's current
 * one-time-products system refuses a $0.00 price outright — every region
 * carries a nonzero floor (USD 0.05, DZD 7.90, and so on). That assumption is
 * gone, so this callable replaces it: the same "once per account" guarantee,
 * enforced by a Firestore transaction instead of by Play.
 *
 * This is *not* the same trust model `billing.js` has. A purchase is verified
 * against the Play Developer API — an authority outside this project's own
 * database. A grant has no external authority to check against; its only
 * defence against being claimed twice is this function's own transaction
 * being atomic, and its only defence against being claimed by the same person
 * repeatedly is that claiming it at all requires a signed-in Google account.
 * That is the same ceiling doc 13 §7 already named and accepted for the
 * Play-product version — "a new Google account is a new grant" — carried
 * over unchanged, not a new weakness introduced by this fix.
 *
 * Keying the claim to `request.auth.uid` specifically depends on auth having
 * already moved off anonymous sign-in (docs/13_ANDROID_ARCHITECTURE.md §7,
 * 2026-08-28, a day *before* this fix) — an anonymous UID is fresh on every
 * install, so keying this transaction to one would have reintroduced the
 * exact reinstall-resets-the-grant defect the Play-product design was built
 * to close. It is the Google-Sign-In switch that makes a server-side counter
 * safe here, not this file.
 */

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import { FREE_GRANT } from './products.js';

export const claimFreeGrant = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign in to claim the free grant');

  const db = getFirestore();
  const balanceRef = db.doc(`users/${uid}`);

  // One read-then-write, atomic. Two rapid claims from the same account —
  // a double-tap, a retried call after a dropped response — must not grant
  // twice; a Firestore transaction retries itself on a conflicting write
  // instead of both succeeding, which is the property this depends on.
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
        credits: FieldValue.increment(FREE_GRANT.credits),
        freeGrantClaimedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return { newBalance: currentCredits + FREE_GRANT.credits, granted: true };
  });

  return { credits: newBalance, granted, productLabel: FREE_GRANT.label };
});
