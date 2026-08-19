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

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_cache (
      ticker TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sector TEXT,
      industry TEXT,
      price REAL NOT NULL,
      change_pct REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      market_cap REAL,
      health_score INTEGER NOT NULL,
      altman_z REAL NOT NULL,
      piotroski_score INTEGER NOT NULL,
      roic_pct REAL NOT NULL,
      fcf_conversion_pct REAL NOT NULL,
      net_cash_b REAL NOT NULL,
      financials_json TEXT NOT NULL,
      checklist_json TEXT NOT NULL,
      catalysts_json TEXT NOT NULL,
      risks_json TEXT NOT NULL,
      pillars_json TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      last_fetched_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_stock_cache_health ON stock_cache(health_score);

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
      device_id INTEGER,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
    );

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
