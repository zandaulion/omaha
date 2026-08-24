/**
 * Pocket Omaha — market data provider seam.
 *
 * The single place the data source is chosen. Everything above this line asks
 * for statements and quotes; nothing above it knows the word "Yahoo".
 *
 * This exists because the Yahoo endpoints are unofficial and have already been
 * withdrawn once — the v10 statement modules were hollowed out, which is why
 * ingestion moved to `fundamentals-timeseries`. Doc 13 §8 records the intended
 * migration: SEC EDGAR for statements, which is official, keyless and
 * unlimited, with Yahoo retained for quotes and prices where no free licensed
 * source exists. That migration should be a new file next to `yahoo.js` and a
 * changed line here, not an edit spread across the engine.
 *
 * Statements and quotes are separate entry points on purpose. They fail
 * differently and will not necessarily come from the same provider.
 */

import * as yahoo from './yahoo.js';
import * as edgar from './edgar.js';

/**
 * Active provider per capability. Split rather than a single object so that
 * one capability can move to a new source without the others following.
 */
const quoteSource = yahoo;

/**
 * Statements are a hybrid: EDGAR first, Yahoo behind it.
 *
 * The phase 0 decision in doc 16 resolved doc 14's open question to *hybrid*
 * rather than US-only, and the reason is coverage rather than competition —
 * EDGAR covers SEC registrants, and a holding listed only outside the US has to
 * keep scoring. So this is a new implementation **behind** the seam, not a
 * replacement of it.
 *
 * EDGAR wins where it answers because it returns the number as filed rather
 * than a re-derivation, and labels the reporting currency explicitly per fact —
 * the defect class doc 14 records as having contaminated 7 of 20 tickers.
 *
 * Falling back on *any* EDGAR failure, not only on a missing registrant, is
 * deliberate. A rate limit or an outage should degrade to the older source
 * rather than to no statements at all, which is the same argument doc 13 §8
 * makes in the other direction. The reason is logged either way, because a
 * silent fallback would make a systematic EDGAR failure look like nothing at
 * all while quietly returning every user to the fragile provider.
 */
async function fetchStatementsHybrid(ticker) {
  let reason;
  try {
    const result = await edgar.fetchFundamentals(ticker);
    // An empty result is as useless as an error and is treated as one. A
    // registrant whose filings carry none of the concepts the engine reads is
    // better served by Yahoo than by a page of blanks.
    if (result?.annual?.length) return result;
    reason = 'no usable annual periods';
  } catch (err) {
    reason = err?.kind || err?.message || 'error';
    // A company that is not an SEC registrant is the expected case, not a
    // fault: it is precisely what the fallback exists for.
    if (err?.kind !== 'not_found') {
      console.warn(`[Providers] EDGAR statements failed for ${ticker}: ${reason}`);
    }
  }

  console.warn(`[Providers] statements for ${ticker} fall back to Yahoo (${reason})`);
  return yahoo.fetchFundamentals(ticker);
}

/** Annual and quarterly filed statements. */
export const getStatements = (ticker) => fetchStatementsHybrid(ticker);

/** Live price, profile and market-derived multiples. */
export const getQuote = (ticker) => quoteSource.fetchQuote(ticker);

/** Monthly closes, five years back, for the historical P/E range. */
export const getPriceHistory = (ticker) => quoteSource.fetchPriceHistory(ticker);

/** Spot FX, for the traded-versus-reporting currency split. */
export const getFxRate = (from, to) => quoteSource.fetchFxRate(from, to);

/** Ticker and company-name search. */
export const searchTickers = (query) => quoteSource.search(query);

/** Suggested peers for the comparison view. */
export const getPeers = (ticker) => quoteSource.fetchPeers(ticker);

export { IngestError } from '../errors.js';
