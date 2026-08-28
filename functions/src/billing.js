/**
 * Pocket Omaha — turning a Play purchase into credits.
 *
 * One callable, `redeemPurchase`, called after `BillingClient` reports a
 * successful purchase — for the paid 10-pack and for the free 5-credit grant
 * alike, since both are Play products now (docs/13_ANDROID_ARCHITECTURE.md
 * §7) and both go through the identical verify-then-credit path. The only
 * thing that differs between them is which row of `products.js` the product
 * ID resolves to.
 *
 * Nothing here trusts the client's word for what was purchased. The purchase
 * token is opaque to the client; only the Play Developer API, called
 * server-side, says whether it is real.
 */

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';

import { productFor } from './products.js';
import { evaluatePurchase } from './play-verify.js';

/**
 * The app's own package name, i.e. the applicationId in
 * android/app/build.gradle.kts. Verified against this on every call — a
 * purchase token is only meaningful together with the package and product it
 * was issued for, and accepting one without checking the package would let a
 * token from a different app (or a different build variant) through.
 */
const PACKAGE_NAME = 'com.zandaulion.omaha';

let cachedClient = null;

/**
 * The Play Developer API client, authenticated as the Cloud Function's own
 * runtime service account.
 *
 * No key file, deliberately. The alternative — a downloaded service-account
 * JSON stored as a secret — is a long-lived credential that has to be
 * rotated and can leak; Application Default Credentials means there is
 * nothing to leak, because the function's identity *is* the credential.
 * Setup is one step in Play Console instead: grant this service account
 * "View app information" and "Manage orders and subscriptions" under
 * Setup → API access. See the deployment doc for exact steps, since Play
 * Console's wording for that page has moved before and may again.
 */
async function androidPublisher() {
  if (cachedClient) return cachedClient;
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  });
  cachedClient = google.androidpublisher({ version: 'v3', auth });
  return cachedClient;
}

export const redeemPurchase = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign in to redeem a purchase');

  const productId = String(request.data?.productId || '');
  const purchaseToken = String(request.data?.purchaseToken || '');
  if (!productId || !purchaseToken) {
    throw new HttpsError('invalid-argument', 'productId and purchaseToken are required');
  }

  const product = productFor(productId);
  if (!product) throw new HttpsError('invalid-argument', `unknown product: ${productId}`);

  const publisher = await androidPublisher();
  const response = await publisher.purchases.products.get({
    packageName: PACKAGE_NAME,
    productId,
    token: purchaseToken
  });

  const evaluated = evaluatePurchase(response.data);
  if (!evaluated.valid) {
    throw new HttpsError('failed-precondition', `purchase not creditable: ${evaluated.reason}`);
  }

  const db = getFirestore();
  const redemptionRef = db.doc(`redeemedPurchases/${evaluated.orderId}`);
  const balanceRef = db.doc(`users/${uid}`);

  // Idempotent by orderId, not an error on repeat. A client retrying after a
  // dropped response is the ordinary case here, not an attack — Play itself
  // is the source of truth for whether a *purchase* happened, and this only
  // guards against *crediting* the same order twice.
  //
  // Both reads happen before either write: a Firestore transaction refuses a
  // read issued after a write in the same transaction, so the reported
  // balance is computed from what was already read, not re-fetched.
  const newBalance = await db.runTransaction(async (tx) => {
    const [redemption, balance] = await Promise.all([tx.get(redemptionRef), tx.get(balanceRef)]);
    const currentCredits = Number(balance.data()?.credits || 0);

    if (redemption.exists) return currentCredits;

    tx.set(redemptionRef, {
      uid,
      productId,
      credits: product.credits,
      redeemedAt: FieldValue.serverTimestamp()
    });
    tx.set(balanceRef, { credits: FieldValue.increment(product.credits) }, { merge: true });

    return currentCredits + product.credits;
  });

  if (evaluated.needsAcknowledgement) {
    // After crediting, not before. A crash between acknowledging and
    // crediting would leave Play thinking the purchase is settled while the
    // account never got its credits — the worse of the two possible orderings.
    await publisher.purchases.products.acknowledge({
      packageName: PACKAGE_NAME,
      productId,
      token: purchaseToken,
      requestBody: {}
    });
  }

  return { credits: newBalance, productLabel: product.label };
});
