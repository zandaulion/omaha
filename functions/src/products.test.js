import { test } from 'node:test';
import assert from 'node:assert';

import { PRODUCTS, productFor } from './products.js';

test('the paid pack is consumable, the free grant is not', () => {
  // The one bit that carries the whole "once per account" guarantee. Getting
  // it backwards on the free grant makes it unlimited; getting it backwards
  // on the paid pack makes it a one-time purchase for life.
  assert.strictEqual(PRODUCTS.omaha_credits_10.consumable, true);
  assert.strictEqual(PRODUCTS.omaha_credits_free_5.consumable, false);
});

test('the amounts match the decided pricing', () => {
  assert.strictEqual(PRODUCTS.omaha_credits_10.credits, 10);
  assert.strictEqual(PRODUCTS.omaha_credits_free_5.credits, 5);
});

test('an unrecognised product id resolves to nothing, not a guess', () => {
  assert.strictEqual(productFor('not_a_real_product'), null);
  assert.strictEqual(productFor(''), null);
  assert.strictEqual(productFor(undefined), null);
});

test('productFor returns the same object the map holds', () => {
  assert.strictEqual(productFor('omaha_credits_10'), PRODUCTS.omaha_credits_10);
});
