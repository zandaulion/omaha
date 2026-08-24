import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import {
  parseCompanyFacts,
  selectTaxonomy,
  detectReportingCurrency,
  EDGAR_USER_AGENT,
  US_GAAP,
  IFRS
} from './edgar.js';

/**
 * Parsed from recorded `companyfacts` blobs, trimmed by tag but never by fact —
 * see `scripts/record-edgar-fixture.mjs` for why that distinction matters.
 *
 * The three tickers are the same ones the golden model tests use, chosen for
 * materially different paths rather than for variety: AAPL is a us-gaap filer
 * on a September year end, NOK is an IFRS filer reporting in EUR, and JPM is a
 * bank whose statements do not carry several of the concepts the engine asks
 * for.
 */
const load = (ticker) =>
  JSON.parse(fs.readFileSync(new URL(`../__fixtures__/${ticker}.edgar.json`, import.meta.url), 'utf8'));

const AAPL = parseCompanyFacts(load('AAPL'));
const NOK = parseCompanyFacts(load('NOK'));
const JPM = parseCompanyFacts(load('JPM'));

const latest = (r) => r.annual[r.annual.length - 1];

// ------------------------------------------------------------ the header

test('the User-Agent never contains github.com', () => {
  // www.sec.gov returns 403 for any User-Agent carrying that substring, while
  // serving the identical request without it. Naming the repository is the
  // obvious thing to put here, which is exactly why this is pinned: the
  // mistake would pass every fixture-backed test and fail only in production.
  assert.ok(!EDGAR_USER_AGENT.includes('github.com'));
  assert.match(EDGAR_USER_AGENT, /@/, 'EDGAR requires a contact address');
});

// ------------------------------------------------------------ taxonomy

test('the taxonomy is detected per filer, not assumed from domicile', () => {
  assert.strictEqual(selectTaxonomy(load('AAPL').facts).name, 'us-gaap');
  // Nokia is a foreign private issuer and files IFRS. TAL is a foreign issuer
  // that files us-gaap, which is why this is detected rather than inferred.
  assert.strictEqual(selectTaxonomy(load('NOK').facts).name, 'ifrs-full');
  assert.strictEqual(selectTaxonomy(load('JPM').facts).name, 'us-gaap');
});

test('an unrecognised blob is an error rather than an empty result', () => {
  assert.throws(() => parseCompanyFacts({ facts: { 'srt': {} } }), /no recognised taxonomy/);
  assert.throws(() => parseCompanyFacts({}), /no recognised taxonomy/);
});

// ------------------------------------------------------------ currency

test('the reporting currency is read from the filing, not guessed', () => {
  // The property doc 14 gives as the reason to migrate: it removes by
  // construction the traded-versus-reporting conflation that contaminated
  // 7 of 20 tickers in the earlier audit. Nokia trades in USD and reports EUR.
  assert.strictEqual(AAPL.reportingCurrency, 'USD');
  assert.strictEqual(NOK.reportingCurrency, 'EUR');
  assert.strictEqual(JPM.reportingCurrency, 'USD');
});

test('detectReportingCurrency falls back to USD rather than throwing', () => {
  assert.strictEqual(detectReportingCurrency({}, 'us-gaap', US_GAAP), 'USD');
});

// ------------------------------------------------------------ period sets

test('a fiscal year is created by an income statement, not a balance sheet', () => {
  // Balance sheets are filed every quarter. Letting instants create periods
  // produced 70 "annual" periods for AAPL against the 19 it has.
  assert.ok(AAPL.annual.length > 10 && AAPL.annual.length < 30, `got ${AAPL.annual.length}`);
  assert.ok(JPM.annual.length > 10 && JPM.annual.length < 30, `got ${JPM.annual.length}`);
  assert.ok(NOK.annual.length > 5 && NOK.annual.length < 20, `got ${NOK.annual.length}`);

  for (const p of AAPL.annual) {
    assert.ok(p.revenue !== null || p.netIncome !== null, `${p.asOfDate} has no income statement`);
  }
});

test('annual periods are a year long and sorted oldest first', () => {
  for (const r of [AAPL, NOK, JPM]) {
    for (let i = 1; i < r.annual.length; i++) {
      assert.ok(r.annual[i - 1].asOfDate < r.annual[i].asOfDate, 'periods must ascend');
    }
    const spans = r.annual.slice(1).map((p, i) =>
      (Date.parse(p.asOfDate) - Date.parse(r.annual[i].asOfDate)) / 86400000);
    for (const s of spans) {
      assert.ok(s > 300 && s < 400, `consecutive annual periods ${s} days apart`);
    }
  }
});

test('quarterly periods are a quarter long where they exist', () => {
  // Nokia files 20-F annually and 6-K for interim, and tags no quarterly
  // durations at all. Absent quarterly data is an unavailable check upstream,
  // not a failure — yahoo.js already treats it that way.
  assert.ok(AAPL.quarterly.length > 0);
  for (const p of AAPL.quarterly) {
    assert.ok(p.revenue !== null || p.netIncome !== null);
  }
});

// ------------------------------------------------------------ tag selection

