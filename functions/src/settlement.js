/**
 * Pocket Omaha — which Play Developer API call settles a purchase.
 *
 * Found live, 2026-08-29: Play Console's one-time-products model has no
 * "consumable" product type any more. There is nothing in Play Console that
 * makes `omaha_credits_10` repurchasable and `omaha_credits_free_5` a
 * one-time grant — that entire guarantee is now made by which of these two
 * calls the relay makes, and nothing else. `consume` frees a purchase for a
 * repurchase and implicitly acknowledges it; `acknowledge` alone leaves it
 * permanently owned. Get `products.js`'s `consumable` flag right and call the
 * wrong function here anyway, and the guarantee is still broken — this is the
 * function that turns that flag into the actual outcome, so it is worth
 * testing on its own rather than trusting the inline branch it replaced.
 *
 * @see functions/src/billing.js, which is what actually calls the API.
 */

/**
 * @param {{consumable: boolean}} product from `products.js`
 * @param {{needsAcknowledgement: boolean}} evaluated from `play-verify.js`'s
 *   `evaluatePurchase`
 * @returns {'consume'|'acknowledge'|'none'}
 *
 * A consumable is always `consume` — never `acknowledge` alongside it, since
 * `consume` already satisfies the acknowledgement requirement and a second
 * call is a redundant one against an already-settled purchase. A
 * non-consumable acknowledges only when Play says it still needs it; calling
 * `acknowledge` on an already-acknowledged purchase is the same class of
 * redundant call this function exists to avoid.
 */
export function settlementFor(product, evaluated) {
  if (product.consumable) return 'consume';
  return evaluated.needsAcknowledgement ? 'acknowledge' : 'none';
}
