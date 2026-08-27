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

/**
 * The names the Android hosts call must actually be exported.
 *
 * `JsBridge.call(fn, ...)` looks the function up by string at run time, so a
 * rename in `core/` and a stale spelling in Kotlin do not fail to compile,
 * fail a type check, or fail here — they throw `JsBridgeException` on a
 * handset, in a background sweep, where nobody sees it. This is the cheapest
 * place to catch that, and it is the only one that runs on every commit.
 *
 * Kept as a literal list rather than derived from the Kotlin, deliberately: the
 * point is to pin the contract from the side that defines it. If a name here
 * changes, both sides have to be visited.
 */
test('every function the Android hosts call by name is exported', async () => {
  const surface = {
    'core/host/stock.js': ['stock', 'search'],
    'core/host/alerts.js': [
      'sweepTicker', 'defaults', 'spacingMs', 'intervalMs', 'digestSlot',
      'digest', 'cooledDown'
    ],
    'core/scoring.js': ['computeComprehensiveHealth'],
    'core/analysis/dcf.js': ['projectDcf', 'dcfBaselines', 'clampAssumptions']
  };

  for (const [module, names] of Object.entries(surface)) {
    const exported = await import(`../${module}`);
    for (const name of names) {
      assert.equal(
        typeof exported[name],
        'function',
        `${module} no longer exports ${name}(), which a Kotlin engine calls by that string`
      );
    }
  }
});
