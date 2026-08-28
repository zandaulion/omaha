/**
 * Pocket Omaha — interpreting a Play Developer API purchase response.
 *
 * The network call itself (`androidpublisher.purchases.products.get`) is
 * injected rather than made here, so the part worth testing — what counts as
 * a valid, creditable, not-already-redeemed purchase — can be tested against
 * a fake response instead of a live Play Console. `functions/src/billing.js`
 * is what actually calls the Play Developer API; this file only interprets
 * what comes back.
 *
 * @see https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products
 */

/** Play's own enum. 0 means the purchase actually happened. */
const PURCHASE_STATE_PURCHASED = 0;

/** 0 = not yet acknowledged. Play voids and refunds an unacknowledged purchase after 3 days. */
const ACKNOWLEDGEMENT_STATE_NOT_ACKNOWLEDGED = 0;

/**
 * @param {object} purchase the `ProductPurchase` resource from
 *   `purchases.products.get`
 * @returns {{valid: true, orderId: string, needsAcknowledgement: boolean} |
 *   {valid: false, reason: string}}
 *
 * Deliberately does not check `consumptionState`. That field only applies to
 * consumables, and whether the *client* has consumed its side is a question
 * for the credit ledger (has this `orderId` been redeemed already), not for
 * Play — a consumable can be legitimately re-purchased after being consumed,
 * and `consumptionState` would then read "not consumed" again for the new
 * purchase. `orderId` is unique per transaction either way; that is the
 * dedup key, not consumption state.
 */
export function evaluatePurchase(purchase) {
  if (!purchase || typeof purchase !== 'object') {
    return { valid: false, reason: 'empty response from Play' };
  }

  if (purchase.purchaseState !== PURCHASE_STATE_PURCHASED) {
    return { valid: false, reason: `purchaseState ${purchase.purchaseState} is not PURCHASED` };
  }

  if (!purchase.orderId) {
    // Every real purchase carries one. Its absence means either a malformed
    // response or a purchase state Play does not consider final yet.
    return { valid: false, reason: 'purchase has no orderId' };
  }

  return {
    valid: true,
    orderId: purchase.orderId,
    needsAcknowledgement:
      purchase.acknowledgementState === ACKNOWLEDGEMENT_STATE_NOT_ACKNOWLEDGED
  };
}
