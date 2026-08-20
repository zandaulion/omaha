/**
 * The generated bundle must match the sources it was generated from.
 *
 * `core/dist/` is committed because the Android build consumes it without
 * running Node, which keeps the two toolchains independent. The cost of that
 * is a file that can go stale, and a stale bundle is the worst kind of drift:
 * the PWA and the app would run genuinely different code while every other
 * test passed.
 *
 * Regenerate with: npm run bundle:core
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('the committed bundles are current', () => {
  try {
    execFileSync('node', ['tools/bundle-core.mjs', '--check'], {
      stdio: 'pipe',
      encoding: 'utf8'
    });
  } catch (err) {
    assert.fail(
      `${err.stderr || err.stdout || err.message}`.trim() ||
      'bundle check failed'
    );
  }
});
