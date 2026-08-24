import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Application preferences, and one property that matters more than the rest:
 * the AI notes opt-in is off until somebody turns it on.
 *
 * `server/db.js` opens its database at import time from `DATA_DIR`, so the
 * variable is set before the dynamic import below rather than at the top of the
 * file — a static import would be hoisted above the assignment and would write
 * into the real data directory.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omaha-settings-'));
process.env.DATA_DIR = tmpDir;

const { initDatabase, db } = await import('../server/db.js');
const {
  getAppSettings,
  updateAppSettings,
  shouldIncludeNotesInAI
} = await import('../server/app-settings.js');

initDatabase();

test('the AI notes opt-in defaults to off', () => {
  assert.strictEqual(getAppSettings().ai_include_notes, 0);
  assert.strictEqual(shouldIncludeNotesInAI(), false);
});

test('an unwritten preference reads as its default rather than undefined', () => {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'ai_include_notes'").get();
  assert.strictEqual(row, undefined, 'nothing should have been written yet');
  assert.strictEqual(getAppSettings().ai_include_notes, 0);
});

test('turning the opt-in on persists and is readable', () => {
  const after = updateAppSettings({ ai_include_notes: true });
  assert.strictEqual(after.ai_include_notes, 1);
  assert.strictEqual(shouldIncludeNotesInAI(), true);
});

test('turning it back off persists', () => {
  updateAppSettings({ ai_include_notes: true });
  const after = updateAppSettings({ ai_include_notes: false });
  assert.strictEqual(after.ai_include_notes, 0);
  assert.strictEqual(shouldIncludeNotesInAI(), false);
});

test('an empty patch changes nothing', () => {
  updateAppSettings({ ai_include_notes: true });
  const after = updateAppSettings({});
  assert.strictEqual(after.ai_include_notes, 1, 'an absent key must not be read as false');
});

test('unknown keys are ignored rather than stored', () => {
  updateAppSettings({ not_a_real_setting: true });
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'not_a_real_setting'").get();
  assert.strictEqual(row, undefined);
});

test('a setting written as a truthy string is read back as a number', () => {
  // The column is TEXT NOT NULL and the VAPID keys share the table, so a
  // caller could reasonably store '1' directly. Readers should not have to
  // know which of '1', 1 or true was written.
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('ai_include_notes', '1') " +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run();
  assert.strictEqual(getAppSettings().ai_include_notes, 1);
  assert.strictEqual(shouldIncludeNotesInAI(), true);
});

test('the VAPID keys sharing the table are not returned as preferences', () => {
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('vapid_public_key', 'abc') " +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run();
  const settings = getAppSettings();
  assert.ok(!('vapid_public_key' in settings));
  assert.deepStrictEqual(Object.keys(settings), ['ai_include_notes']);
});

/**
 * The preference is only worth anything if it actually changes the bytes that
 * leave the machine, so this asserts the payload rather than the flag.
 *
 * The route's whole decision is which of `thesis` or `null` it passes, so that
 * is what is reproduced here — against a real scored model, because the payload
 * builder reads enough of the stock that a hand-made stub would prove little.
 */
const { buildComprehensivePayload } = await import('../core/analysis/prompt.js');

const stock = JSON.parse(
  fs.readFileSync(new URL('../core/__fixtures__/AAPL.model.json', import.meta.url), 'utf8')
);

const thesis = {
  ticker: 'AAPL',
  conviction: 'fortress',
  target_buy_price: 150,
  core_rationale: 'SECRET-RATIONALE-CANARY',
  sell_triggers_json: JSON.stringify([{ label: 'SECRET-GUARDRAIL-CANARY', checked: false }]),
  journal_entries_json: JSON.stringify([{ id: 1, text: 'SECRET-JOURNAL-CANARY' }])
};

test('with the opt-in off, no part of the thesis reaches the payload', () => {
  updateAppSettings({ ai_include_notes: false });
  const thesisForRequest = shouldIncludeNotesInAI() ? thesis : null;
  const payload = buildComprehensivePayload(stock, thesisForRequest);
  const serialised = JSON.stringify(payload);

  assert.ok(!serialised.includes('SECRET-RATIONALE-CANARY'));
  assert.ok(!serialised.includes('SECRET-GUARDRAIL-CANARY'));
  assert.ok(!serialised.includes('fortress'));

  // Structural rather than a string search: the target buy price is a bare
  // number, and searching the whole payload for one would collide with the
  // financial data the analysis is supposed to contain.
  assert.strictEqual(typeof payload.userInvestmentThesis, 'string');
  assert.match(payload.userInvestmentThesis, /has not written a thesis/);
});

test('with the opt-in on, the thesis reaches the payload', () => {
  updateAppSettings({ ai_include_notes: true });
  const thesisForRequest = shouldIncludeNotesInAI() ? thesis : null;
  const serialised = JSON.stringify(buildComprehensivePayload(stock, thesisForRequest));

  assert.ok(serialised.includes('SECRET-RATIONALE-CANARY'));
  assert.ok(serialised.includes('SECRET-GUARDRAIL-CANARY'));
});

test('journal entries never reach the payload, opted in or not', () => {
  // Doc 13 §1 described the exposure as "thesis and journal entries". The
  // thesis row does carry journal_entries_json, but buildComprehensivePayload
  // reads only conviction, target price, rationale and guardrails — so the
  // journal has never been transmitted. Pinned here so that stays true.
  for (const optedIn of [false, true]) {
    updateAppSettings({ ai_include_notes: optedIn });
    const thesisForRequest = shouldIncludeNotesInAI() ? thesis : null;
    const serialised = JSON.stringify(buildComprehensivePayload(stock, thesisForRequest));
    assert.ok(
      !serialised.includes('SECRET-JOURNAL-CANARY'),
      `journal leaked with the opt-in ${optedIn ? 'on' : 'off'}`
    );
  }
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
