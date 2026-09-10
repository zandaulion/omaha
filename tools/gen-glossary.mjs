/**
 * Emit the Android glossary from core/glossary.js.
 *
 * Usage:
 *   node tools/gen-glossary.mjs            # write
 *   node tools/gen-glossary.mjs --check    # exit 1 if committed output has drifted
 *
 * Same shape as tools/gen-tokens.mjs: one source of truth in core/, one
 * generated Kotlin file, a --check mode test/glossary-kt.test.js runs so
 * hand-editing the output fails the suite rather than quietly drifting from
 * what the PWA explains.
 *
 * core/glossary.js is imported as a real ES module (the repo is
 * "type": "module") rather than scraped as text, so GLOSSARY and ALIASES
 * here are always exactly what explain() itself reads.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'core/glossary.js');
const KT_OUT = path.join(ROOT, 'android/design/src/main/kotlin/com/zandaulion/omaha/design/Glossary.kt');

const BANNER_LINES = [
  'Generated from core/glossary.js by tools/gen-glossary.mjs.',
  '',
  'Do not edit. Edit the source and run `npm run glossary`,',
  'then commit the result.',
  'test/glossary-kt.test.js fails if this file has drifted from its source.'
];

const { GLOSSARY, ALIASES } = await import(pathToFileURL(SOURCE).href);

/** A JSON string literal is also a valid Kotlin one — same trick gen-tokens.mjs uses for OmahaFonts. */
const kt = (s) => JSON.stringify(s);

function buildKotlin() {
  const out = [];
  out.push('package com.zandaulion.omaha.design', '');
  out.push('/**', ...BANNER_LINES.map((l) => (l ? ` * ${l}` : ' *')), ' */', '');

  out.push('/** One glossary entry: what it means, why it matters, how it is computed. */');
  out.push('data class GlossaryEntry(');
  out.push('    val title: String,');
  out.push('    val means: String,');
  out.push('    val matters: String,');
  out.push('    val computes: String');
  out.push(')', '');

  out.push('/**');
  out.push(' * `explain(key)` mirrors core/glossary.js\'s own: a direct hit in the');
  out.push(' * entries, falling back through the alias table, or null. Callers pass');
  out.push(' * whichever key or alias reads naturally at the call site — see');
  out.push(' * ExplainSheet.kt\'s ExplainableLabel.');
  out.push(' */');
  out.push('object Glossary {');
  out.push('    private val ENTRIES: Map<String, GlossaryEntry> = mapOf(');
  for (const [key, entry] of Object.entries(GLOSSARY)) {
    out.push(`        ${kt(key)} to GlossaryEntry(`);
    out.push(`            title = ${kt(entry.title)},`);
    out.push(`            means = ${kt(entry.means)},`);
    out.push(`            matters = ${kt(entry.matters)},`);
    out.push(`            computes = ${kt(entry.computes)}`);
    out.push('        ),');
  }
  out.push('    )', '');

  out.push('    private val ALIASES: Map<String, String> = mapOf(');
  for (const [alias, target] of Object.entries(ALIASES)) {
    out.push(`        ${kt(alias)} to ${kt(target)},`);
  }
  out.push('    )', '');

  out.push('    fun explain(key: String?): GlossaryEntry? {');
  out.push('        if (key == null) return null');
  out.push('        return ENTRIES[key] ?: ALIASES[key]?.let { ENTRIES[it] }');
  out.push('    }');
  out.push('}');

  return out.join('\n') + '\n';
}

// ------------------------------------------------------------------- main

const content = buildKotlin();
const check = process.argv.includes('--check');
const existing = fs.existsSync(KT_OUT) ? fs.readFileSync(KT_OUT, 'utf8') : null;

if (check) {
  if (existing !== content) {
    console.error(
      existing === null
        ? 'android/design/…/Glossary.kt: missing — run `node tools/gen-glossary.mjs`'
        : 'android/design/…/Glossary.kt: drifted from core/glossary.js — run `node tools/gen-glossary.mjs`'
    );
    process.exit(1);
  }
  console.log('glossary: Glossary.kt matches core/glossary.js');
} else {
  fs.mkdirSync(path.dirname(KT_OUT), { recursive: true });
  fs.writeFileSync(KT_OUT, content);
  console.log(
    `android/design/…/Glossary.kt: ${existing === content ? 'unchanged' : 'written'}, ${(content.length / 1024).toFixed(1)} KB`
  );
}
