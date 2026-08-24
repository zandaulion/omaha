import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The parity gate.
 *
 * Doc 13 §10: `design/tokens.json` is the single source, `tools/gen-tokens.mjs`
 * emits both consumers, and CI fails if either committed output differs from
 * what the source produces. That last clause is this file. Without it the
 * generator is a convenience that anyone can route around by editing the CSS
 * directly, and the two clients drift one hand-edit at a time.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const CSS = 'web/tokens.css';
const KT = 'android/design/src/main/kotlin/com/zandaulion/omaha/design/Tokens.kt';

test('the committed token files match design/tokens.json', () => {
  // Runs the generator's own --check rather than reimplementing the comparison,
  // so a change to how output is built cannot pass here and fail in CI.
  try {
    execFileSync('node', ['tools/gen-tokens.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });
  } catch (err) {
    assert.fail(
      'Generated token files have drifted from design/tokens.json.\n' +
        'Run `npm run tokens` and commit the result.\n' +
        (err.stderr?.toString() || '')
    );
  }
});

test('both generated files say they are generated', () => {
  // A reader who opens either one should learn not to edit it there, rather
  // than from a document they have not opened.
  for (const file of [CSS, KT]) {
    const text = read(file);
    assert.match(text, /Generated from design\/tokens\.json/);
    assert.match(text, /Do not edit/);
  }
});

test('app.css no longer defines the palette itself', () => {
  // Two definitions of --bg-canvas is the drift this exists to prevent, and
  // the one that is easier to edit always wins. The safe-area insets are the
  // deliberate exception: env() is a browser capability, not a design token.
  const appCss = read('web/app.css');
  const rootBlock = appCss.slice(appCss.indexOf(':root {'), appCss.indexOf('}', appCss.indexOf(':root {')));

  assert.ok(!rootBlock.includes('--bg-canvas'), 'app.css still defines --bg-canvas');
  assert.ok(!rootBlock.includes('--text-primary'), 'app.css still defines --text-primary');
  assert.ok(rootBlock.includes('--sat'), 'the safe-area insets should stay in app.css');
});

test('the page loads tokens.css before app.css', () => {
  // Custom properties must be defined before the rules that consume them are
  // parsed. Reversed, every themed colour falls back to nothing.
  // Matched on the href rather than the bare filename: prose in a comment
  // mentioning app.css would otherwise count as the link and invert the order.
  const html = read('web/index.html');
  const tokensAt = html.indexOf('href="/tokens.css');
  const appAt = html.indexOf('href="/app.css');
  assert.ok(tokensAt > -1, 'index.html does not link tokens.css');
  assert.ok(appAt > -1, 'index.html does not link app.css');
  assert.ok(tokensAt < appAt, 'tokens.css must be linked before app.css');
});

test('every colour resolves in both themes', () => {
  // A token defined only in the dark block renders as nothing on light, which
  // is the classic half-themed page. Both blocks must carry the same names.
  const tokens = JSON.parse(read('design/tokens.json'));
  const names = Object.keys(tokens.color).filter((k) => !k.startsWith('$'));

  const css = read(CSS);
  const dark = css.slice(css.indexOf(':root {'), css.indexOf('[data-theme="light"]'));
  const light = css.slice(css.indexOf('[data-theme="light"]'));

  for (const name of names) {
    assert.ok(dark.includes(`--${name}:`), `${name} missing from the dark palette`);
    assert.ok(light.includes(`--${name}:`), `${name} missing from the light palette`);
  }
});

test('CSS alpha is converted to Compose ARGB, not copied', () => {
  // CSS puts alpha last and Compose puts it first. Getting it wrong yields a
  // plausible wrong colour rather than a crash, so it is asserted on a value
  // where the two orderings are visibly different.
  const kt = read(KT);
  // rgba(255, 255, 255, 0.08) -> alpha 0.08 * 255 = 20 = 0x14
  assert.match(kt, /0x14FFFFFF/, 'border-subtle should be 0x14FFFFFF in the dark palette');
  // A fully opaque hex gains an FF prefix.
  assert.match(kt, /0xFF0B0E14/, 'bg-canvas should be 0xFF0B0E14');
});

test('the type scale carries doc 04 §2 unchanged', () => {
  const tokens = JSON.parse(read('design/tokens.json'));
  // The five values doc 04 tabulates for the largest style, as a canary on the
  // whole scale being transcribed rather than approximated.
  assert.deepStrictEqual(
    { ...tokens.type['display-lg'], use: undefined },
    { size: 32, lineHeight: 38, weight: 700, tracking: -0.03, use: undefined }
  );
  assert.strictEqual(tokens.type['caption'].size, 11);
  assert.strictEqual(tokens.type['body-md'].lineHeight, 22);
});

test('both bundled faces are named, since Roboto cannot reproduce the scale', () => {
  const tokens = JSON.parse(read('design/tokens.json'));
  assert.strictEqual(tokens.font.sans.bundled, 'Inter');
  assert.strictEqual(tokens.font.mono.bundled, 'JetBrains Mono');
  assert.match(read(KT), /OmahaFonts/);
});
