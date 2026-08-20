/**
 * Pocket Omaha — recorded-HTTP replay for the golden model tests.
 *
 * The fixtures are raw upstream responses, captured once and replayed
 * offline. Recording and replaying share the classifier below, because the
 * live URLs are not stable enough to key on directly: the timeseries request
 * carries `period2=<now>` and every authenticated request carries a crumb, so
 * a fixture keyed by exact URL would miss on the very next run.
 *
 * The classifier is deliberately coarse. It identifies *which call in the
 * pipeline this is*, which is the thing that stays constant.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_DIR = path.join(__dirname, '..', 'core', '__fixtures__');

/**
 * Which pipeline call is this URL?
 * @param {string} url
 * @returns {string}
 */
export function classify(url) {
  const u = String(url);
  if (u.includes('fc.yahoo.com')) return 'cookie';
  if (u.includes('getcrumb')) return 'crumb';
  if (u.includes('fundamentals-timeseries')) {
    // The requested `type` list is prefixed per period, so this distinguishes
    // the two statement calls without depending on parameter order.
    return u.includes('type=quarterly') || u.includes('%2Cquarterly') || /[?&]type=quarterly/.test(u)
      ? 'timeseries:quarterly'
      : 'timeseries:annual';
  }
  if (u.includes('quoteSummary')) return 'quoteSummary';
  if (u.includes('recommendationsbysymbol')) return 'peers';
  if (u.includes('/finance/search')) return 'search';
  // FX pairs are charts too, distinguished by the `=X` suffix on the symbol.
  if (u.includes('/chart/')) return /%3DX|=X/.test(u.split('?')[0]) ? 'fx' : 'chart';
  return `other:${u}`;
}

export function fixturePath(ticker, kind) {
  return path.join(FIXTURE_DIR, `${ticker.toUpperCase()}.${kind}.json`);
}

export function loadFixture(ticker) {
  return JSON.parse(fs.readFileSync(fixturePath(ticker, 'http'), 'utf8'));
}

export function hasFixture(ticker) {
  return fs.existsSync(fixturePath(ticker, 'http'));
}

/** A Response stand-in covering only the surface yahoo.js touches. */
function reply(entry) {
  const headers = entry.headers || {};
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    ok: entry.status >= 200 && entry.status < 300,
    status: entry.status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: async () => (typeof entry.body === 'string' ? entry.body : JSON.stringify(entry.body)),
    json: async () => entry.body
  };
}

/**
 * Install a fetch that answers from a fixture and refuses anything else.
 *
 * An unrecorded call throws rather than falling through to the network: a
 * golden test that quietly reaches upstream is not a golden test, and the
 * failure should name the missing key rather than appear as a timeout.
 *
 * @returns {() => void} restore
 */
export function installReplayFetch(fixture) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const key = classify(url);
    const entry = fixture[key];
    if (!entry) {
      throw new Error(
        `No fixture for "${key}". Recorded keys: ${Object.keys(fixture).join(', ')}`
      );
    }
    return reply(entry);
  };
  return () => {
    globalThis.fetch = real;
  };
}

/**
 * Fields that change every run and say nothing about the model.
 * Redacted rather than dropped, so a snapshot still proves they were present.
 */
const VOLATILE = new Set(['last_fetched_at', 'financials_fetched_at', 'generatedAt']);

/** Deep copy with volatile fields replaced and object keys sorted. */
export function normaliseModel(value) {
  if (Array.isArray(value)) return value.map(normaliseModel);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = VOLATILE.has(key) ? '<redacted>' : normaliseModel(value[key]);
    }
    return out;
  }
  return value;
}
