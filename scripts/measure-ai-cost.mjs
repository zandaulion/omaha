#!/usr/bin/env node
/**
 * Pocket Omaha — measure the real cost of one AI analysis.
 *
 * Phase 6 of docs/16_ROADMAP.md is blocked on exactly one number: what a
 * credit actually costs to produce. Doc 13 §13 has left it unmeasured since
 * the notification worker was designed, and nothing since has changed that —
 * `generateStockAISummary` has never logged what it spent.
 *
 * This runs the real prompt builder and the real Gemini call — same
 * `core/analysis/prompt.js`, same model, same schema an end user's analysis
 * would use — against a handful of real tickers, and reports the actual
 * `usageMetadata` token counts Gemini returns, priced against the published
 * rate for the configured model.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/measure-ai-cost.mjs [TICKER...]
 *
 * Defaults to five tickers spanning shape: a mega-cap with deep history
 * (AAPL), a lender where several checks are inapplicable (JPM), a foreign
 * filer with FX conversion (NOK), a small-cap with thin history (a genuine
 * edge case for prompt length), and a REIT-shaped filer if one is on hand.
 * Real analyses vary by how much filed history and how many pillars are
 * measurable, so one ticker is not a price point — several are.
 *
 * Costs real money against a real Gemini quota. Five tickers on Flash pricing
 * is on the order of a few cents; nothing here loops or retries beyond what
 * `generateStockAISummary` already does.
 */

import { initDatabase } from '../server/db.js';

const DEFAULT_TICKERS = ['AAPL', 'JPM', 'NOK', 'NOVN.SW', 'O'];

/**
 * Gemini 3.7 Flash, standard tier, per ai.google.dev/gemini-api/docs/pricing
 * as read 2026-08-28. Thinking tokens are billed as output, not separately —
 * the API reports `thoughtsTokenCount` on its own, but the invoice does not.
 *
 * Pinned to today's published number rather than fetched at run time: a
 * pricing page is not an API, and a cost script that silently re-priced
 * itself against a page that changed shape would be worse than one that goes
 * stale visibly and gets a diff when it does.
 */
const PRICING_USD_PER_1M = {
  'gemini-3.7-flash': { input: 0.75, output: 3.75 }
};

function priceFor(model) {
  const rate = PRICING_USD_PER_1M[model];
  if (rate) return rate;
  console.warn(
    `[cost] No pinned rate for "${model}" — add one to PRICING_USD_PER_1M in this ` +
    `script rather than guessing; costs below will read as $0.00.`
  );
  return { input: 0, output: 0 };
}

async function main() {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) {
    console.error(
      'GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. This has to be a real key — ' +
      'the whole point is a real call, not an estimate.'
    );
    process.exit(1);
  }

  initDatabase();
  const { getStockData } = await import('../server/finance.js');
  const { generateStockAISummary } = await import('../server/gemini.js');
  const { getGeminiModel } = await import('../server/gemini.js');

  const tickers = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TICKERS;
  const model = getGeminiModel();
  const rate = priceFor(model);

  console.log(`Model: ${model}`);
  console.log(`Rate:  $${rate.input}/1M input · $${rate.output}/1M output (incl. thinking)`);
  console.log(`Tickers: ${tickers.join(', ')}\n`);

  const rows = [];

  for (const ticker of tickers) {
    process.stdout.write(`${ticker.padEnd(10)} `);
    try {
      const stock = await getStockData(ticker);
      if (!stock) {
        console.log('no listing found — skipped');
        continue;
      }

      // The real function, instrumented from outside rather than modified:
      // a temporary global captures the one response `generateStockAISummary`
      // doesn't currently expose, without changing what ships to a client.
      let usage = null;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (...args) => {
        const res = await originalFetch(...args);
        if (String(args[0]).includes('generativelanguage.googleapis.com')) {
          const clone = res.clone();
          clone.json().then((body) => { usage = body?.usageMetadata ?? null; }).catch(() => {});
        }
        return res;
      };

      const started = Date.now();
      await generateStockAISummary(stock, null);
      const elapsedMs = Date.now() - started;

      globalThis.fetch = originalFetch;

      if (!usage) {
        console.log('call succeeded but no usageMetadata came back — see raw response manually');
        continue;
      }

      const inputTokens = usage.promptTokenCount ?? 0;
      const outputTokens = usage.candidatesTokenCount ?? 0;
      const thinkingTokens = usage.thoughtsTokenCount ?? 0;
      const billedOutput = outputTokens + thinkingTokens;

      const costUsd =
        (inputTokens * rate.input + billedOutput * rate.output) / 1_000_000;

      rows.push({ ticker, inputTokens, outputTokens, thinkingTokens, costUsd, elapsedMs });

      console.log(
        `in ${String(inputTokens).padStart(5)}  out ${String(outputTokens).padStart(4)}  ` +
        `think ${String(thinkingTokens).padStart(4)}  ${elapsedMs.toString().padStart(5)} ms  ` +
        `$${costUsd.toFixed(5)}`
      );
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
    }
  }

  if (!rows.length) {
    console.log('\nNo successful calls — nothing to summarise.');
    return;
  }

  const mean = (key) => rows.reduce((s, r) => s + r[key], 0) / rows.length;
  const max = (key) => Math.max(...rows.map((r) => r[key]));

  console.log('\n--- summary ---');
  console.log(`Successful calls: ${rows.length} of ${tickers.length}`);
  console.log(`Mean input tokens:  ${mean('inputTokens').toFixed(0)}`);
  console.log(`Mean output tokens: ${mean('outputTokens').toFixed(0)} (+ ${mean('thinkingTokens').toFixed(0)} thinking)`);
  console.log(`Mean cost:  $${mean('costUsd').toFixed(5)} per analysis`);
  console.log(`Worst cost: $${max('costUsd').toFixed(5)} per analysis (most expensive of this run)`);
  console.log(
    `\nAt mean cost, a credit priced at $X covers 1 analysis with margin ` +
    `${'X / ' + mean('costUsd').toFixed(4)}. A pack of 10 credits costs Pocket ` +
    `Omaha roughly $${(mean('costUsd') * 10).toFixed(3)} to fulfil.`
  );
}

main();
