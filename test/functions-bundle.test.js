/**
 * The Cloud Function's deployable bundle must match `functions/src/`.
 *
 * `firebase deploy --only functions` uploads `functions/` and nothing else —
 * it cannot see `functions/src/analyze.js` importing
 * `../../server/gemini-client.js`. `functions/lib/index.js` is what actually
 * gets deployed, and a stale one is silent: the deploy succeeds, the function
 * runs, and it runs whatever code was last bundled rather than whatever is in
 * `functions/src/` right now.
 *
 * Regenerate with: npm run bundle:functions
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('the committed functions bundle is current', () => {
  try {
    execFileSync('node', ['tools/bundle-functions.mjs', '--check'], {
      stdio: 'pipe',
      encoding: 'utf8'
    });
  } catch (err) {
    assert.fail(
      `${err.stderr || err.stdout || err.message}`.trim() ||
      'functions bundle check failed'
    );
  }
});
