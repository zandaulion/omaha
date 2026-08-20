/**
 * Record a ticker's upstream responses as a replayable fixture.
 *
 *   node scripts/record-fixture.mjs NOK
 *   node scripts/record-fixture.mjs NOK AAPL JPM
 *
 * Writes core/__fixtures__/<TICKER>.http.json (raw upstream bodies) and
 * <TICKER>.model.json (the scored model those bodies produce).
 *
 * The point of recording real responses rather than writing fixtures by hand
 * is the same reason `npm run prompt` fetches live data: a hand-made fixture
 * encodes what we believe Yahoo returns, and the defects worth catching are
 * the ones where that belief is wrong. Re-record when the upstream shape
 * changes; do not edit these files.
 *
 * Recording writes into a scratch database so the real cache is untouched.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { classify, FIXTURE_DIR, fixturePath, normaliseModel } from '../tools/fixture-http.js';

const tickers = process.argv.slice(2).map((t) => t.trim().toUpperCase()).filter(Boolean);
if (!tickers.length) {
  console.error('Usage: node scripts/record-fixture.mjs <TICKER> [TICKER...]');
  process.exit(1);
}

// Must be set before db.js is imported, since it resolves DATA_DIR at load.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omaha-fixture-'));
process.env.DATA_DIR = scratch;

const { initDatabase, db } = await import('../server/db.js');
const { getStockData } = await import('../server/finance.js');
const { __resetSession } = await import('../core/providers/yahoo.js');

initDatabase();
fs.mkdirSync(FIXTURE_DIR, { recursive: true });

const realFetch = globalThis.fetch;

for (const ticker of tickers) {
  const recorded = {};

  // The session is module-level and survives between tickers, so without this
  // every fixture after the first would be recorded with no cookie/crumb call
  // and would fail on replay the moment a test established a fresh session.
  __resetSession();

  globalThis.fetch = async (url, init) => {
    const res = await realFetch(url, init);
    const key = classify(url);
    const text = await res.clone().text();

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text; // getcrumb returns a bare token, not JSON
    }

    // The cookie call is only interesting for its Set-Cookie header, and that
    // header is a live session token — replaced rather than recorded.
    const headers = {};
    if (key === 'cookie') headers['set-cookie'] = 'RECORDED=1';

    // First write wins: the pipeline may repeat a call, and the first is the
    // one the rest of the run was built from.
    if (!(key in recorded)) recorded[key] = { status: res.status, headers, body };
    return res;
  };

  try {
    const model = await getStockData(ticker, true);
    globalThis.fetch = realFetch;

    if (!model) {
      console.error(`${ticker}: no model produced — not recorded.`);
      continue;
    }

    fs.writeFileSync(fixturePath(ticker, 'http'), JSON.stringify(recorded, null, 2));
    fs.writeFileSync(
      fixturePath(ticker, 'model'),
      JSON.stringify(normaliseModel(model), null, 2)
    );

    const kb = (n) => `${Math.round(n / 1024)} KB`;
    console.log(
      `${ticker}: ${Object.keys(recorded).length} calls ` +
      `[${Object.keys(recorded).join(', ')}] -> ` +
      `http ${kb(fs.statSync(fixturePath(ticker, 'http')).size)}, ` +
      `model ${kb(fs.statSync(fixturePath(ticker, 'model')).size)}, ` +
      `score ${model.health_score ?? 'null'}`
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

// WAL keeps the database files open, and Windows refuses to unlink an open
// handle — so the connection has to close before the directory can go.
try {
  db.close();
} catch {
  // already closed
}
try {
  fs.rmSync(scratch, { recursive: true, force: true });
} catch (err) {
  console.warn(`Could not remove scratch dir ${scratch}: ${err.code}`);
}
