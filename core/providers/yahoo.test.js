/**
 * Ingestion failure handling.
 *
 * Same convention as scoring.test.js: one test per defect that was actually
 * present, so the fix cannot be quietly undone. Both defects here were found
 * while planning the Android client (doc 13 §9) and both are worse on a phone
 * than on the server — a background sweep that cannot tell a rate limit from a
 * dead ticker retries into the block that caused it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { IngestError, kindForStatus, parseRetryAfter } from '../errors.js';
import { fetchQuote, fetchPeers, search, __resetSession } from './yahoo.js';

// ---------------------------------------------------------------- harness

const realFetch = globalThis.fetch;

/** Minimal Response stand-in — only the surface yahoo.js actually touches. */
function reply(status, body, headers = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body
  };
}

/**
 * Route stubbed responses by URL substring and record every call.
 * `crumbs` is consumed one per getcrumb request so a forced refresh is visible.
 */
function stubFetch({ crumbs = ['crumb1'], data = [] }) {
  const calls = [];
  let crumbIdx = 0;
  let dataIdx = 0;

  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);

    if (u.includes('fc.yahoo.com')) {
      return reply(200, '', { 'set-cookie': 'A=1' });
    }
    if (u.includes('getcrumb')) {
      const c = crumbs[Math.min(crumbIdx, crumbs.length - 1)];
      crumbIdx += 1;
      return reply(200, c);
    }
    const next = data[Math.min(dataIdx, data.length - 1)];
    dataIdx += 1;
    if (typeof next === 'function') return next();
    return next;
  };

  return {
    calls,
    crumbRequests: () => calls.filter((u) => u.includes('getcrumb')).length,
    dataRequests: () => calls.filter((u) => u.includes('quoteSummary')).length
  };
}

function restore() {
  globalThis.fetch = realFetch;
}

const QUOTE_OK = reply(200, {
  quoteSummary: { result: [{ price: { regularMarketPrice: { raw: 10 } } }] }
});

// ---------------------------------------------------------------- defect 1

test('an invalidated crumb re-establishes the session and retries once', async () => {
  __resetSession();
  const spy = stubFetch({
    crumbs: ['stale', 'fresh'],
    data: [reply(403, ''), QUOTE_OK]
  });

  try {
    const quote = await fetchQuote('AAPL');
    assert.equal(quote.price, 10, 'the retry should have succeeded');
    assert.equal(spy.crumbRequests(), 2, 'the session should be re-established');
    assert.equal(spy.dataRequests(), 2, 'exactly one retry, not a loop');
    assert.ok(
      spy.calls.at(-1).includes('crumb=fresh'),
      'the retry must carry the new crumb, not the stale one'
    );
  } finally {
    restore();
  }
});

