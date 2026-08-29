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
 * **Only real Play products belong in this map.** The free grant used to —
 * see `FREE_GRANT` below for why it was moved out, 2026-08-29.
 */

/**
 * @type {Record<string, {credits: number, consumable: boolean, label: string}>}
 *
 * `consumable` is what lets `omaha_credits_10` be bought again after the last
 * purchase is consumed — Play Billing itself does the enforcing, this map
 * only states the fact `settlement.js` acts on. Getting it backwards turns a
 * repurchasable pack into a one-time purchase for life.
 */
export const PRODUCTS = {
  omaha_credits_10: { credits: 10, consumable: true, label: '10 analysis credits' }
};

/**
 * @param {string} productId
 * @returns {{credits: number, consumable: boolean, label: string} | null}
 */
export function productFor(productId) {
  return PRODUCTS[productId] ?? null;
}

/**
 * The first-launch grant. Not a Play product — see `free-grant.js`.
 *
 * **Found live, 2026-08-29.** The original design (docs/13_ANDROID_ARCHITECTURE.md
 * §7) made this a non-consumable Play product priced at $0.00, so Play's own
 * "no second purchase of a non-consumable" rule would enforce "once per
 * account" for free. Play Console's current one-time-products system refuses
 * that outright — every region has a nonzero price floor (USD 0.05, DZD 7.90,
 * and so on; confirmed against a real console, not documentation, since
 * neither Play help page for the new system states the floor explicitly).
 * There is no product ID here any more for the same reason there is no
 * `consumable` flag: Play is no longer involved in this guarantee at all. See
 * `free-grant.js`'s header for what replaced it.
 *
 * @type {{credits: number, label: string}}
 */
export const FREE_GRANT = { credits: 5, label: '5 free analysis credits' };
