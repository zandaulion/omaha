import { test } from 'node:test';
import assert from 'node:assert';

import { PRODUCTS, productFor, FREE_GRANT } from './products.js';

test('the paid pack is consumable', () => {
  // Play Billing itself is what lets a consumable be bought again after the
  // last purchase is consumed; getting this backwards makes it a one-time
  // purchase for life. There is only one real Play product now — the free
  // grant moved to FREE_GRANT, 2026-08-29, since it never carried a
  // `consumable` flag Play acted on in the first place any more.
  assert.strictEqual(PRODUCTS.omaha_credits_10.consumable, true);
});

test('the amounts match the decided pricing', () => {
  assert.strictEqual(PRODUCTS.omaha_credits_10.credits, 10);
  assert.strictEqual(FREE_GRANT.credits, 5);
});

test('the free grant is not a Play product', () => {
  // The whole reason it moved out of PRODUCTS: a product ID here would imply
  // Play verifies it, and Play is no longer involved in this guarantee at all.
  assert.strictEqual(productFor('omaha_credits_free_5'), null);
  assert.strictEqual('omaha_credits_free_5' in PRODUCTS, false);
});

test('an unrecognised product id resolves to nothing, not a guess', () => {
  assert.strictEqual(productFor('not_a_real_product'), null);
  assert.strictEqual(productFor(''), null);
  assert.strictEqual(productFor(undefined), null);
});

test('productFor returns the same object the map holds', () => {
  assert.strictEqual(productFor('omaha_credits_10'), PRODUCTS.omaha_credits_10);
});
