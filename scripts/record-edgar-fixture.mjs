/**
 * Record trimmed SEC EDGAR `companyfacts` fixtures.
 *
 * Usage: node scripts/record-edgar-fixture.mjs AAPL NOK JPM
 *
 * ## Why these are trimmed rather than recorded whole
 *
 * A whole `companyfacts` blob is 0.9–7.5 MB — measured 2026-08-24 across the
 * three fixture tickers, with JPM the largest. Committing them intact would
 * take `core/__fixtures__/` from 572 KB to roughly 12 MB, which is a twentyfold
 * increase in checkout size to exercise a parser that reads about thirty tags.
 *
 * So each fixture keeps **every candidate tag the provider might consult**, with
 * **every fact intact**, and drops the several hundred tags it never looks at.
 * That distinction matters: the trimming is by tag, never by fact. The defect
 * this recorder exists to catch is the provider choosing the *wrong tag among
 * several present* — Nokia files both `Revenue` and
 * `RevenueFromContractsWithCustomers`, and picking the first stops its revenue
 * series in 2017 — so dropping the losing candidates would delete the evidence.
 *
 * The `dei` taxonomy is kept whole; it is small and carries the entity metadata.
 *
 * Re-record when the tag maps in `core/providers/edgar.js` gain a candidate,
 * since a tag the fixture never captured cannot be selected in a test.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { US_GAAP, IFRS, EDGAR_USER_AGENT } from '../core/providers/edgar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../core/__fixtures__');

const KEEP = new Set([
  ...Object.values(US_GAAP).flatMap(([, tags]) => tags),
  ...Object.values(IFRS).flatMap(([, tags]) => tags)
]);

async function edgarJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': EDGAR_USER_AGENT, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function main() {
  const tickers = process.argv.slice(2).map((t) => t.toUpperCase());
  if (!tickers.length) {
    console.error('usage: node scripts/record-edgar-fixture.mjs AAPL NOK JPM');
    process.exit(1);
  }

  const map = await edgarJson('https://www.sec.gov/files/company_tickers.json');
  const cikByTicker = new Map(
    Object.values(map).map((r) => [String(r.ticker).toUpperCase(), String(r.cik_str)])
  );

  for (const ticker of tickers) {
    const cik = cikByTicker.get(ticker);
    if (!cik) {
      console.error(`${ticker}: not an SEC registrant, skipping`);
      continue;
    }

    // One request per company, spaced well inside EDGAR's 10/sec budget.
    await new Promise((r) => setTimeout(r, 400));
    const full = await edgarJson(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, '0')}.json`
    );

    const facts = {};
    let kept = 0;
    let dropped = 0;
    for (const [taxonomy, tags] of Object.entries(full.facts || {})) {
      if (taxonomy !== 'us-gaap' && taxonomy !== 'ifrs-full' && taxonomy !== 'dei') {
        dropped += Object.keys(tags).length;
        continue;
      }
      for (const [tag, entry] of Object.entries(tags)) {
        if (taxonomy !== 'dei' && !KEEP.has(tag)) {
          dropped++;
          continue;
        }
        facts[taxonomy] ??= {};
        facts[taxonomy][tag] = entry;
        kept++;
      }
    }

    const trimmed = { cik: full.cik, entityName: full.entityName, facts };
    const file = path.join(OUT_DIR, `${ticker}.edgar.json`);
    fs.writeFileSync(file, JSON.stringify(trimmed));

    const size = fs.statSync(file).size;
    console.log(
      `${ticker.padEnd(5)} kept ${String(kept).padStart(3)} tags, dropped ${dropped}` +
        `  →  ${(size / 1024).toFixed(0)} KB`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
