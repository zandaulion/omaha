/**
 * Pocket Omaha — reading and writing personal data for backup and restore.
 *
 * The translation between SQLite rows and the interchange shape defined in
 * `core/backup.js`. Kept out of the route handler so the round trip can be
 * tested without an HTTP client, and so the Android host has an obvious
 * counterpart to write against Room.
 */

import { db } from './db.js';

/** Everything a backup carries, as `core/backup.js` expects it. */
export function readPersonalData() {
  return {
    theses: db.prepare('SELECT * FROM theses').all().map((t) => ({
      ticker: t.ticker,
      conviction: t.conviction,
      targetBuyPrice: t.target_buy_price,
      coreRationale: t.core_rationale,
      moatTags: JSON.parse(t.moat_tags_json || '[]'),
      sellTriggers: JSON.parse(t.sell_triggers_json || '[]'),
      journalEntries: JSON.parse(t.journal_entries_json || '[]'),
      updatedAt: t.updated_at
    })),
    watchlists: db.prepare('SELECT * FROM watchlists').all().map((w) => ({
      id: w.id,
      name: w.name,
      tickers: JSON.parse(w.tickers_json || '[]'),
      is_default: Boolean(w.is_default),
      updatedAt: w.updated_at
    }))
  };
}

/**
 * Write a merged result back.
 *
 * All or nothing. A restore that half-applied would leave someone unable to
 * say what they now have, which is worse than one that plainly failed.
 *
 * @param {{theses: object[], watchlists: object[]}} merged
 */
export function writePersonalData(merged) {
  const now = new Date().toISOString();

  db.prepare('BEGIN').run();
  try {
    const writeThesis = db.prepare(`
      INSERT INTO theses (ticker, conviction, target_buy_price, core_rationale,
                          moat_tags_json, sell_triggers_json, journal_entries_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ticker) DO UPDATE SET
        conviction=excluded.conviction,
        target_buy_price=excluded.target_buy_price,
        core_rationale=excluded.core_rationale,
        moat_tags_json=excluded.moat_tags_json,
        sell_triggers_json=excluded.sell_triggers_json,
        journal_entries_json=excluded.journal_entries_json,
        updated_at=excluded.updated_at
    `);
    for (const t of merged.theses) {
      writeThesis.run(
        t.ticker, t.conviction, t.targetBuyPrice, t.coreRationale,
        JSON.stringify(t.moatTags), JSON.stringify(t.sellTriggers),
        JSON.stringify(t.journalEntries),
        // The merge decided which version won; preserving its timestamp is
        // what makes a repeated import a no-op. Stamping `now` here would make
        // every import look like the newest edit.
        t.updatedAt || now
      );
    }

    const writeList = db.prepare(`
      INSERT INTO watchlists (id, name, tickers_json, is_default, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        tickers_json=excluded.tickers_json,
        is_default=excluded.is_default,
        updated_at=excluded.updated_at
    `);
    for (const w of merged.watchlists) {
      writeList.run(
        w.id, w.name, JSON.stringify(w.tickers), w.is_default ? 1 : 0,
        w.updatedAt || now
      );
    }

    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}
