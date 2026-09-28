import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { mergeBackup } from '../core/backup.js';

export function readThesis(ticker) {
  const row = db.prepare('SELECT * FROM theses WHERE ticker = ?').get(ticker.toUpperCase());
  return row ? {
    ticker: row.ticker, conviction: row.conviction, targetBuyPrice: row.target_buy_price,
    coreRationale: row.core_rationale || '', mustRemainTrue: row.must_remain_true || '',
    moatTags: JSON.parse(row.moat_tags_json || '[]'),
    sellTriggers: JSON.parse(row.sell_triggers_json || '[]'),
    journalEntries: JSON.parse(row.journal_entries_json || '[]'), updatedAt: row.updated_at
  } : {
    ticker: ticker.toUpperCase(), conviction: 'high', targetBuyPrice: null,
    coreRationale: '', mustRemainTrue: '', moatTags: [], sellTriggers: [], journalEntries: [], updatedAt: null
  };
}

function writeThesis(thesis) {
  db.prepare(`
    INSERT INTO theses (ticker, conviction, target_buy_price, core_rationale, must_remain_true,
      moat_tags_json, sell_triggers_json, journal_entries_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET conviction=excluded.conviction,
      target_buy_price=excluded.target_buy_price, core_rationale=excluded.core_rationale,
      must_remain_true=excluded.must_remain_true, moat_tags_json=excluded.moat_tags_json,
      sell_triggers_json=excluded.sell_triggers_json, journal_entries_json=excluded.journal_entries_json,
      updated_at=excluded.updated_at
  `).run(thesis.ticker, thesis.conviction, thesis.targetBuyPrice, thesis.coreRationale,
    thesis.mustRemainTrue, JSON.stringify(thesis.moatTags), JSON.stringify(thesis.sellTriggers),
    JSON.stringify(thesis.journalEntries), thesis.updatedAt);
  return thesis;
}

/** Preserve journal entries appended since a form was opened, including reviews. */
export function saveThesis(ticker, input) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = readThesis(ticker);
    const incoming = { ...existing, ...input, ticker: existing.ticker, updatedAt: new Date().toISOString() };
    // A form edit wins its fields, but the shared union preserves append-only
    // history. Equal-millisecond timestamps must not discard the form edit.
    const merged = mergeBackup({ theses: [incoming] }, { theses: [existing] });
    const result = writeThesis({ ...incoming, journalEntries: merged.theses[0].journalEntries });
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function recordReview(ticker, assessment, note = '') {
  if (!['intact', 'watch', 'changed'].includes(assessment) || typeof note !== 'string') {
    throw new TypeError('Choose intact, watch, or changed and provide a text note.');
  }
  // saveThesis reads and unions the current history inside its transaction;
  // this append cannot replace another review or an older journal note.
  return saveThesis(ticker, { journalEntries: [{
    id: randomUUID(), date: new Date().toISOString(), note: note.trim(), kind: 'review', assessment
  }] });
}
