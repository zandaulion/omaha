/**
 * Pocket Omaha — the SQLite implementation of the `core/` storage contract.
 *
 * Every statement `core/` needs against `stock_cache` lives here. The contract
 * is defined in `core/store.js`; the Android host will implement the same four
 * calls against Room.
 *
 * Failures are logged and degrade to an empty result rather than propagating.
 * A cache is an optimisation: losing it should cost a round trip, not a page.
 */

import { db } from './db.js';

/** The cached row for a ticker, or null. */
function read(ticker) {
  try {
    return db.prepare('SELECT * FROM stock_cache WHERE ticker = ?').get(ticker) || null;
  } catch (err) {
    console.warn('[Store] read failed:', err.message);
    return null;
  }
}

/**
 * Upsert a scored record.
 *
 * `financials_fetched_at` advances only when statements were actually
 * refetched. A quote-only refresh that touched it would make stale statements
 * look fresh, and the 24-hour tier would stop meaning anything.
 */
function save(r, hasFundamentals) {
  try {
    db.prepare(
      `INSERT INTO stock_cache (
         ticker, name, sector, industry, price, change_pct, currency, market_cap,
         health_score, altman_z, piotroski_score, roic_pct, fcf_conversion_pct, net_cash_b,
         financials_json, checklist_json, catalysts_json, risks_json, pillars_json,
         summary_json, statements_json, last_fetched_at, financials_fetched_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?,
         datetime('now'), ${hasFundamentals ? "datetime('now')" : 'NULL'}
       )
       ON CONFLICT(ticker) DO UPDATE SET
         name=excluded.name, sector=excluded.sector, industry=excluded.industry,
         price=excluded.price, change_pct=excluded.change_pct,
         currency=excluded.currency, market_cap=excluded.market_cap,
         health_score=excluded.health_score, altman_z=excluded.altman_z,
         piotroski_score=excluded.piotroski_score, roic_pct=excluded.roic_pct,
         fcf_conversion_pct=excluded.fcf_conversion_pct, net_cash_b=excluded.net_cash_b,
         financials_json=excluded.financials_json, checklist_json=excluded.checklist_json,
         catalysts_json=excluded.catalysts_json, risks_json=excluded.risks_json,
         pillars_json=excluded.pillars_json, summary_json=excluded.summary_json,
         statements_json=excluded.statements_json,
         last_fetched_at=datetime('now')
         ${hasFundamentals ? ", financials_fetched_at=datetime('now')" : ''}`
    ).run(
      r.ticker, r.name, r.sector, r.industry, r.price, r.change_pct, r.currency,
      r.market_cap, r.health_score, r.altman_z, r.piotroski_score, r.roic_pct,
      r.fcf_conversion_pct, r.net_cash_b, r.financials_json, r.checklist_json,
      r.catalysts_json, r.risks_json, r.pillars_json, r.summary_json,
      r.statements_json
    );
  } catch (err) {
    console.warn('[Store] cache write failed:', err.message);
  }
}

/** Locally known tickers matching a query, exact symbol first. */
function searchCached(query) {
  const upper = (query || '').trim().toUpperCase();
  if (!upper) return [];
  try {
    return db
      .prepare(
        `SELECT ticker, name, sector, industry, price, change_pct, health_score
         FROM stock_cache
         WHERE ticker LIKE ? OR UPPER(name) LIKE ?
         ORDER BY CASE WHEN ticker = ? THEN 0 WHEN ticker LIKE ? THEN 1 ELSE 2 END,
                  health_score DESC
         LIMIT 10`
      )
      .all(`${upper}%`, `%${upper}%`, upper, `${upper}%`);
  } catch (err) {
    console.warn('[Store] cache search failed:', err.message);
    return [];
  }
}

/**
 * Parsed `financials` for other tickers in a sector.
 *
 * Returns rows, not a median. The median is a scoring input and is computed in
 * `core/store.js`, so that every host judges a company against the same number.
 */
function sectorFinancials(sector, excludeTicker) {
  try {
    const rows = db
      .prepare(
        `SELECT financials_json FROM stock_cache
         WHERE sector = ? AND ticker != ? AND financials_json IS NOT NULL`
      )
      .all(sector, excludeTicker);

    const out = [];
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.financials_json));
      } catch {
        // A row that will not parse is not a data point.
      }
    }
    return out;
  } catch (err) {
    console.warn('[Store] sector lookup failed:', err.message);
    return [];
  }
}

/** @type {import('../core/store.js').StockStore} */
export const sqliteStore = { read, save, searchCached, sectorFinancials };
