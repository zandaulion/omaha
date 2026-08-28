import { test } from 'node:test';
import assert from 'node:assert';

import { evaluatePurchase } from './play-verify.js';

const purchased = (overrides = {}) => ({
  purchaseState: 0,
  acknowledgementState: 0,
  orderId: 'GPA.1234-5678-9012-34567',
  purchaseTimeMillis: '1735689600000',
  ...overrides
});

test('a purchased, unacknowledged order is valid and needs acknowledging', () => {
  const result = evaluatePurchase(purchased());
  assert.deepStrictEqual(result, {
    valid: true,
    orderId: 'GPA.1234-5678-9012-34567',
    needsAcknowledgement: true
  });
});

test('an already-acknowledged order is valid and does not need it again', () => {
  const result = evaluatePurchase(purchased({ acknowledgementState: 1 }));
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.needsAcknowledgement, false);
});

test('a canceled purchase is rejected, not silently credited', () => {
  // purchaseState 1 = CANCELED. A user who paid, canceled and hoped the
  // credit had already landed must not get one from this path.
  const result = evaluatePurchase(purchased({ purchaseState: 1 }));
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /purchaseState 1/);
});

test('a pending purchase is rejected — the transaction has not settled', () => {
  const result = evaluatePurchase(purchased({ purchaseState: 2 }));
  assert.strictEqual(result.valid, false);
});

test('a response missing orderId is rejected rather than trusted', () => {
  const result = evaluatePurchase(purchased({ orderId: undefined }));
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /orderId/);
});

test('an empty or malformed response is rejected, not thrown on', () => {
  // The relay's caller should get a typed refusal, not an uncaught
  // TypeError from reading a property off null.
  assert.strictEqual(evaluatePurchase(null).valid, false);
  assert.strictEqual(evaluatePurchase(undefined).valid, false);
  assert.strictEqual(evaluatePurchase({}).valid, false);
});
