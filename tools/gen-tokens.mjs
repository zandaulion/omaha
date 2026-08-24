/**
 * Emit both palettes from `design/tokens.json`.
 *
 * Usage:
 *   node tools/gen-tokens.mjs            # write
 *   node tools/gen-tokens.mjs --check    # exit 1 if committed output has drifted
 *
 * Doc 13 §10 names this as the mechanism that turns "the two clients look the
 * same" from an intention into a build failure. The generated files carry a
 * header saying so, and `test/tokens.test.js` runs `--check`, so hand-editing
 * either output fails the suite rather than surviving as a quiet divergence.
 *
 * Written before the Compose UI on purpose. Retrofitting a token system after a
 * UI exists means revisiting every hardcoded colour in the tree, which is the
 * reason `docs/16_ROADMAP.md` puts this in phase 3 rather than phase 4.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TOKENS = path.join(ROOT, 'design/tokens.json');

const CSS_OUT = path.join(ROOT, 'web/tokens.css');
const KT_OUT = path.join(ROOT, 'android/design/src/main/kotlin/com/zandaulion/omaha/design/Tokens.kt');

const BANNER_LINES = [
  'Generated from design/tokens.json by tools/gen-tokens.mjs.',
  '',
  'Do not edit. Edit the source and run `npm run tokens`.',
  'test/tokens.test.js fails if this file has drifted from its source, which is',
  'what stops the two clients diverging one hand-edit at a time.'
];

const tokens = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));

/** Keys beginning with `$` are notes to a reader, not tokens. */
const real = (obj) => Object.entries(obj).filter(([k]) => !k.startsWith('$'));

// ------------------------------------------------------------------- CSS

function buildCss() {
  const out = [];
  out.push('/*', ...BANNER_LINES.map((l) => (l ? ` * ${l}` : ' *')), ' */', '');

  const varLines = (theme) => {
    const lines = [];
    for (const [name, value] of real(tokens.color)) {
      lines.push(`  --${name}: ${value[theme]};`);
    }
    const g = tokens.gradient.brand;
    lines.push(
      `  --brand-gradient: linear-gradient(${g.angleDeg}deg, ${g.from} 0%, ${g.to} 100%);`
    );
    for (const [name, value] of real(tokens.shadow)) {
      lines.push(`  --shadow-${name}: ${value[theme]};`);
    }
    return lines;
  };

  // Dark on bare :root, light behind the attribute — the arrangement the app
  // already uses. Reversing it here would silently change every default.
  out.push('/* Dark is the base palette; see design/tokens.json. */');
  out.push(':root {');
  out.push(...varLines('dark'));
  for (const [name, px] of real(tokens.radius)) out.push(`  --radius-${name}: ${px}px;`);
  for (const [name, px] of real(tokens.layout)) out.push(`  --${name}: ${px}px;`);
  out.push('');
  out.push(`  --font-sans: ${tokens.font.sans.webStack};`);
  out.push(`  --font-mono: ${tokens.font.mono.webStack};`);
  out.push('');
  for (const [name, t] of real(tokens.type)) {
    out.push(`  --type-${name}-size: ${t.size}px;`);
    out.push(`  --type-${name}-line: ${t.lineHeight}px;`);
    out.push(`  --type-${name}-weight: ${t.weight};`);
    out.push(`  --type-${name}-tracking: ${t.tracking}em;`);
  }
  out.push('}', '');

  out.push('[data-theme="light"] {');
  out.push(...varLines('light'));
  out.push('}', '');

  return out.join('\n');
}

// ---------------------------------------------------------------- Kotlin

/**
 * `rgba(r, g, b, a)` or `#RRGGBB` to Compose's `0xAARRGGBB`.
 *
 * Compose puts alpha first and CSS puts it last, which is the kind of
 * difference that produces a plausible wrong colour rather than a crash — so it
 * is converted here, once, rather than by hand at each call site.
 */
function toArgb(css) {
  const hex = css.match(/^#([0-9a-f]{6})$/i);
  if (hex) return `0xFF${hex[1].toUpperCase()}`;

  const rgba = css.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgba) {
    const [, r, g, b, a] = rgba;
    const alpha = Math.round((a === undefined ? 1 : parseFloat(a)) * 255);
    const byte = (n) => Number(n).toString(16).toUpperCase().padStart(2, '0');
    return `0x${byte(alpha)}${byte(r)}${byte(g)}${byte(b)}`;
  }

  throw new Error(`Cannot convert colour to ARGB: ${css}`);
}

/**
 * Kebab to camel, digits included.
 *
 * `-([a-z])` alone leaves `title-1` untouched, and `val title-1` is not a
 * Kotlin identifier — a hyphen is an operator. It is a syntax error rather than
 * a wrong value, so it cannot reach a device, but it also cannot be seen
 * without compiling: the generator is happy to emit it.
 */
const camel = (kebab) => kebab.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const pascal = (kebab) => {
  const c = camel(kebab);
  return c[0].toUpperCase() + c.slice(1);
};

