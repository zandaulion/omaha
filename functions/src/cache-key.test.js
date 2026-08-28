import { test } from 'node:test';
import assert from 'node:assert';

import { cacheLocationFor } from './cache-key.js';

test('a plain analysis lives in the shared cache, uppercased, no uid needed', () => {
  const loc = cacheLocationFor({ ticker: 'nok', includedNotes: false });
  assert.deepStrictEqual(loc, { scope: 'shared', path: 'aiCache/NOK' });
});

test('the shared cache ignores whatever uid is passed — it must not vary by caller', () => {
  const withUid = cacheLocationFor({ ticker: 'AAPL', includedNotes: false }, 'someone');
  assert.strictEqual(withUid.scope, 'shared');
  assert.strictEqual(withUid.path, 'aiCache/AAPL');
});

test('a notes-included analysis is private to the account that generated it', () => {
  const loc = cacheLocationFor({ ticker: 'JPM', includedNotes: true }, 'uid_123');
  assert.deepStrictEqual(loc, { scope: 'private', path: 'users/uid_123/aiCache/JPM' });
});

test('a notes-included lookup with no uid is refused rather than guessed at', () => {
  // The scenario this exists to catch: something upstream forgot to require
  // auth before asking for a private-scoped read.
  const loc = cacheLocationFor({ ticker: 'JPM', includedNotes: true }, null);
  assert.strictEqual(loc.scope, 'unreachable');
});

test('an empty ticker is refused rather than producing a malformed path', () => {
  assert.strictEqual(cacheLocationFor({ ticker: '', includedNotes: false }).scope, 'unreachable');
  assert.strictEqual(cacheLocationFor({ ticker: undefined, includedNotes: false }).scope, 'unreachable');
});
