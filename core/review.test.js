import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewQueue } from './review.js';

const now = '2026-09-27T12:00:00Z';
const review = (date, assessment = 'intact') => ({ id: date, kind: 'review', date, assessment, note: '' });
const queue = (thesis = {}, alerts = []) => buildReviewQueue({
  now, companies: [{ ticker: 'ABC', name: 'Example' }], theses: [{ ticker: 'ABC', ...thesis }], alerts
})[0];
const change = at => ({ ticker: 'ABC', title: 'New filing', body: 'Inspect the filing.', severity: 'info', at });

test('missing history asks for reasons and does not infer an assessment', () => {
  const item = queue();
  assert.equal(item.status, 'setup');
  assert.equal(item.assessment, null);
  assert.equal(item.lastReviewedAt, null);
  assert.equal(queue({ mustRemainTrue: 'Recurring customers stay.' }).status, 'unreviewed');
  assert.equal(queue({ sellTriggers: [{ text: 'I lose confidence', triggered: true }] }).status, 'unreviewed');
  assert.match(queue({ sellTriggers: [{ text: 'I lose confidence', triggered: true }] }).reason, /manually flagged/);
});

test('only a dated review acknowledges alerts, never an ordinary journal note or updatedAt', () => {
  const thesis = { coreRationale: 'Reason', updatedAt: now,
    journalEntries: [{ id: 'note', date: now, note: 'Read report' }, review('2026-09-01 10:00:00', 'watch')] };
  const item = queue(thesis, [change('2026-09-01T09:00:00Z'), change('2026-09-01T10:00:00Z'), change('2026-09-01T11:00:00Z')]);
  assert.equal(item.status, 'changed');
  assert.equal(item.changeCount, 1);
  assert.equal(item.assessment, 'watch');
  assert.equal(item.lastReviewedAt, '2026-09-01T10:00:00.000Z');
  assert.equal(queue({ ...thesis, journalEntries: [...thesis.journalEntries, review(now, 'changed')] }, [change('2026-09-01T11:00:00Z')]).status, 'reviewed');
});

test('review cadence starts at 90 days and new changes take priority over a due review', () => {
  const baseline = { coreRationale: 'Reason', journalEntries: [review('2026-06-29T12:00:00Z')] };
  assert.equal(queue(baseline).status, 'due');
  assert.equal(queue({ ...baseline, journalEntries: [review('2026-06-29T12:00:01Z')] }).status, 'reviewed');
  assert.equal(queue(baseline, [change('2026-09-01T00:00:00Z')]).status, 'changed');
});

test('invalid, impossible and future review timestamps cannot hide genuine changes', () => {
  for (const date of ['bad', '2026-02-30T00:00:00Z', '2026-09-01T25:00:00Z', '2099-01-01T00:00:00Z']) {
    const item = queue({ journalEntries: [review(date)] }, [change('2026-09-01T00:00:00Z')]);
    assert.equal(item.lastReviewedAt, null, date);
    assert.equal(item.changeCount, 1, date);
  }
  for (const assessment of [null, 'healthy', undefined]) {
    const item = queue({ journalEntries: [{ ...review(now), assessment }] }, [change('2026-09-01T00:00:00Z')]);
    assert.equal(item.lastReviewedAt, null, 'invalid assessment is not a completed review');
    assert.equal(item.changeCount, 1);
  }
});

test('offsets and SQLite timestamps agree; undated alerts are not presented as new changes', () => {
  const item = queue({ journalEntries: [review('2026-09-01T12:00:00+02:00')] }, [
    change('2026-09-01 10:00:00'), change('2026-09-01 10:00:01'), change('bad')
  ]);
  assert.equal(item.changeCount, 1);
  assert.equal(item.changes[0].at, '2026-09-01T10:00:01.000Z');
});

test('queue prioritises work, includes only watched companies, and deduplicates symbols', () => {
  const result = buildReviewQueue({ now,
    companies: ['DONE', 'NEW', 'FIRST', 'DUE', 'CHANGED', 'changed'].map(ticker => ({ ticker })),
    theses: [
      { ticker: 'DONE', coreRationale: 'reason', journalEntries: [review(now)] },
      { ticker: 'FIRST', coreRationale: 'reason' },
      { ticker: 'DUE', coreRationale: 'reason', journalEntries: [review('2026-01-01T00:00:00Z')] }
    ], alerts: [{ ...change(now), ticker: 'CHANGED' }, { ...change(now), ticker: 'NOT_WATCHED' }]
  });
  assert.deepEqual(result.map(item => item.status), ['changed', 'due', 'setup', 'unreviewed', 'reviewed']);
});
