/**
 * Bundle `functions/src/` into `functions/lib/index.js`, ready to deploy.
 *
 * `firebase deploy --only functions` uploads the `functions/` directory and
 * nothing else — it has no idea `functions/src/analyze.js` imports
 * `../../server/gemini-client.js`, which imports `../core/analysis/prompt.js`,
 * and a deploy of the unbundled source would fail the moment a cold-started
 * instance tried to resolve either path. This inlines every relative import
 * into one file, the same problem `tools/bundle-core.mjs` solves for the
 * QuickJS hosts, solved the same way.
 *
 * The one real difference from that bundler: `firebase-admin`,
 * `firebase-functions` and `googleapis` stay external. They are real npm
 * packages `functions/node_modules` provides at deploy time — genuinely huge,
 * and inlining them would produce a multi-megabyte file for no benefit. Only
 * this project's own relative imports get flattened.
 *
 *   node tools/bundle-functions.mjs [--check]
 *
 * `--check` verifies the existing output is current without rewriting it.
 */

import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENTRY = path.join(ROOT, 'functions', 'src', 'index.js');
const OUT = path.join(ROOT, 'functions', 'lib', 'index.js');

const BANNER =
  '// Generated from functions/src/ by tools/bundle-functions.mjs.\n' +
  '// Do not edit — edit the source and run `npm run build` in functions/.\n';

async function render() {
  const result = await build({
    absWorkingDir: path.join(ROOT, 'functions'),
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',
    platform: 'node',
    // Only this project's own relative imports (core/, server/) get
    // inlined. Every bare-specifier import — firebase-admin, googleapis, the
    // rest — stays a real import resolved from functions/node_modules at
    // runtime, exactly as the Cloud Functions deploy environment expects.
    packages: 'external',
    write: false,
    minify: false,
    legalComments: 'inline',
    logLevel: 'warning',
    banner: { js: BANNER }
  });
  return result.outputFiles[0].text;
}

const text = await render();
const check = process.argv.includes('--check');
const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;

if (check) {
  if (existing !== text) {
    console.error('functions/lib/index.js: drifted from functions/src/ — run `npm run build` in functions/');
    process.exit(1);
  }
  console.log('functions/lib/index.js: matches functions/src/');
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
console.log(
  `functions/lib/index.js: ${existing === text ? 'unchanged' : 'written'}, ${(text.length / 1024).toFixed(1)} KB`
);
