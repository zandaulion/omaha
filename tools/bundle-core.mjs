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
 * `scoring.js` is what the parity gate exercises. `backup.js` carries the merge
 * rules, which have to be the same on both clients or a restore loses notes on
 * one of them. `host/ingest.js` adds the fetch shim and the Yahoo parser, so an
 * embedded host can read filings rather than only score them. `host/stock.js`
 * is the whole pipeline — cache, fetch, assemble, score, persist — and needs
 * both a network and a store from its host.
 */
export const ENTRIES = [
  { entry: 'core/scoring.js', out: 'scoring.bundle.js' },
  { entry: 'core/backup.js', out: 'backup.bundle.js' },
  { entry: 'core/host/ingest.js', out: 'ingest.bundle.js' },
  { entry: 'core/host/stock.js', out: 'stock.bundle.js' },
  // `host/alerts.js` is the sweep. It builds on `host/stock.js`, so this bundle
  // is a superset of that one and needs the same host functions plus the alert
  // store — which is why it is a separate entry rather than a shared engine:
  // one module per interpreter is a hard constraint, not a preference.
  { entry: 'core/host/alerts.js', out: 'alerts.bundle.js' },
  // The DCF sandbox recomputes on every slider drag, so both clients run it
  // locally rather than asking a host. That makes it the one module the
  // *browser* also needs as a module, which is why it is emitted twice: once
  // here for QuickJS, and once into web/ by the same build (see WEB_ENTRIES).
  { entry: 'core/analysis/dcf.js', out: 'dcf.bundle.js' }
];

/**
 * Emitted into `web/` so the PWA client can import it directly.
 *
 * `web/app.js` cannot reach `core/` — only `web/` is served — so before this
 * the DCF arithmetic lived in `app.js` as the only copy. That was fine with one
 * client and becomes a drift generator with two. Shipping the module to the
 * browser keeps one definition rather than adding a third.
 */
export const WEB_ENTRIES = [
  { entry: 'core/analysis/dcf.js', out: 'dcf.js' }
];

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

async function emit(entry, target, label) {
  const text = await render(entry);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

  if (check) {
    if (existing !== text) stale.push(label);
    return;
  }

  if (existing !== text) {
    fs.writeFileSync(target, text);
    console.log(`${label}: written, ${Math.round(text.length / 1024)} KB`);
  } else {
    console.log(`${label}: unchanged, ${Math.round(text.length / 1024)} KB`);
  }
}

for (const { entry, out } of ENTRIES) {
  await emit(entry, path.join(OUT_DIR, out), out);
}

for (const { entry, out } of WEB_ENTRIES) {
  await emit(entry, path.join(ROOT, 'web', out), `web/${out}`);
}

if (check && stale.length) {
  console.error(
    `Stale bundles: ${stale.join(', ')}. Run \`npm run bundle:core\` and commit the result.`
  );
  process.exit(1);
}
