import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The Android glossary's parity gate — same argument as test/tokens.test.js:
 * one source of truth in core/glossary.js, one generated Kotlin file, and
 * this is what stops someone hand-editing the generated copy and drifting
 * from what the PWA actually explains.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const KT = 'android/design/src/main/kotlin/com/zandaulion/omaha/design/Glossary.kt';

test('the committed Glossary.kt matches core/glossary.js', () => {
  try {
    execFileSync('node', ['tools/gen-glossary.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });
  } catch (err) {
    assert.fail(
      'Glossary.kt has drifted from core/glossary.js.\n' +
        'Run `npm run glossary` and commit the result.\n' +
        (err.stderr?.toString() || '')
    );
  }
});

test('Glossary.kt says it is generated', () => {
  const text = read(KT);
  assert.match(text, /Generated from core\/glossary\.js/);
  assert.match(text, /Do not edit/);
});

test('every core glossary key made it into the generated file', () => {
  const kt = read(KT);
  const core = read('core/glossary.js');
  const keys = [...core.matchAll(/^\s*'([^']+)':\s*\{/gm)].map((m) => m[1]);
  assert.ok(keys.length > 40, 'sanity check: expected dozens of glossary entries');
  for (const key of keys) {
    assert.ok(kt.includes(JSON.stringify(key)), `${key} missing from Glossary.kt`);
  }
});
