/**
 * The interchange format and its merge rules.
 *
 * Every test here is about not losing something a person wrote. That is the
 * only failure mode this module has that matters: a merge that drops a journal
 * note is worse than one that refuses to run, because it reports success.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readBackup, buildBackup, mergeBackup, BackupError, SCHEMA_VERSION } from './backup.js';

const entry = (id, date, note) => ({ id, date, note });

const thesis = (ticker, updatedAt, entries = [], extra = {}) => ({
  ticker,
  conviction: 'high',
  targetBuyPrice: 10,
  coreRationale: 'because',
  moatTags: [],
  sellTriggers: [],
  journalEntries: entries,
  updatedAt,
  ...extra
});

const backup = (theses = [], watchlists = []) => ({
  schemaVersion: SCHEMA_VERSION,
  exportedAt: '2026-08-20T12:00:00.000Z',
  theses,
  watchlists
});

// ------------------------------------------------------------------ reading

test('a backup exported before versioning is readable', () => {
  // The shape the PWA has emitted all along: no schemaVersion, is_default.
  const legacy = {
    exportedAt: '2026-01-01T00:00:00.000Z',
    theses: [thesis('NOK', '2026-01-01 10:00:00')],
    watchlists: [{ id: 'core', name: 'Core', tickers: ['nok'], is_default: true }]
  };
  const read = readBackup(legacy);
  assert.equal(read.schemaVersion, 1);
  assert.equal(read.theses[0].ticker, 'NOK');
  assert.equal(read.watchlists[0].is_default, true);
  assert.deepEqual(read.watchlists[0].tickers, ['NOK'], 'tickers are normalised');
});

test('a newer major version is refused rather than half-understood', () => {
  assert.throws(
    () => readBackup({ schemaVersion: SCHEMA_VERSION + 1, theses: [] }),
    (err) => err instanceof BackupError && err.kind === 'unsupported_version'
  );
});

test('a file that is not a backup says so', () => {
  assert.throws(() => readBackup('not json'), (e) => e.kind === 'malformed');
  assert.throws(() => readBackup({ hello: 'world' }), (e) => e.kind === 'not_a_backup');
  assert.throws(() => readBackup([1, 2, 3]), (e) => e.kind === 'not_a_backup');
});

test('both spellings of the default flag are accepted on the way in', () => {
  const read = readBackup({
    theses: [],
    watchlists: [
      { id: 'a', name: 'A', tickers: [], isDefault: true },
      { id: 'b', name: 'B', tickers: [], is_default: true }
    ]
  });
  assert.equal(read.watchlists[0].is_default, true);
  assert.equal(read.watchlists[1].is_default, true);
});

// ------------------------------------------------------------------ merging

test('a thesis that exists only in the file is added', () => {
  const { theses, report } = mergeBackup(
    backup([thesis('AAPL', '2026-02-01T00:00:00Z')]),
    backup([])
  );
  assert.deepEqual(theses.map((t) => t.ticker), ['AAPL']);
  assert.deepEqual(report.thesesAdded, ['AAPL']);
});

test('the newer thesis wins, whichever side it is on', () => {
  const older = thesis('NOK', '2026-01-01T00:00:00Z', [], { coreRationale: 'old' });
  const newer = thesis('NOK', '2026-06-01T00:00:00Z', [], { coreRationale: 'new' });

  const incomingWins = mergeBackup(backup([newer]), backup([older]));
  assert.equal(incomingWins.theses[0].coreRationale, 'new');
  assert.deepEqual(incomingWins.report.thesesUpdated, ['NOK']);

  const localWins = mergeBackup(backup([older]), backup([newer]));
  assert.equal(localWins.theses[0].coreRationale, 'new');
  assert.deepEqual(localWins.report.thesesKept, ['NOK']);
});

test('journal entries survive even when their thesis loses', () => {
  // The case the whole module exists for: the thesis was rewritten here, a
  // note was written there. Taking the newer thesis whole would lose the note.
  const local = thesis('NOK', '2026-06-01T00:00:00Z', [
    entry('1', '2026-05-01T00:00:00Z', 'local note')
  ]);
  const incoming = thesis('NOK', '2026-01-01T00:00:00Z', [
    entry('2', '2026-01-01T00:00:00Z', 'imported note')
  ]);

  const { theses, report } = mergeBackup(backup([incoming]), backup([local]));
  const notes = theses[0].journalEntries.map((e) => e.note);

  assert.equal(theses[0].updatedAt, '2026-06-01T00:00:00Z', 'newer thesis body wins');
  assert.deepEqual(notes, ['local note', 'imported note'], 'newest first, both kept');
  assert.equal(report.journalEntriesAdded, 1);
});

test('importing the same file twice changes nothing the second time', () => {
  const file = backup(
    [thesis('NOK', '2026-03-01T00:00:00Z', [entry('1', '2026-03-01T00:00:00Z', 'note')])],
    [{ id: 'core', name: 'Core', tickers: ['NOK'], is_default: true, updatedAt: '2026-03-01T00:00:00Z' }]
  );

  const first = mergeBackup(file, backup([]));
  const second = mergeBackup(file, backup(first.theses, first.watchlists));

  assert.deepEqual(second.theses, first.theses);
  assert.deepEqual(second.watchlists, first.watchlists);
  assert.equal(second.report.journalEntriesAdded, 0);
  assert.equal(second.report.thesesAdded.length, 0);
});

test('two different entries that collide on id are both kept', () => {
  // Entry ids come from Date.now(), which is unique per device and not across
  // two. A collision must not silently drop one of them.
  const local = thesis('NOK', '2026-01-01T00:00:00Z', [
    entry('1717171717', '2026-01-01T00:00:00Z', 'written here')
  ]);
  const incoming = thesis('NOK', '2026-01-01T00:00:00Z', [
    entry('1717171717', '2026-01-02T00:00:00Z', 'written there')
  ]);

  const { theses } = mergeBackup(backup([incoming]), backup([local]));
  const notes = theses[0].journalEntries.map((e) => e.note).sort();

  assert.deepEqual(notes, ['written here', 'written there']);
  assert.equal(
    new Set(theses[0].journalEntries.map((e) => e.id)).size,
    2,
    'the colliding id was disambiguated'
  );
});

test('an entry with no id is identified by its content, not duplicated', () => {
  const file = backup([
    thesis('NOK', '2026-01-01T00:00:00Z', [
      { date: '2026-01-01T00:00:00Z', note: 'no id here' }
    ])
  ]);
  const once = mergeBackup(file, backup([]));
  const twice = mergeBackup(file, backup(once.theses, once.watchlists));
  assert.equal(twice.theses[0].journalEntries.length, 1);
});

test('a watchlist takes the newer version whole, without resurrecting removals', () => {
  const local = {
    id: 'core', name: 'Core', tickers: ['NOK', 'AAPL'],
    is_default: true, updatedAt: '2026-01-01T00:00:00Z'
  };
  const incoming = {
    id: 'core', name: 'Core', tickers: ['NOK'], // AAPL deliberately removed
    is_default: true, updatedAt: '2026-06-01T00:00:00Z'
  };

  const { watchlists } = mergeBackup(backup([], [incoming]), backup([], [local]));
  assert.deepEqual(
    watchlists[0].tickers,
    ['NOK'],
    'a union here would bring back a position that was sold'
  );
});

test('a merge cannot produce two default watchlists', () => {
  const local = { id: 'a', name: 'A', tickers: [], is_default: true, updatedAt: '2026-01-01T00:00:00Z' };
  const incoming = { id: 'b', name: 'B', tickers: [], is_default: true, updatedAt: '2026-06-01T00:00:00Z' };

  const { watchlists } = mergeBackup(backup([], [incoming]), backup([], [local]));
  const defaults = watchlists.filter((w) => w.is_default);

  assert.equal(defaults.length, 1, 'exactly one default');
  assert.equal(defaults[0].id, 'a', 'the local default is kept — this is the device being imported into');
});

test('a record with a timestamp beats one without', () => {
  const undated = thesis('NOK', null, [], { coreRationale: 'undated' });
  const dated = thesis('NOK', '2026-01-01T00:00:00Z', [], { coreRationale: 'dated' });

  assert.equal(mergeBackup(backup([dated]), backup([undated])).theses[0].coreRationale, 'dated');
  assert.equal(mergeBackup(backup([undated]), backup([dated])).theses[0].coreRationale, 'dated');
});

test('a SQLite timestamp is compared as UTC, not by the importing machine timezone', () => {
  // updatedAt arrives from SQLite as "YYYY-MM-DD HH:MM:SS". Read as local time
  // it would shift by the host offset, and east of UTC that inverts which side
  // of a close conflict wins.
  const local = thesis('NOK', '2026-06-01 10:00:00', [], { coreRationale: 'local' });
  const incoming = thesis('NOK', '2026-06-01T11:00:00Z', [], { coreRationale: 'incoming' });

  const { theses } = mergeBackup(backup([incoming]), backup([local]));
  assert.equal(theses[0].coreRationale, 'incoming', '11:00Z is later than 10:00Z');
});

// ------------------------------------------------------------------ round trip

test('a built backup survives a round trip through JSON unchanged', () => {
  const built = buildBackup(
    {
      theses: [thesis('NOK', '2026-03-01T00:00:00Z', [entry('1', '2026-03-01T00:00:00Z', 'note')])],
      watchlists: [{ id: 'core', name: 'Core', tickers: ['NOK'], is_default: true, updatedAt: '2026-03-01T00:00:00Z' }]
    },
    '2026-08-20T12:00:00.000Z'
  );

  const reread = readBackup(JSON.stringify(built));
  assert.equal(reread.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(reread.theses, built.theses);
  assert.deepEqual(reread.watchlists, built.watchlists);
});

test('importing into an empty device reproduces the file exactly', () => {
  // The losslessness claim, stated directly.
  const built = buildBackup(
    {
      theses: [
        thesis('NOK', '2026-03-01T00:00:00Z', [entry('1', '2026-03-01T00:00:00Z', 'a')]),
        thesis('AAPL', '2026-04-01T00:00:00Z', [entry('2', '2026-04-01T00:00:00Z', 'b')])
      ],
      watchlists: [{ id: 'core', name: 'Core', tickers: ['NOK', 'AAPL'], is_default: true, updatedAt: '2026-03-01T00:00:00Z' }]
    },
    '2026-08-20T12:00:00.000Z'
  );

  const { theses, watchlists } = mergeBackup(built, null);
  assert.deepEqual(
    [...theses].sort((a, b) => (a.ticker < b.ticker ? -1 : 1)),
    [...built.theses].sort((a, b) => (a.ticker < b.ticker ? -1 : 1))
  );
  assert.deepEqual(watchlists, built.watchlists);
});