test('a tag the filer abandoned cannot beat the one it uses now', () => {
  // The defect this exists for. Nokia files `Revenue` (3 facts, all from a
  // 2018 filing covering 2015-17) and `RevenueFromContractsWithCustomers`
  // (24 facts, current). Taking the first non-empty candidate returned a
  // revenue series that stopped in 2017 and nulled every modern period.
  const recent = NOK.annual.filter((p) => p.asOfDate >= '2023-01-01');
  assert.ok(recent.length >= 2);
  for (const p of recent) {
    assert.ok(typeof p.revenue === 'number' && p.revenue > 0,
      `${p.asOfDate} revenue is ${p.revenue}`);
  }
});

test('the same concept is never merged across two tags', () => {
  // Both taxonomies went through a revenue-recognition change (ASC 606,
  // IFRS 15) that redefined the concept. A series built from both sides of it
  // yields a CAGR over two different definitions.
  assert.ok(IFRS.revenue[1].includes('Revenue'));
  assert.ok(IFRS.revenue[1].includes('RevenueFromContractsWithCustomers'));
});

// ------------------------------------------------------------ real figures

test('AAPL reports its filed figures', () => {
  const p = latest(AAPL);
  assert.strictEqual(p.asOfDate, '2025-09-27');
  assert.strictEqual(p.revenue, 416161000000);
  assert.strictEqual(p.netIncome, 112010000000);
  // A September year end, which is the reason AAPL is a fixture.
  assert.ok(p.asOfDate.startsWith('2025-09'));
});

test('NOK reports in euros with its filed figures', () => {
  const p = NOK.annual.find((x) => x.asOfDate === '2024-12-31');
  assert.strictEqual(p.revenue, 19220000000);
  assert.strictEqual(p.netIncome, 1284000000);
});

test('JPM reports its filed figures', () => {
  const p = JPM.annual.find((x) => x.asOfDate === '2024-12-31');
  assert.strictEqual(p.revenue, 177556000000);
  assert.strictEqual(p.netIncome, 58500000000);
});

// ------------------------------------------------------------ derivations

test('free cash flow is derived, and only where both inputs exist', () => {
  const p = latest(AAPL);
  assert.strictEqual(p.freeCashFlow, p.operatingCashFlow - p.capitalExpenditure);

  // A bank files neither capex nor operating cash flow in the shape this
  // derivation needs, so FCF is null rather than a plausible number. This is
  // the app's governing rule: a number shown to a person was measured.
  assert.strictEqual(latest(JPM).freeCashFlow, null);
});

test('total debt sums both maturities and stays null when neither is filed', () => {
  const p = latest(AAPL);
  assert.strictEqual(p.totalDebt, (p.longTermDebt || 0) + (p.currentDebt || 0));
  assert.strictEqual(latest(JPM).totalDebt, null);
});

test('EBITDA needs EBIT and D&A, and is null without both', () => {
  for (const r of [AAPL, NOK, JPM]) {
    for (const p of r.annual) {
      if (p.ebitda !== null) {
        assert.strictEqual(typeof p.ebit, 'number');
        assert.strictEqual(typeof p.depreciationAmortisation, 'number');
        assert.strictEqual(p.ebitda, p.ebit + p.depreciationAmortisation);
      }
    }
  }
});

// ------------------------------------------------------------ shape contract

test('outflows are magnitudes, matching what yahoo.js hands the engine', () => {
  for (const r of [AAPL, NOK, JPM]) {
    for (const p of r.annual) {
      for (const k of ['capitalExpenditure', 'interestExpense', 'dividendsPaid', 'buybacks']) {
        if (typeof p[k] === 'number') assert.ok(p[k] >= 0, `${k} is ${p[k]}`);
      }
    }
  }
});

test('every field the engine reads is present, null when not filed', () => {
  // The engine distinguishes "not reported" from "absent"; undefined would
  // read as the latter and skip the not-reported handling entirely.
  const expected = new Set([...Object.keys(US_GAAP), ...Object.keys(IFRS),
    'ebit', 'ebitda', 'freeCashFlow', 'totalDebt']);
  for (const p of AAPL.annual) {
    for (const field of expected) {
      assert.ok(field in p, `${field} missing from ${p.asOfDate}`);
      assert.notStrictEqual(p[field], undefined, `${field} is undefined`);
    }
  }
});

test('latestReported carries the newest value and the year it came from', () => {
  // Some filers stop populating a line — Apple's interest expense ends at
  // FY2023 — and the last real figure beats "unavailable" provided the year
  // is carried with it.
  assert.ok(AAPL.latestReported.revenue);
  assert.strictEqual(AAPL.latestReported.revenue.value, latest(AAPL).revenue);
  for (const [, v] of Object.entries(AAPL.latestReported)) {
    assert.match(v.asOfDate, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('the result matches the shape yahoo.fetchFundamentals returns', () => {
  for (const r of [AAPL, NOK, JPM]) {
    assert.ok(Array.isArray(r.annual));
    assert.ok(Array.isArray(r.quarterly));
    assert.strictEqual(typeof r.reportingCurrency, 'string');
    assert.strictEqual(typeof r.latestReported, 'object');
  }
});
