/**
 * Pocket Omaha — the full stock pipeline, for embedded hosts.
 *
 * Bundled and handed to QuickJS. It supplies `core/` with the two things it
 * cannot provide itself — a network and a store — and then calls the same
 * `getStockData` the PWA server calls.
 *
 * Everything that decides anything stays on this side: which cache tier is
 * still valid, when stale data beats no data, when a failure must be reported
 * rather than papered over. The host answers questions; it does not make
 * judgements. That is what stops the two clients drifting.
 */

import { installHostFetch } from './web-shim.js';
import { setStore } from '../store.js';
import { getStockData, searchStocks } from '../stock.js';
import { __resetSession } from '../providers/yahoo.js';

installHostFetch();

/**
 * Call a host function, passing and receiving JSON.
 *
 * The bridge moves strings, so everything crosses as JSON. An empty reply is
 * `null` rather than a parse error, which is what a store returns for a cache
 * miss — the commonest answer of all.
 */
async function host(name, payload) {
  const fn = globalThis[name];
  if (typeof fn !== 'function') {
    throw new Error(`Host did not provide ${name}`);
  }
  const raw = await fn(JSON.stringify(payload));
  if (raw === undefined || raw === null || raw === '') return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/**
 * The storage contract, backed by the host.
 *
 * Every method returns a promise, which `core/store.js` documents as allowed
 * precisely so this can exist: Room cannot answer synchronously, and requiring
 * it to would mean blocking a thread on every cache read.
 */
setStore({
  read: (ticker) => host('__storeRead', { ticker }),
  save: (record, hasFundamentals) => host('__storeSave', { record, hasFundamentals }),
  searchCached: (query) => host('__storeSearch', { query }).then((rows) => rows || []),
  sectorFinancials: (sector, excludeTicker) =>
    host('__storeSector', { sector, excludeTicker }).then((rows) => rows || [])
});

/**
 * Fetch, score and cache one ticker.
 *
 * @param {string} ticker
 * @param {{forceRefresh?: boolean, freshSession?: boolean}} [options]
 * @returns the scored stock, or `{ok: false, error}` — failures come back as
 *   values because a rate limit or a dead symbol is ordinary, and `kind` is
 *   what a caller acts on.
 */
export async function stock(ticker, options = {}) {
  // A recorded session begins with a cookie and a crumb, and the module-level
  // session survives between calls, so a replay would otherwise leave those
  // two responses unclaimed. Off by default in production, where reusing a
  // live session for six hours is the point.
  if (options.freshSession === true) __resetSession();

  try {
    const data = await getStockData(ticker, options.forceRefresh === true);
    if (!data) {
      return {
        ok: false,
        ticker,
        error: { kind: 'not_found', message: `No listing found for ${ticker}.` }
      };
    }
    return { ok: true, ticker, data };
  } catch (err) {
    return {
      ok: false,
      ticker,
      error: {
        kind: err?.kind ?? 'unknown',
        message: err?.message ?? String(err),
        status: err?.status ?? null,
        retryAfterMs: err?.retryAfterMs ?? null,
        retryable: err?.retryable ?? false
      }
    };
  }
}

/** Ticker and company-name search, merging cached rows with live results. */
export async function search(query) {
  try {
    return { ok: true, results: await searchStocks(query) };
  } catch (err) {
    return { ok: false, error: { kind: err?.kind ?? 'unknown', message: String(err?.message ?? err) } };
  }
}
