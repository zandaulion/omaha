import { test } from 'node:test';
import assert from 'node:assert';

import { settlementFor } from './settlement.js';
import { PRODUCTS } from './products.js';

test('a consumable is always consumed, never acknowledged', () => {
  // The bug this whole file exists to prevent: omaha_credits_10 stuck as a
  // one-time purchase because the relay only ever called acknowledge.
  assert.strictEqual(
    settlementFor(PRODUCTS.omaha_credits_10, { needsAcknowledgement: true }),
    'consume'
  );
  // Consume even when Play reports it's already acknowledged — consume is
  // what frees the purchase for a repurchase, which acknowledgement alone
  // never does.
  assert.strictEqual(
    settlementFor(PRODUCTS.omaha_credits_10, { needsAcknowledgement: false }),
    'consume'
  );
});

test('a non-consumable acknowledges only when Play says it still needs it', () => {
  assert.strictEqual(
    settlementFor(PRODUCTS.omaha_credits_free_5, { needsAcknowledgement: true }),
    'acknowledge'
  );
  assert.strictEqual(
    settlementFor(PRODUCTS.omaha_credits_free_5, { needsAcknowledgement: false }),
    'none'
  );
});

test('a non-consumable is never consumed', () => {
  // The other half of the same bug, in the other direction: consuming
  // omaha_credits_free_5 would make the free grant repurchasable, which is
  // the exact failure the non-consumable type existed to prevent before
  // Play removed it as a product setting.
  for (const needsAcknowledgement of [true, false]) {
    assert.notStrictEqual(
      settlementFor(PRODUCTS.omaha_credits_free_5, { needsAcknowledgement }),
      'consume'
    );
  }
});