function buildKotlin() {
  const out = [];
  out.push('package com.zandaulion.omaha.design', '');
  out.push('import androidx.compose.ui.graphics.Color');
  out.push('import androidx.compose.ui.text.font.FontWeight');
  out.push('import androidx.compose.ui.unit.dp');
  // `em` is easy to omit because it appears only in the tracking values.
  out.push('import androidx.compose.ui.unit.em');
  out.push('import androidx.compose.ui.unit.sp', '');
  out.push('/**', ...BANNER_LINES.map((l) => (l ? ` * ${l}` : ' *')), ' */', '');

  const colourBlock = (theme) => {
    const lines = [];
    for (const [name, value] of real(tokens.color)) {
      lines.push(`    val ${camel(name)}: Color = Color(${toArgb(value[theme])})`);
    }
    return lines;
  };

  out.push('/** One palette. Two instances: [DarkColors] and [LightColors]. */');
  out.push('class OmahaColors internal constructor(');
  out.push(
    ...real(tokens.color).map(([name]) => `    val ${camel(name)}: Color,`)
  );
  out.push(')', '');

  const ctorArgs = (theme) =>
    real(tokens.color).map(([name, v]) => `    ${camel(name)} = Color(${toArgb(v[theme])}),`);

  out.push('val DarkColors: OmahaColors = OmahaColors(');
  out.push(...ctorArgs('dark'));
  out.push(')', '');
  out.push('val LightColors: OmahaColors = OmahaColors(');
  out.push(...ctorArgs('light'));
  out.push(')', '');

  const g = tokens.gradient.brand;
  out.push('/** The brand gradient, as its stops. Compose builds the brush. */');
  out.push('object OmahaGradient {');
  out.push(`    val brandFrom: Color = Color(${toArgb(g.from)})`);
  out.push(`    val brandTo: Color = Color(${toArgb(g.to)})`);
  out.push(`    const val brandAngleDeg: Float = ${g.angleDeg}f`);
  out.push('}', '');

  out.push('object OmahaRadius {');
  for (const [name, px] of real(tokens.radius)) {
    out.push(`    val ${camel(name)} = ${px}.dp`);
  }
  out.push('}', '');

  out.push('object OmahaLayout {');
  for (const [name, px] of real(tokens.layout)) {
    out.push(`    val ${camel(name)} = ${px}.dp`);
  }
  out.push('}', '');

  out.push('/**');
  out.push(' * The type scale from doc 04 §2.');
  out.push(' *');
  out.push(' * Sizes are sp so they honour the reader\'s font scale; line heights are sp');
  out.push(' * for the same reason. Tracking is em in the source and stays relative here,');
  out.push(' * because Compose letter spacing in sp would not scale with the size.');
  out.push(' */');
  out.push('class OmahaTextStyle internal constructor(');
  out.push('    val size: androidx.compose.ui.unit.TextUnit,');
  out.push('    val lineHeight: androidx.compose.ui.unit.TextUnit,');
  out.push('    val weight: FontWeight,');
  out.push('    val tracking: androidx.compose.ui.unit.TextUnit');
  out.push(')', '');

  out.push('object OmahaType {');
  for (const [name, t] of real(tokens.type)) {
    out.push(`    /** ${t.use}. */`);
    out.push(
      `    val ${camel(name)} = OmahaTextStyle(` +
        `${t.size}.sp, ${t.lineHeight}.sp, FontWeight(${t.weight}), ${t.tracking}.em)`
    );
  }
  out.push('}', '');

  out.push('/**');
  out.push(' * Bundled faces. Doc 13 §10 requires both in the APK: Roboto does not');
  out.push(' * reproduce doc 04\'s scale, so falling back to the system face puts the');
  out.push(' * Android build off-parity before a screen is laid out.');
  out.push(' */');
  out.push('object OmahaFonts {');
  out.push(`    const val sans = ${JSON.stringify(tokens.font.sans.bundled)}`);
  out.push(`    const val mono = ${JSON.stringify(tokens.font.mono.bundled)}`);
  out.push('}');

  return out.join('\n') + '\n';
}

// ------------------------------------------------------------------- main

const outputs = [
  { file: CSS_OUT, content: buildCss(), label: 'web/tokens.css' },
  { file: KT_OUT, content: buildKotlin(), label: 'android/design/…/Tokens.kt' }
];

const check = process.argv.includes('--check');
let drifted = 0;

for (const { file, content, label } of outputs) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;

  if (check) {
    if (existing !== content) {
      drifted++;
      console.error(
        existing === null
          ? `${label}: missing — run \`npm run tokens\``
          : `${label}: drifted from design/tokens.json — run \`npm run tokens\``
      );
    }
    continue;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(
    `${label}: ${existing === content ? 'unchanged' : 'written'}, ${(content.length / 1024).toFixed(1)} KB`
  );
}

if (check) {
  if (drifted) process.exit(1);
  console.log('tokens: both outputs match design/tokens.json');
}
