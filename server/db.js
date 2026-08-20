import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'omaha.db');
export const db = new DatabaseSync(DB_PATH);

// Pragmas for performance
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA foreign_keys = ON;');

/**
 * The v1 stock_cache declared health_score, altman_z, roic_pct and friends as
 * NOT NULL, which the rewritten engine cannot honour — an unmeasurable metric
 * is now null rather than a fabricated number. SQLite cannot relax NOT NULL in
 * place, so the table is rebuilt. Nothing of value is lost: every row is
 * derived data that will be re-fetched, and every row written by the old
 * engine contains the fabricated values this rewrite exists to remove.
 */
function migrateStockCache() {
  let columns;
  try {
    columns = db.prepare('PRAGMA table_info(stock_cache)').all();
  } catch {
    return;
  }
  if (!columns.length) return;

  const needsRebuild =
    !columns.some((c) => c.name === 'statements_json') ||
    columns.some((c) => c.name === 'health_score' && c.notnull === 1);

  if (needsRebuild) {
    console.log('[DB] Rebuilding stock_cache for the nullable-metric schema.');
    db.exec('DROP TABLE IF EXISTS stock_cache;');
  }
}

/** Additive migration for tables that already exist in a deployed database. */
function addColumnIfMissing(table, column, definition) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.length || cols.some((c) => c.name === column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    console.log(`[DB] Added ${table}.${column}`);
  } catch (err) {
    console.warn(`[DB] Could not add ${table}.${column}:`, err.message);
  }
}

export function initDatabase() {
  migrateStockCache();
  addColumnIfMissing('invites', 'revoked', 'INTEGER DEFAULT 0');
  addColumnIfMissing('stock_snapshots', 'peg_ratio', 'REAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_cache (
      ticker TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sector TEXT,
      industry TEXT,
      price REAL NOT NULL,
      change_pct REAL,
      currency TEXT DEFAULT 'USD',
      market_cap REAL,
      health_score INTEGER,
      altman_z REAL,
      piotroski_score INTEGER,
      roic_pct REAL,
      fcf_conversion_pct REAL,
      net_cash_b REAL,
      financials_json TEXT NOT NULL,
      checklist_json TEXT NOT NULL,
      catalysts_json TEXT NOT NULL,
      risks_json TEXT NOT NULL,
      pillars_json TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      statements_json TEXT,
      last_fetched_at TEXT DEFAULT (datetime('now')),
      financials_fetched_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_stock_cache_health ON stock_cache(health_score);
    CREATE INDEX IF NOT EXISTS idx_stock_cache_sector ON stock_cache(sector);

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now')),
      revoked INTEGER DEFAULT 0,
      has_push INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      code TEXT,
      url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      revoked INTEGER DEFAULT 0,
      device_id INTEGER,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
    );

    -- Codes must be unique: a duplicate would leave one invite permanently
    -- unredeemable, since the lookup returns whichever row it finds first.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_code
      ON invites(code) WHERE code IS NOT NULL;

    CREATE TABLE IF NOT EXISTS theses (
      ticker TEXT PRIMARY KEY,
      conviction TEXT DEFAULT 'high',
      target_buy_price REAL,
      core_rationale TEXT,
      moat_tags_json TEXT DEFAULT '[]',
      sell_triggers_json TEXT DEFAULT '[]',
      journal_entries_json TEXT DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_active TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS watchlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tickers_json TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Last evaluated state per ticker. The alert engine compares against this
    -- to distinguish a real fundamental change from a first sighting.
    CREATE TABLE IF NOT EXISTS stock_snapshots (
      ticker TEXT PRIMARY KEY,
      health_score INTEGER,
      checklist_json TEXT,
      altman_z REAL,
      piotroski_score INTEGER,
      current_ratio REAL,
      gross_margin REAL,
      pe_percentile INTEGER,
      peg_ratio REAL,
      share_change REAL,
      captured_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      notify_earnings_filings INTEGER DEFAULT 1,
      notify_red_flags INTEGER DEFAULT 1,
      notify_margin_of_safety INTEGER DEFAULT 1,
      notify_capital_returns INTEGER DEFAULT 0,
      notify_sunday_digest INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS notification_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT,
      alert_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      url TEXT,
      read INTEGER DEFAULT 0,
      delivered_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_notification_history_time
      ON notification_history(delivered_at DESC);

    CREATE TABLE IF NOT EXISTS ai_summaries (
      ticker TEXT PRIMARY KEY,
      summary_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Initialize starter watchlists if not present
  const count = db.prepare('SELECT COUNT(*) as count FROM watchlists').get();
  if (!count || count.count === 0) {
    const insertWatchlist = db.prepare(`
      INSERT INTO watchlists (id, name, tickers_json, is_default, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);

    insertWatchlist.run(
      'compounders',
      'The Compounders',
      JSON.stringify(['AAPL', 'MSFT', 'GOOGL', 'BRK-B', 'NVDA']),
      1
    );

    insertWatchlist.run(
      'ai-semis',
      'AI & Semiconductors',
      JSON.stringify(['NVDA', 'MSFT', 'GOOGL', 'TSLA', 'AAPL']),
      0
    );

    insertWatchlist.run(
      'aristocrats',
      'Defensive Aristocrats',
      JSON.stringify(['BRK-B', 'MSFT', 'AAPL', 'GOOGL']),
      0
    );

    insertWatchlist.run(
      'under-20',
      'Promising Under $20',
      JSON.stringify(['BTG', 'STNE', 'VALE', 'ERIC', 'BMBL', 'PBR', 'NOK', 'PAGS', 'KVUE', 'PATH', 'SBSW', 'LYFT', 'TAL', 'IQ', 'NU', 'AES', 'GRAB', 'NIO', 'SOFI', 'RKT']),
      0
    );
  }
}
