/**
 * Pocket Omaha — the ingestion entry point for embedded hosts.
 *
 * Bundled and handed to QuickJS. It installs the `fetch` shim, then calls the
 * same `core/providers/` seam the PWA server calls, so the statements an
 * Android device parses come from the same parser that produced every fixture
 * in this repository.
 *
 * Kept separate from `core/stock.js` on purpose. Ingestion needs only a
 * network; the full stock pipeline also needs storage, and proving one at a
 * time is what makes a failure legible.
 */

import { installHostFetch } from './web-shim.js';
import { getStatements, getQuote } from '../providers/index.js';
import { __resetSession } from '../providers/yahoo.js';

installHostFetch();

/**
 * Fetch and parse one ticker.
 *
 * Returns the parsed statements and quote — the two things the model is built
 * from — rather than a scored result, so a failure here is unambiguously an
 * ingestion failure rather than a scoring one.
 *
 * A thrown `IngestError` is flattened to a plain object: the host bridge moves
 * JSON, and an error class does not survive that crossing. `kind` is what
 * callers branch on, so `kind` is what travels.
 *
 * @param {string} ticker
 * @param {{freshSession?: boolean}} [options]
 */
export async function ingest(ticker, options = {}) {
  // Tests replay a recorded session, which begins with a cookie and a crumb.
  // Without this the module-level session from a previous call would be reused
  // and those two recorded responses would go unclaimed.
  if (options.freshSession !== false) __resetSession();

  try {
    const quote = await getQuote(ticker);
    const statements = await getStatements(ticker);
    return { ok: true, ticker, quote, statements };
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