test('the crumb retry happens at most once', async () => {
  __resetSession();
  const spy = stubFetch({
    crumbs: ['a', 'b', 'c'],
    data: [reply(403, ''), reply(403, '')]
  });

  try {
    await assert.rejects(
      () => fetchQuote('AAPL'),
      (err) => err instanceof IngestError && err.kind === 'unauthorized'
    );
    assert.equal(spy.dataRequests(), 2, 'a persistent 403 must not retry forever');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------- defect 2

test('a rate limit is reported as rate_limited, not as a dead ticker', async () => {
  __resetSession();
  stubFetch({ data: [reply(429, '', { 'retry-after': '120' })] });

  try {
    await assert.rejects(
      () => fetchQuote('AAPL'),
      (err) => {
        assert.ok(err instanceof IngestError);
        assert.equal(err.kind, 'rate_limited');
        assert.equal(err.retryAfterMs, 120_000, 'Retry-After must be honoured');
        assert.equal(err.retryable, true);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('an unknown ticker is not retryable — a 404 is a real answer', async () => {
  __resetSession();
  stubFetch({ data: [reply(404, '')] });

  try {
    await assert.rejects(
      () => fetchQuote('NOSUCHTICKER'),
      (err) => {
        assert.equal(err.kind, 'not_found');
        assert.equal(err.retryable, false, 'retrying a 404 wastes the budget');
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('a transport failure is network, and is retryable', async () => {
  __resetSession();
  globalThis.fetch = async (url) => {
    if (String(url).includes('fc.yahoo.com')) {
      return reply(200, '', { 'set-cookie': 'A=1' });
    }
    if (String(url).includes('getcrumb')) return reply(200, 'c');
    throw new Error('ETIMEDOUT');
  };

  try {
    await assert.rejects(
      () => fetchQuote('AAPL'),
      (err) => {
        assert.equal(err.kind, 'network');
        assert.equal(err.retryable, true);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('peers still degrade to an empty list rather than failing a page load', async () => {
  __resetSession();
  stubFetch({ data: [reply(429, '')] });

  try {
    assert.deepEqual(await fetchPeers('AAPL'), []);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------- helpers

test('status classification distinguishes the cases callers act on', () => {
  assert.equal(kindForStatus(429), 'rate_limited');
  assert.equal(kindForStatus(401), 'unauthorized');
  assert.equal(kindForStatus(403), 'unauthorized');
  assert.equal(kindForStatus(404), 'not_found');
  assert.equal(kindForStatus(500), 'upstream');
});

test('Retry-After is read in both of its wire forms', () => {
  const now = Date.UTC(2026, 7, 20, 12, 0, 0);
  assert.equal(parseRetryAfter('30', now), 30_000, 'delta-seconds');
  assert.equal(
    parseRetryAfter('Thu, 20 Aug 2026 12:02:00 GMT', now),
    120_000,
    'HTTP-date'
  );
  assert.equal(parseRetryAfter(null, now), null);
  assert.equal(parseRetryAfter('', now), null);
  assert.equal(parseRetryAfter('not-a-date', now), null);
  assert.equal(
    parseRetryAfter('Thu, 20 Aug 2026 11:00:00 GMT', now),
    0,
    'a past date means retry now, never a negative delay'
  );
});

// ------------------------------------------------- search: no-match vs down

/**
 * search() used to `return []` once both hosts had failed. An empty list is
 * also what a genuine no-match looks like, so the search view rendered
 * "No matching companies found for AAPL" over a live ticker and offered to
 * add it as though it were unlisted -- a confident false statement produced by
 * a rate limit. The two cases have to be distinguishable at the boundary,
 * because no caller above it can tell them apart afterwards.
 */
test('search: an empty upstream result is still an empty result', async () => {
  stubFetch({ data: [reply(200, { quotes: [] })] });
  try {
    assert.deepEqual(await search('zzzznotarealticker'), []);
  } finally {
    restore();
  }
});

test('search: a rate limit throws instead of reporting no matches', async () => {
  stubFetch({ data: [reply(429, '', { 'retry-after': '30' })] });
  try {
    await assert.rejects(() => search('AAPL'), (err) => {
      assert.ok(err instanceof IngestError, 'expected an IngestError');
      assert.equal(err.kind, 'rate_limited');
      assert.equal(err.retryAfterMs, 30000);
      assert.ok(err.retryable);
      return true;
    });
  } finally {
    restore();
  }
});

test('search: an unreachable host throws rather than returning []', async () => {
  stubFetch({
    data: [() => { throw new Error('ECONNREFUSED'); }]
  });
  try {
    await assert.rejects(() => search('AAPL'), (err) => {
      assert.ok(err instanceof IngestError);
      assert.equal(err.kind, 'network');
      return true;
    });
  } finally {
    restore();
  }
});

test('search: the second host still rescues the first', async () => {
  stubFetch({
    data: [reply(500, ''), reply(200, {
      quotes: [{ symbol: 'AAPL', shortname: 'Apple Inc.', quoteType: 'EQUITY' }]
    })]
  });
  try {
    const out = await search('AAPL');
    assert.equal(out.length, 1);
    assert.equal(out[0].ticker, 'AAPL');
  } finally {
    restore();
  }
});
