/**
 * Pocket Omaha — the stock entry point.
 *
 * One ticker in, one scored model out. This is what a host calls: the PWA
 * server through `server/finance.js`, and Android through QuickJS.
 *
 * It orchestrates and decides; it does not fetch or persist. Upstream requests
 * go through the provider seam, storage through the store contract, and both
 * are supplied by the host. What stays here is the judgement — which cache tier
 * is still valid, when stale data beats no data, and when a failure must be
 * reported rather than papered over. Those decisions are the ones that must not
 * be made twice in two languages.
 */

import { minutesSince } from './time.js';
import { computeComprehensiveHealth } from './scoring.js';
import { getStore, sectorMedianAssetTurnover } from './store.js';
import {
  getQuote as fetchQuote,
  getStatements as fetchFundamentals,
  getPriceHistory as fetchPriceHistory,
  searchTickers as yahooSearch
} from './providers/index.js';
import { buildModel, applyFxNormalisation } from './model/assemble.js';
import { buildPeHistory } from './model/pe-history.js';
import { toRecord, formatCachedStock } from './model/record.js';

const QUOTE_TTL_MIN = 15;
const FUNDAMENTALS_TTL_HOURS = 24;

/** @see modelObserver call site in getStockData. Tooling only. */
let modelObserver = null;
export function __observeModel(fn) {
  modelObserver = fn;
}

// Was `new Date(ts)`, which V8 reads as local time for the SQLite form the
// cache columns are written in — inflating every age by the host's UTC offset
// and putting the 15-minute quote tier permanently out of reach east of UTC.
// See core/time.js.

// ---------------------------------------------------------------- search

export async function searchStocks(queryStr) {
  const query = (queryStr || '').trim();
  if (!query) return [];
  const upper = query.toUpperCase();

  const cached = getStore().searchCached(query);
  const cachedMap = new Map(cached.map((c) => [c.ticker, c]));

  let live = [];
  try {
    live = await yahooSearch(query);
  } catch (err) {
    console.warn('[Finance] live search failed:', err.message);
  }

  const results = new Map();
  if (cachedMap.has(upper)) {
    results.set(upper, { ...cachedMap.get(upper), isCached: true });
  }

  for (const item of live) {
    const hit = cachedMap.get(item.ticker);
    results.set(item.ticker, {
      ticker: item.ticker,
      name: hit?.name || item.name,
      sector: hit?.sector || item.sector,
      industry: hit?.industry || item.industry,
      exchange: item.exchange,
      quoteType: item.quoteType,
      price: hit?.price ?? null,
      change_pct: hit?.change_pct ?? null,
      health_score: hit?.health_score ?? null,
      isCached: Boolean(hit)
    });
  }

  for (const item of cached) {
    if (!results.has(item.ticker)) {
      results.set(item.ticker, { ...item, isCached: true });
    }
  }

  return [...results.values()].slice(0, 12);
}

// ------------------------------------------------------------ main entry

/**
 * Returns the scored stock, or `null` when the ticker cannot be resolved.
 * Never invents a company: an unknown symbol is an error, not a data point.
 */
export async function getStockData(tickerSymbol, forceRefresh = false) {
  const ticker = tickerSymbol.trim().toUpperCase();
  const cached = readCache(ticker);

  if (!forceRefresh && cached) {
    const quoteFresh = minutesSince(cached.last_fetched_at) < QUOTE_TTL_MIN;
    const fundamentalsFresh =
      cached.financials_fetched_at &&
      minutesSince(cached.financials_fetched_at) < FUNDAMENTALS_TTL_HOURS * 60;
    if (quoteFresh && fundamentalsFresh) return formatCachedStock(cached);
  }

  let quote = null;
  let failure = null;
  try {
    quote = await fetchQuote(ticker);
  } catch (err) {
    failure = err;
    console.warn(`[Finance] quote fetch failed for ${ticker}: ${err.message}`);
  }

  if (!quote) {
    // Offline or rate-limited: serve what we have, clearly marked stale, and
    // say why — a caller that knows the reason can back off instead of asking
    // again immediately.
    if (cached) {
      return formatCachedStock(cached, { stale: true, reason: failure?.kind ?? null });
    }

    // Nothing cached to fall back on. A retryable upstream failure must not be
    // reported as an unresolvable symbol: returning null here surfaces as
    // "No listing found for NVDA", which is a false statement about the world
    // and precisely the class of confident fiction this app exists to avoid.
    // A genuine unknown ticker reaches here with `failure` still null, because
    // fetchQuote returns null rather than throwing for an empty result.
    if (failure?.retryable) throw failure;
    return null;
  }

  // Reuse stored statements when they are still inside their TTL — the
  // fundamentals request is the expensive one and filings change quarterly.
  let fundamentals = null;
  const storedFresh =
    cached?.financials_fetched_at &&
    minutesSince(cached.financials_fetched_at) < FUNDAMENTALS_TTL_HOURS * 60;

  if (!forceRefresh && storedFresh) {
    try {
      const stored = JSON.parse(cached.statements_json || 'null');
      if (stored?.annual?.length) fundamentals = stored;
    } catch {
      fundamentals = null;
    }
  }

  if (!fundamentals) {
    try {
      const [statements, prices] = await Promise.all([
        fetchFundamentals(ticker),
        fetchPriceHistory(ticker).catch(() => [])
      ]);
      fundamentals = { ...statements, priceHistory: prices };
    } catch (err) {
      console.warn(
        `[Finance] fundamentals fetch failed for ${ticker}: ${err.message}`
      );
      try {
        fundamentals = JSON.parse(cached?.statements_json || 'null');
      } catch {
        fundamentals = null;
      }
    }
  }

  if (!fundamentals) {
    fundamentals = {
      annual: [], quarterly: [], priceHistory: [],
      latestReported: {}, reportingCurrency: null
    };
  }

  const model = buildModel(quote, fundamentals);
  await applyFxNormalisation(model);
  model.sectorMedianAssetTurnover = sectorMedianAssetTurnover(quote.sector, ticker);
  const peHistory = buildPeHistory(fundamentals, quote);
  // Only a long enough history is allowed to move the valuation score.
  model.peVsHistoryPct = peHistory.scoreable ? peHistory.vsMedianPct : null;
  model.peHistory = peHistory;

  const score = computeComprehensiveHealth(model);
  // Tooling seam, null on every normal path. The QuickJS spike needs the exact
  // object the scoring engine was handed and the exact object it returned, and
  // that pair cannot be reconstructed from the outside — the model is built up
  // across the four statements above. Retire this when assembly moves to
  // core/ (step 1b) and the recorder can call buildModel directly.
  modelObserver?.(ticker, model, score);
  score.peHistory = peHistory;
  const record = toRecord(ticker, quote, fundamentals, model, score);

  saveStockToCache(record, Boolean(fundamentals.annual.length));
  return formatCachedStock(record);
}

// ------------------------------------------------------------ persistence
//
// Thin adapters over the store contract. They exist so getStockData reads the
// same either side of the move into core/: the host decides where a record
// lives, not this function.

function saveStockToCache(r, hasFundamentals) {
  getStore().save(r, hasFundamentals);
}

function readCache(ticker) {
  return getStore().read(ticker);
}
