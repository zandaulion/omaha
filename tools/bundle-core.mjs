/**
 * Bundle `core/` into single-file ES modules for the QuickJS hosts.
 *
 * Doc 13 §4 originally claimed the import statements in `core/` needed no
 * bundler, because `quickjs-kt` supports ES modules. That turned out to be
 * wrong in a way only a device could reveal: registering a second module on
 * one QuickJS instance crashes the process outright — an access violation in
 * native code, not a catchable error. Until that is fixed upstream there is
 * exactly one module per interpreter, so the graph has to arrive pre-flattened.
 *
 * This is a build step, not a second source of truth. The bundle is generated
 * from `core/` on every Android build and is never edited; `bundle.test.js`
 * fails if a committed bundle has drifted from the sources it was made from.
 *
 *   node tools/bundle-core.mjs [--check]
 *
 * `--check` verifies the existing output is current without rewriting it,
 * which is what CI wants.
 */

import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, 'core', 'dist');

/**
 * Entry points the Android host loads.
 *
 * Only `scoring.js` for now: it is what the parity gate exercises and what the
 * spike proved. `stock.js` follows once the fetch and storage bridges exist,
 * and will bundle the same way.
 */
export const ENTRIES = [{ entry: 'core/scoring.js', out: 'scoring.bundle.js' }];

/** Build one entry and return its contents, without writing. */
async function render(entry) {
  const result = await build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    format: 'esm',
    // No browser or node shims: this runs in a bare interpreter with only
    // what the host injects, and a polyfill sneaking in would be a silent
    // behavioural difference between the two clients.
    platform: 'neutral',
    write: false,
    // Readability over size. The bundle is 45 KB, the app is not
    // download-constrained by it, and a stack trace from a device is worth
    // more than the bytes.
    minify: false,
    legalComments: 'inline',
    logLevel: 'warning'
  });
  return result.outputFiles[0].text;
}

const check = process.argv.includes('--check');
fs.mkdirSync(OUT_DIR, { recursive: true });

let stale = [];
for (const { entry, out } of ENTRIES) {
  const text = await render(entry);
  const target = path.join(OUT_DIR, out);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

  if (check) {
    if (existing !== text) stale.push(out);
    continue;
  }

  if (existing !== text) {
    fs.writeFileSync(target, text);
    console.log(`${out}: written, ${Math.round(text.length / 1024)} KB`);
  } else {
    console.log(`${out}: unchanged, ${Math.round(text.length / 1024)} KB`);
  }
}

if (check && stale.length) {
  console.error(
    `Stale bundles: ${stale.join(', ')}. Run \`npm run bundle:core\` and commit the result.`
  );
  process.exit(1);
}
