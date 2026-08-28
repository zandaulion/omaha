/**
 * Pocket Omaha — what a Play product ID is worth in credits.
 *
 * Pure and dependency-free on purpose: this is the map a purchase gets
 * checked against before anything is credited, and it is worth being able to
 * unit-test without a Firestore emulator or a Play Developer API mock. Get
 * this map wrong and the failure is either "a real purchase issues zero
 * credits" or "an unrecognised product ID issues some" — both are worth a
 * test that runs in plain Node, not only in an integration suite nobody runs
 * locally.
 *
 * Product IDs are placeholders until Play Console assigns real ones; keep
 * this file and the Play Console configuration in step; a mismatch here is
 * silent until someone actually buys the pack.
 */

/**
 * @type {Record<string, {credits: number, consumable: boolean, label: string}>}
 *
 * `consumable` matters as much as `credits`. The 10-pack must be consumable
 * — Play Billing itself, not this map, is what lets it be bought again after
 * the last purchase is consumed. The free grant must be the opposite: a
 * non-consumable priced at $0.00, so Play refuses a second purchase from the
 * same account outright. See docs/13_ANDROID_ARCHITECTURE.md §7 for why —
 * getting this one bit wrong on either product turns "5 free credits, once"
 * into free credits with no limit.
 */
export const PRODUCTS = {
  omaha_credits_10: { credits: 10, consumable: true, label: '10 analysis credits' },
  omaha_credits_free_5: { credits: 5, consumable: false, label: '5 free analysis credits' }
};

/**
 * @param {string} productId
 * @returns {{credits: number, consumable: boolean, label: string} | null}
 */
export function productFor(productId) {
  return PRODUCTS[productId] ?? null;
}
