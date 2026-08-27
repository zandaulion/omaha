/**
 * Record DCF test vectors from `core/analysis/dcf.js`.
 *
 * The sandbox recomputes on every slider drag, so both clients run the model
 * locally: the PWA imports the module directly, and Android reimplements it in
 * Kotlin because a QuickJS round trip per drag frame is not a thing a slider
 * can afford.
 *
 * That is the only deliberate dual implementation in the project, and this file
 * is what keeps it honest. The JS module is the definition; these vectors are
 * its output, and `DcfParityTest` asserts the Kotlin agrees with them. A change
 * to the model that is not mirrored fails the Android build.
 *
 *   node scripts/gen-dcf-vectors.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dcfBaselines, presetAssumptions, projectDcf, dcfVerdict, dcfBlockedReason
} from '../core/analysis/dcf.js';

const OUT = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  'core/__fixtures__/dcf.vectors.json'
);

// Chosen for the edges rather than for coverage: a shrinking business, a
// baseline outside the slider range, a company with more debt than modelled
// value, and a divergence wide enough to be reported as one.
const CASES = [
  { name: 'apple-ish', assumptions: { growthRate: 0.0731, terminalMultiple: 22.4, discountRate: 0.0925 },
    cashFlowBase: 98.767e9, shares: 15e9, netCash: -43.96e9, price: 309.35 },
  { name: 'shrinking', assumptions: { growthRate: -0.10, terminalMultiple: 12, discountRate: 0.11 },
    cashFlowBase: 5e9, shares: 2e9, netCash: -1e9, price: 40 },
  { name: 'baseline-out-of-range', assumptions: { growthRate: 0.90, terminalMultiple: 60, discountRate: 0.02 },
    cashFlowBase: 1e9, shares: 5e8, netCash: 2e9, price: 25 },
  { name: 'debt-heavy', assumptions: { growthRate: 0.02, terminalMultiple: 9, discountRate: 0.15 },
    cashFlowBase: 2e8, shares: 1e9, netCash: -30e9, price: 3 },
  { name: 'net-cash-divergent', assumptions: { growthRate: 0.25, terminalMultiple: 35, discountRate: 0.07 },
    cashFlowBase: 4e9, shares: 1e9, netCash: 60e9, price: 20 }
];

const vectors = CASES.map((c) => {
  const baselines = dcfBaselines({ assumptions: c.assumptions });
  const presets = {};
  for (const preset of ['bear', 'base', 'bull']) {
    const a = presetAssumptions(preset, baselines);
    const projected = projectDcf({
      cashFlowBase: c.cashFlowBase, shares: c.shares, netCash: c.netCash,
      growthPct: a.growthPct, multiple: a.multiple, discountPct: a.discountPct
    });
    const verdict = dcfVerdict(projected.fairValue, c.price);
    presets[preset] = {
      assumptions: a,
      rows: projected.rows,
      cumulativePV: projected.cumulativePV,
      pvTerminal: projected.pvTerminal,
      equityValue: projected.equityValue,
      fairValue: projected.fairValue,
      verdict: { kind: verdict.kind, pct: verdict.pct, factor: verdict.factor }
    };
  }
  return {
    name: c.name,
    input: c,
    baselines,
    blocked: dcfBlockedReason({ cashFlowBase: c.cashFlowBase, shares: c.shares }),
    presets
  };
});

fs.writeFileSync(OUT, JSON.stringify({ vectors }, null, 2) + '\n');
console.log(`dcf.vectors.json: ${vectors.length} cases, ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
