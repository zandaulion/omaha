/**
 * Scoring parity — the Node reference half.
 *
 * `core/scoring.js` is 1,422 lines and the single riskiest thing to run on a
 * second JavaScript engine. This test states the contract in the narrowest
 * possible terms: given exactly this input, the engine returns exactly this
 * output. No network, no database, no assembly — just the engine.
 *
 * The Android spike runs the identical assertion under QuickJS against the
 * identical files. Any difference between the two is engine divergence, not a
 * logic difference, because it is the same source file. That is what makes the
 * spike a measurement rather than an impression.
 *
 * Keep this test and its Android counterpart in step. If one of them grows an
 * allowance the other does not have, the gate stops meaning anything.
 *
 * Regenerate the fixtures without touching the network:
 *   node scripts/record-fixture.mjs --replay NOK AAPL JPM
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import { computeComprehensiveHealth } from '../core/scoring.js';
import { fixturePath, normaliseModel } from '../tools/fixture-http.js';

const TICKERS = ['NOK', 'AAPL', 'JPM'];

const read = (ticker, kind) =>
  JSON.parse(fs.readFileSync(fixturePath(ticker, kind), 'utf8'));

for (const ticker of TICKERS) {
  test(`${ticker}: the engine reproduces its recorded output exactly`, () => {
    const input = read(ticker, 'scoring-input');
    const expected = read(ticker, 'scoring-output');

    const actual = normaliseModel(computeComprehensiveHealth(input));

    assert.deepEqual(
      actual,
      expected,
      `${ticker} scoring output drifted. This is the fixture the Android ` +
      'spike compares against — if the change is intended, regenerate with ' +
      '--replay and review the diff.'
    );
  });
}

test('the fixtures cover materially different engine paths', () => {
  const [nok, aapl, jpm] = TICKERS.map((t) => read(t, 'scoring-output'));

  // If all three fixtures exercised the same branches, three of them would be
  // no better than one for the purpose of catching an engine difference.
  assert.equal(jpm.altmanZ ?? null, null, 'JPM is a lender: Altman Z inapplicable');
  assert.ok(typeof aapl.altmanZ === 'number', 'AAPL has a computable Altman Z');

  const scores = [nok, aapl, jpm].map((s) => s.compositeScore ?? s.healthScore ?? null);
  assert.equal(
    new Set(scores).size,
    3,
    `expected three distinct composite scores, saw ${JSON.stringify(scores)}`
  );
});
