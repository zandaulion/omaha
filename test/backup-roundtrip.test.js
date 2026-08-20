/**
 * Export, import, and back again — against a real database.
 *
 * `core/backup.test.js` proves the merge rules in isolation. This proves the
 * other half: that the SQLite mapping either side of them is faithful, so a
 * file written by the PWA restores into the PWA with nothing lost or invented.
 *
 * It is also the standing definition of the exit criterion in doc 13 §11 —
 * a backup imports and exports losslessly — stated in a form that fails if it
 * ever stops being true.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildBackup, mergeBackup } from '../core/backup.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omaha-backup-'));
process.env.DATA_DIR = scratch;

const { initDatabase, db } = await import('../server/db.js');
const { readPersonalData, writePersonalData } = await import('../server/backup-store.js');

initDatabase();

function reset() {
  db.prepare('DELETE FROM theses').run();
  db.prepare('DELETE FROM watchlists').run();
}

function seed() {
  db.prepare(`
    INSERT INTO theses (ticker, conviction, target_buy_price, core_rationale,
                        moat_tags_json, sell_triggers_json, journal_entries_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'NOK', 'high', 4.5, 'Licensing revenue is underappreciated.',
    JSON.stringify(['patents', 'switching costs']),
    JSON.stringify([{ id: 's1', text: 'Licensing renewals stall', checked: false }]),
    // Newest first, which is how the client stores them: `handleSaveJournalNote`
    // unshifts, and the journal renders in that order.
    JSON.stringify([
      { id: '1717000000001', date: '2026-05-01T09:00:00.000Z', note: 'Margin pressure in MN.' },
      { id: '1717000000000', date: '2026-02-01T09:00:00.000Z', note: 'Q4 came in ahead.' }
    ]),
    '2026-05-01 09:00:00'
  );
  db.prepare(`
    INSERT INTO watchlists (id, name, tickers_json, is_default, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('core', 'Core', JSON.stringify(['NOK', 'AAPL']), 1, '2026-05-01 09:00:00');
}

test('a backup exported from the database restores into an empty one, losslessly', () => {
  reset();
  seed();

  const exported = buildBackup(readPersonalData(), '2026-08-20T12:00:00.000Z');

  // A different device: same schema, no data.
  reset();
  const merged = mergeBackup(JSON.parse(JSON.stringify(exported)), readPersonalData());
  writePersonalData(merged);

  const reExported = buildBackup(readPersonalData(), '2026-08-20T12:00:00.000Z');

  assert.deepEqual(
    reExported.theses,
    exported.theses,
    'the thesis, its tags, triggers and every journal entry survived the trip'
  );
  assert.deepEqual(reExported.watchlists, exported.watchlists);
});

test('restoring onto a device that already has the same data changes nothing', () => {
  reset();
  seed();

  const exported = buildBackup(readPersonalData(), '2026-08-20T12:00:00.000Z');
  const before = readPersonalData();

  writePersonalData(mergeBackup(exported, readPersonalData()));

  assert.deepEqual(readPersonalData(), before, 'a repeated restore is a no-op');
});

test('a note written on the other device arrives without displacing local edits', () => {
  reset();
  seed();

  // The file was exported earlier, then the local thesis was rewritten.
  const exported = buildBackup(readPersonalData(), '2026-08-20T12:00:00.000Z');
  exported.theses[0].journalEntries.push({
    id: '1717000000002',
    date: '2026-06-01T09:00:00.000Z',
    note: 'Written on the phone.'
  });

  db.prepare(
    "UPDATE theses SET core_rationale = ?, updated_at = ? WHERE ticker = 'NOK'"
  ).run('Rewritten here, later.', '2026-07-01 09:00:00');

  writePersonalData(mergeBackup(exported, readPersonalData()));

  const [thesis] = readPersonalData().theses;
  assert.equal(thesis.coreRationale, 'Rewritten here, later.', 'the newer local body won');
  assert.equal(thesis.journalEntries.length, 3, 'and the phone note still arrived');
  assert.ok(
    thesis.journalEntries.some((e) => e.note === 'Written on the phone.'),
    'the note from the losing side is the one most easily lost'
  );
});

test('journal order is normalised to newest first, whatever order it arrived in', () => {
  // Not data loss, but worth stating: a file whose entries are in some other
  // order comes back sorted. The client renders them in this order, so leaving
  // them as found would show a journal that reads backwards.
  reset();
  seed();
  db.prepare("UPDATE theses SET journal_entries_json = ? WHERE ticker = 'NOK'").run(
    JSON.stringify([
      { id: 'a', date: '2026-01-01T00:00:00.000Z', note: 'oldest' },
      { id: 'b', date: '2026-09-01T00:00:00.000Z', note: 'newest' }
    ])
  );

  writePersonalData(mergeBackup(buildBackup(readPersonalData(), 'x'), readPersonalData()));

  const notes = readPersonalData().theses[0].journalEntries.map((e) => e.note);
  assert.deepEqual(notes, ['newest', 'oldest']);
});

test('a malformed file is refused before anything is written', () => {
  reset();
  seed();
  const before = readPersonalData();

  assert.throws(() => mergeBackup('{ not json', readPersonalData()));
  assert.throws(() => mergeBackup({ nothing: 'useful' }, readPersonalData()));

  assert.deepEqual(readPersonalData(), before, 'the database was not touched');
});

test('the committed PWA fixture is a valid backup and imports cleanly', () => {
  // core/__fixtures__/backup.pwa.json is what the Android instrumented test
  // imports. It was produced by this export path, and this asserts it still
  // matches it — a fixture the other client reads must not drift.
  const file = JSON.parse(
    fs.readFileSync(new URL('../core/__fixtures__/backup.pwa.json', import.meta.url), 'utf8')
  );

  reset();
  writePersonalData(mergeBackup(file, readPersonalData()));

  const reExported = buildBackup(readPersonalData(), file.exportedAt);
  assert.deepEqual(reExported.theses, file.theses, 'the fixture no longer round-trips');
  assert.deepEqual(reExported.watchlists, file.watchlists);
});

test.after(() => {
  try {
    db.close();
  } catch {
    // already closed
  }
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    // Windows keeps WAL files open briefly; a temp dir left behind is harmless
  }
});
