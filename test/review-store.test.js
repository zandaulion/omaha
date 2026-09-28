import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBackup, mergeBackup } from '../core/backup.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omaha-review-'));
process.env.DATA_DIR = scratch;
const { db, initDatabase } = await import('../server/db.js');
// Start from a real legacy personal table, not a newly created v2 one.
db.exec(`CREATE TABLE theses (ticker TEXT PRIMARY KEY, conviction TEXT DEFAULT 'high',
  target_buy_price REAL, core_rationale TEXT, moat_tags_json TEXT DEFAULT '[]',
  sell_triggers_json TEXT DEFAULT '[]', journal_entries_json TEXT DEFAULT '[]', updated_at TEXT)`);
db.prepare('INSERT INTO theses (ticker, core_rationale, updated_at) VALUES (?, ?, ?)').run('ABC', 'Original reason', '2026-01-01');
initDatabase();
const { readThesis, saveThesis, recordReview } = await import('../server/thesis-store.js');
const { readPersonalData, writePersonalData } = await import('../server/backup-store.js');

test('additive migration preserves an existing thesis and supplies empty conditions', () => {
  assert.equal(readThesis('ABC').coreRationale, 'Original reason');
  assert.equal(readThesis('ABC').mustRemainTrue, '');
  assert.equal(readThesis('NEW').sellTriggers.length, 0);
});

test('recording review and subsequently saving stale form preserves both histories and conditions', () => {
  const stale = saveThesis('ABC', { mustRemainTrue: 'Repeat customers stay.', journalEntries: [
    { id: 'note', date: '2026-01-01', note: 'Initial research' }
  ] });
  recordReview('ABC', 'watch', '  Revisit retention next quarter.  ');
  const latest = saveThesis('ABC', { ...stale, coreRationale: 'Edited reason' });
  assert.equal(latest.journalEntries.length, 2);
  assert.equal(latest.journalEntries[0].kind, 'review');
  assert.equal(latest.journalEntries[0].assessment, 'watch');
  assert.equal(latest.journalEntries[0].note, 'Revisit retention next quarter.');
  assert.equal(latest.mustRemainTrue, 'Repeat customers stay.');
  assert.equal(latest.coreRationale, 'Edited reason');
  const exported = buildBackup(readPersonalData(), '2026-09-27T00:00:00Z');
  db.exec('DELETE FROM theses');
  writePersonalData(mergeBackup(exported, readPersonalData()));
  assert.deepEqual(buildBackup(readPersonalData(), exported.exportedAt).theses, exported.theses);
});

test('invalid review does not modify the thesis', () => {
  const before = readThesis('ABC');
  assert.throws(() => recordReview('ABC', 'healthy', 'no'), TypeError);
  assert.deepEqual(readThesis('ABC'), before);
});

test.after(() => { db.close(); fs.rmSync(scratch, { recursive: true, force: true }); });
