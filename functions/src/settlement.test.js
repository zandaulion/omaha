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

// No real product is non-consumable any more — the free grant that used to
// be moved out of PRODUCTS entirely, 2026-08-29 (see products.js). settlementFor
// stays generic on purpose, in case a future product is ever non-consumable,
// so these cases are exercised against a plain shape rather than a live
// product ID.
const nonConsumable = { consumable: false };

test('a non-consumable acknowledges only when Play says it still needs it', () => {
  assert.strictEqual(
    settlementFor(nonConsumable, { needsAcknowledgement: true }),
    'acknowledge'
  );
  assert.strictEqual(
    settlementFor(nonConsumable, { needsAcknowledgement: false }),
    'none'
  );
});

test('a non-consumable is never consumed', () => {
  // The other half of the same bug, in the other direction: consuming a
  // non-consumable would make it repurchasable, which is the exact failure
  // the non-consumable type existed to prevent before Play removed it as a
  // product setting.
  for (const needsAcknowledgement of [true, false]) {
    assert.notStrictEqual(
      settlementFor(nonConsumable, { needsAcknowledgement }),
      'consume'
    );
  }
});
