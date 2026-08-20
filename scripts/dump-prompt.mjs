#!/usr/bin/env node
/**
 * Render exactly what Gemini receives, as Markdown.
 *
 *   npm run prompt            -- uses NOK, which exercises the currency split
 *   npm run prompt -- AAPL    -- any ticker
 *   npm run prompt -- BAC out.md
 *
 * Makes no call to Gemini. It does fetch the ticker's data, so the payload
 * shown is the real one rather than a fixture — the point of reading a prompt
 * is to see what the model actually gets, not what we intended it to get.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ticker = (process.argv[2] || 'NOK').toUpperCase();
const outPath = process.argv[3] || path.join(__dirname, '..', `gemini-prompt.${ticker}.md`);

const { initDatabase, db } = await import('../server/db.js');
initDatabase();

const { getStockData } = await import('../server/finance.js');
const { buildPrompt, RESPONSE_SCHEMA, getGeminiModel } = await import('../server/gemini.js');

const stock = await getStockData(ticker);
if (!stock) {
  console.error(`No listing found for ${ticker}.`);
  process.exit(1);
}

const thesis =
  db.prepare('SELECT * FROM theses WHERE ticker = ?').get(ticker) || null;

const prompt = buildPrompt(stock, thesis);

// Roughly 3.7 characters per token for English prose mixed with JSON. Close
// enough to reason about budget; not a substitute for the API's own count.
const est = (s) => Math.round(s.length / 3.7);

const instructions = prompt.slice(0, prompt.indexOf('## Data package'));
const payload = prompt.slice(prompt.indexOf('## Data package'));

const generationConfig = {
  responseMimeType: 'application/json',
  responseSchema: '(see below)',
  temperature: 0.2,
  thinkingConfig: { thinkingBudget: 4096 },
  maxOutputTokens: 16384
};

const md = `# Gemini prompt — ${stock.name} (${stock.ticker})

> Generated from the live code by \`npm run prompt -- ${ticker}\`.
> This is the exact text sent to the model, not a summary of it.
> Regenerate rather than editing: the source of truth is
> \`buildPrompt\` and \`buildComprehensivePayload\` in \`server/gemini.js\`.

| | |
|---|---|
| Model | \`${getGeminiModel()}\` |
| Generated | ${new Date().toISOString()} |
| Fundamentals as filed to | ${stock.summary?.metrics?.fiscalPeriodEnd || 'n/a'} |
| Reporting currency | ${stock.financials?.reportingCurrency || stock.currency} |
| Trading currency | ${stock.currency} |
| Instructions | ~${est(instructions).toLocaleString()} tokens |
| Data package | ~${est(payload).toLocaleString()} tokens |
| **Total prompt** | **~${est(prompt).toLocaleString()} tokens** |

---

## 1. Generation config

The output shape is enforced server-side by \`responseSchema\`, so it is part of
the contract rather than a request. That is why the prompt below contains no
JSON-shape boilerplate.

\`\`\`json
${JSON.stringify(generationConfig, null, 2)}
\`\`\`

---

## 2. The prompt, exactly as sent

Everything between the rules below is one string in the \`contents\` array.

---

\`\`\`text
${prompt}
\`\`\`

---

## 3. Response schema

Enforced by the API. Enums, required fields and array bounds are guaranteed,
not requested — a malformed response is not a failure mode.

\`\`\`json
${JSON.stringify(RESPONSE_SCHEMA, null, 2)}
\`\`\`

---

## 4. What to look for when reviewing this

The prompt is doing four jobs. Each is worth checking separately:

1. **Grounding.** Does \`readMeFirst.provenance\` list everything the engine had
   to derive, carry forward, clamp or exclude? Anything missing there is
   something the model will present with unearned confidence.
2. **Completeness.** Is every figure the prompt asks the model to analyse
   actually in the package? The instructions once asked for an assessment of
   free cash flow yield that was not being sent.
3. **Units and currency.** Money is pre-formatted in the reporting currency and
   array units are carried in the key names. Both were fixed after the model
   read an operating margin array as dollar amounts, and after an entire EUR
   balance sheet went out labelled in dollars.
4. **The separation of measurement from recall.** \`contextFromModelKnowledge\`
   exists so the model can say useful things the filings do not contain —
   regulatory history, competitive position — without those claims blending
   into the measured analysis. If that section is empty for a company you know
   has a story, the instruction is not landing.
`;

fs.writeFileSync(outPath, md);
console.log(`${ticker}: ~${est(prompt).toLocaleString()} prompt tokens -> ${outPath}`);
