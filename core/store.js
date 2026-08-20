/**
 * Pocket Omaha — the storage contract `core/` depends on.
 *
 * `core/` computes; it does not persist. Everything it needs from storage is
 * the four calls below, and each host supplies them: SQLite behind `node:sqlite`
 * on the PWA server, Room on Android. Nothing above this line knows which.
 *
 * The split is drawn so that **queries** live in the host and **arithmetic**
 * lives here. `sectorFinancials` returns rows rather than a median, because a
 * median is a calculation and calculations are what must not be written twice.
 * A host that computed the median itself would be a second implementation of a
 * scoring input, which is exactly the drift doc 13 exists to prevent.
 *
 * Deliberately not a class or an interface: there is one store per process, it
 * is chosen at startup, and threading it through every call site would be
 * ceremony without a second implementation to justify it.
 *
 * **Every method may return a promise.** SQLite answers synchronously and Room
 * does not, and `core/` awaits either without caring — `await` on a plain value
 * is a no-op, so the Node host needed no change when Android arrived. Writing
 * the contract as synchronous would have forced the Android side to block a
 * thread on every cache read.
 */

/**
 * @typedef {object} StockStore
 * @property {(ticker: string) => object|null} read
 *   The cached row for a ticker, or null. Shape is the `stock_cache` row.
 * @property {(record: object, hasFundamentals: boolean) => void} save
 *   Upsert a scored record. `hasFundamentals` decides whether the statement
 *   timestamp advances — a quote-only refresh must not make stale statements
 *   look fresh.
 * @property {(query: string) => object[]} searchCached
 *   Locally known tickers matching a query, best match first.
 * @property {(sector: string, excludeTicker: string) => object[]} sectorFinancials
 *   Parsed `financials` objects for other tickers in a sector. Used for the
 *   sector-relative asset turnover comparison.
 */

/** @type {StockStore|null} */
let active = null;

/**
 * Install the host's storage implementation. Call once, at startup, before
 * anything asks for a stock.
 *
 * @param {StockStore} impl
 */
export function setStore(impl) {
  const required = ['read', 'save', 'searchCached', 'sectorFinancials'];
  const missing = required.filter((m) => typeof impl?.[m] !== 'function');
  if (missing.length) {
    throw new Error(`Store is missing: ${missing.join(', ')}`);
  }
  active = impl;
}

/**
 * @returns {StockStore}
 */
export function getStore() {
  if (!active) {
    throw new Error(
      'No store configured. The host must call setStore() before requesting a ' +
      'stock — see server/store.js for the SQLite implementation.'
    );
  }
  return active;
}

/** Test seam: forget the installed store. */
export function __clearStore() {
  active = null;
}

/**
 * Median asset turnover across a sector's other constituents.
 *
 * Lives here rather than in the host because it is a scoring input: the
 * threshold a company is judged against is either the sector median or an
 * absolute figure, and which one is used changes a checklist result.
 *
 * Returns null below three usable peers — a "median" of two is a coin toss
 * dressed as a benchmark, and the engine's rule is that an unmeasurable
 * comparison is withheld rather than approximated.
 *
 * @param {string|null} sector
 * @param {string} excludeTicker
 * @returns {number|null}
 */
export async function sectorMedianAssetTurnover(sector, excludeTicker) {
  if (!sector) return null;

  let rows;
  try {
    rows = await getStore().sectorFinancials(sector, excludeTicker);
  } catch (err) {
    console.warn('[Store] sector lookup failed:', err.message);
    return null;
  }

  const turnovers = [];
  for (const f of rows || []) {
    if (f && f.revenue > 0 && f.totalAssets > 0) {
      turnovers.push(f.revenue / f.totalAssets);
    }
  }
  if (turnovers.length < 3) return null;

  turnovers.sort((a, b) => a - b);
  const mid = Math.floor(turnovers.length / 2);
  return turnovers.length % 2
    ? turnovers[mid]
    : (turnovers[mid - 1] + turnovers[mid]) / 2;
}
