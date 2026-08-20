/**
 * Timestamp parsing.
 *
 * The first test is the defect: SQLite writes UTC without a marker, V8 reads
 * that as local time, and the resulting age was wrong by the machine's offset
 * — enough to make the fifteen-minute quote cache unreachable east of UTC.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTimestamp, minutesSince } from './time.js';

const UTC_NOON = Date.UTC(2026, 7, 20, 12, 0, 0);

test('a SQLite datetime is read as UTC, not as local time', () => {
  assert.equal(parseTimestamp('2026-08-20 12:00:00'), UTC_NOON);
});

test('the SQLite form and the ISO form of one instant agree', () => {
  assert.equal(
    parseTimestamp('2026-08-20 12:00:00'),
    parseTimestamp('2026-08-20T12:00:00Z'),
    'the same column holds both forms; they must not disagree'
  );
});

test('a cache age does not shift with the host timezone', () => {
  // The regression in numbers: a five-minute-old quote must read as five
  // minutes old, not as five minutes plus the local offset.
  const fiveMinutesAgo = '2026-08-20 11:55:00';
  assert.equal(minutesSince(fiveMinutesAgo, UTC_NOON), 5);
  assert.ok(
    minutesSince(fiveMinutesAgo, UTC_NOON) < 15,
    'a fresh quote must satisfy the 15-minute cache tier'
  );
});

test('an explicit offset is applied', () => {
  assert.equal(parseTimestamp('2026-08-20T15:00:00+03:00'), UTC_NOON);
  assert.equal(parseTimestamp('2026-08-20T09:00:00-03:00'), UTC_NOON);
  assert.equal(parseTimestamp('2026-08-20T15:00:00+0300'), UTC_NOON);
});

test('fractional seconds and a date alone both parse', () => {
  assert.equal(parseTimestamp('2026-08-20T12:00:00.000Z'), UTC_NOON);
  assert.equal(parseTimestamp('2026-08-20T12:00:00.123Z'), UTC_NOON + 123);
  assert.equal(parseTimestamp('2026-08-20'), Date.UTC(2026, 7, 20));
});

test('numbers and Dates pass through', () => {
  assert.equal(parseTimestamp(UTC_NOON), UTC_NOON);
  assert.equal(parseTimestamp(new Date(UTC_NOON)), UTC_NOON);
});

test('an unreadable timestamp is null, and ages as stale rather than fresh', () => {
  for (const bad of [null, undefined, '', '   ', 'yesterday', 'NaN', {}]) {
    assert.equal(parseTimestamp(bad), null, `parseTimestamp(${String(bad)})`);
  }
  assert.equal(
    minutesSince(null, UTC_NOON),
    Infinity,
    'unknown age must trigger a refetch, never serve as fresh'
  );
});
