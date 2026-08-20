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

import {
  classify,
  FIXTURE_DIR,
  fixturePath,
  normaliseModel,
  loadFixture,
  installReplayFetch
} from '../tools/fixture-http.js';

const argv = process.argv.slice(2);
// --replay regenerates the derived fixtures from bytes already captured,
// without touching the network. Use it whenever only the derived shape has
// changed: a live re-record moves the price and churns every snapshot, which
// buries the change you actually meant to make.
const replay = argv.includes('--replay');
const tickers = argv
  .filter((a) => !a.startsWith('--'))
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);

if (!tickers.length) {
  console.error('Usage: node scripts/record-fixture.mjs [--replay] <TICKER> [TICKER...]');
  process.exit(1);
}

// Must be set before db.js is imported, since it resolves DATA_DIR at load.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omaha-fixture-'));
process.env.DATA_DIR = scratch;

const { initDatabase, db } = await import('../server/db.js');
const { getStockData, __observeModel } = await import('../server/finance.js');
const { __resetSession } = await import('../core/providers/yahoo.js');
const { ingest } = await import('../core/host/ingest.js');

// The QuickJS spike runs core/scoring.js against this exact input and must
// return this exact output. Captured here because the model is assembled
// across several steps inside getStockData (doc 13 §17).
let scoringPair = null;
__observeModel((_ticker, model, score) => {
  // Deep copy, not a reference. getStockData keeps working on both objects
  // after this returns — it assigns score.peHistory and hands the model to
  // toRecord — and a reference would capture those later mutations as though
  // the scoring engine had produced them. The fixture would then demand an
  // output the engine cannot return on its own, and the parity gate would
  // fail against a contract nothing satisfies.
  scoringPair = {
    input: JSON.parse(JSON.stringify(model)),
    output: JSON.parse(JSON.stringify(score))
  };
});

initDatabase();
fs.mkdirSync(FIXTURE_DIR, { recursive: true });

const realFetch = globalThis.fetch;

for (const ticker of tickers) {
  const recorded = {};

  // The session is module-level and survives between tickers, so without this
  // every fixture after the first would be recorded with no cookie/crumb call
  // and would fail on replay the moment a test established a fresh session.
  __resetSession();

  let restoreReplay = null;
  if (replay) {
    restoreReplay = installReplayFetch(loadFixture(ticker));
  } else {
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

      // The cookie call is only interesting for its Set-Cookie header, and
      // that header is a live session token — replaced rather than recorded.
      const headers = {};
      if (key === 'cookie') headers['set-cookie'] = 'RECORDED=1';

      // First write wins: the pipeline may repeat a call, and the first is the
      // one the rest of the run was built from.
      if (!(key in recorded)) recorded[key] = { status: res.status, headers, body };
      return res;
    };
  }

  try {
    const model = await getStockData(ticker, true);

    if (!model) {
      console.error(`${ticker}: no model produced — not written.`);
      continue;
    }

    // In replay mode the captured bytes are the input, not an output.
    if (!replay) {
      fs.writeFileSync(fixturePath(ticker, 'http'), JSON.stringify(recorded, null, 2));
    }
    fs.writeFileSync(
      fixturePath(ticker, 'model'),
      JSON.stringify(normaliseModel(model), null, 2)
    );

    if (!scoringPair) {
      console.error(`${ticker}: scoring pair not captured — served from cache?`);
    } else {
      fs.writeFileSync(
        fixturePath(ticker, 'scoring-input'),
        JSON.stringify(normaliseModel(scoringPair.input), null, 2)
      );
      fs.writeFileSync(
        fixturePath(ticker, 'scoring-output'),
        JSON.stringify(normaliseModel(scoringPair.output), null, 2)
      );
      scoringPair = null;
    }

    // What core/host/ingest.js produces from these same bytes. The Android
    // host runs that module under QuickJS and must match this exactly.
    __resetSession();
    const replayForIngest = installReplayFetch(loadFixture(ticker));
    try {
      const ingested = await ingest(ticker);
      fs.writeFileSync(
        fixturePath(ticker, 'ingest'),
        JSON.stringify(normaliseModel(ingested), null, 2)
      );
    } finally {
      replayForIngest();
    }

    const kb = (n) => `${Math.round(n / 1024)} KB`;
    const source = replay
      ? 'replayed'
      : `${Object.keys(recorded).length} calls [${Object.keys(recorded).join(', ')}]`;
    console.log(
      `${ticker}: ${source} -> ` +
      `model ${kb(fs.statSync(fixturePath(ticker, 'model')).size)}, ` +
      `scoring-input ${kb(fs.statSync(fixturePath(ticker, 'scoring-input')).size)}, ` +
      `score ${model.health_score ?? 'null'}`
    );
  } finally {
    if (restoreReplay) restoreReplay();
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
