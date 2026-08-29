/**
 * Pocket Omaha — the Cloud Function relay, entry point.
 *
 * Phase 6 (docs/16_ROADMAP.md), the only phase in this project needing real
 * infrastructure. Five callables:
 *
 *  - `getAiSummary`      — read a cached analysis. No auth.
 *  - `generateAiSummary` — spend a credit on a fresh one. Requires
 *    Google-Sign-In-backed Firebase Auth. Returns the resulting balance.
 *  - `redeemPurchase`    — turn a verified Play purchase into credits.
 *    Requires auth. Only `omaha_credits_10` goes through this since
 *    2026-08-29 — see `billing.js`'s header.
 *  - `claimFreeGrant`    — the 5-credit first-launch grant. Requires auth, no
 *    Play involved; see `free-grant.js`'s header for why it moved here.
 *  - `getBalance`        — read the current balance with no side effect.
 *    Requires auth. Added while building the Android client, 2026-08-29:
 *    every mutating callable already returned the new balance, but nothing
 *    let the client simply ask.
 *
 * Everything each of these does with Gemini, Firestore or the Play Developer
 * API lives in its own file, tested where it can be (`products.js`,
 * `play-verify.js`, `cache-key.js`, `settlement.js` all have plain node:test
 * coverage that runs with no emulator and no network — see `npm test` in
 * this directory). This file only wires initialization and re-exports.
 */

import { initializeApp } from 'firebase-admin/app';

initializeApp();

export { getAiSummary, generateAiSummary } from './analyze.js';
export { redeemPurchase } from './billing.js';
export { claimFreeGrant } from './free-grant.js';
export { getBalance } from './balance.js';
