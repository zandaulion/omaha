import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLOSSARY, explain } from './glossary.js';

const scoring = readFileSync(new URL('./scoring.js', import.meta.url), 'utf8');

/** Every `name:` the scorer emits for a pillar or a pillar item. */
function scoringNames() {
  return [...new Set([...scoring.matchAll(/name: '([^']+)'/g)].map((m) => m[1]))];
}

/** The display names of the twelve checklist entries. */
function checklistNames() {
  return [...scoring.matchAll(/item\(\d+, '([^']+)'/g)].map((m) => m[1]);
}

test('every scored item on screen has an explanation', () => {
  const missing = scoringNames().filter((n) => !explain(n));
  assert.deepEqual(missing, [],
    `No glossary entry for: ${missing.join(', ')}. A metric shown without one `
    + 'long-presses to nothing.');
});

test('every checklist entry has an explanation', () => {
  const missing = checklistNames().filter((n) => !explain(n));
  assert.deepEqual(missing, [], `No glossary entry for: ${missing.join(', ')}`);
});

test('no entry describes a metric that no longer exists', () => {
  // Keys not tied to a scoring item: the composite, the standalone cards and
  // the internals of the valuation models, none of which carry a `name:`.
  const standalone = new Set([
    'health-score', 'Estimated Fair Value', 'P/E Ratio', 'Current Price', 'Net Cash',
    // Deep-dive ratio cards with no equivalent among the scored items.
    'Price / book', 'Share count YoY', 'Dividend yield', 'Gross margin',
    // DCF sandbox inputs.
    'dcf-growth', 'dcf-terminal-multiple', 'dcf-discount-rate', 'bank-payout',
    'return-on-tangible-equity', 'justified-ptbv', 'margin-of-safety',
    'implied-growth', 'earnings-power', 'cost-of-equity'
  ]);
  const live = new Set([...scoringNames(), ...checklistNames(), ...standalone]);
  const orphans = Object.keys(GLOSSARY).filter((k) => !live.has(k));
  assert.deepEqual(orphans, [],
    `Glossary describes something the app no longer computes: ${orphans.join(', ')}`);
});

test('each entry answers all three questions', () => {
  for (const [key, entry] of Object.entries(GLOSSARY)) {
    assert.ok(entry.title, `${key}: no title`);
    for (const part of ['means', 'matters', 'computes']) {
      assert.ok(entry[part] && entry[part].length > 35,
        `${key}: "${part}" is missing or too short to be worth reading`);
    }
  }
});

test('every label the deep-dive ratio cards render resolves', () => {
  // The cards use short forms; the aliases are what make them land. Listed
  // explicitly because a renamed card would otherwise long-press to nothing.
  const cardLabels = [
    'Return on equity', 'Equity / assets', 'Piotroski F-Score', 'Revenue CAGR',
    'Trailing P/E', 'Price / book', 'Share count YoY', 'Dividend yield',
    'ROIC', 'ROIC − WACC', 'Altman Z-Score', 'FCF conversion', 'Gross margin', 'Net cash'
  ];
  const missing = cardLabels.filter((l) => !explain(l));
  assert.deepEqual(missing, [], `Ratio card label with no entry: ${missing.join(', ')}`);
});

test('the watchlist header pillar labels resolve', () => {
  // Shortened in server/index.js for the aggregate row; they must still explain
  // to the same five pillars.
  const short = ['Solvency', 'Profitability', 'Valuation', 'Growth', 'Capital Return'];
  const missing = short.filter((l) => !explain(l));
  assert.deepEqual(missing, [], `Watchlist pillar label with no entry: ${missing.join(', ')}`);
});

test('an unknown key returns null rather than throwing', () => {
  assert.equal(explain('no-such-metric'), null);
  assert.equal(explain(undefined), null);
});
