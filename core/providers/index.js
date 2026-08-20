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

/**
 * Active provider per capability. Split rather than a single object so that
 * one capability can move to a new source without the others following.
 */
const statementSource = yahoo;
const quoteSource = yahoo;

/** Annual and quarterly filed statements. */
export const getStatements = (ticker) => statementSource.fetchFundamentals(ticker);

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
