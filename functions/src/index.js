/**
 * Pocket Omaha — the Cloud Function relay, entry point.
 *
 * Phase 6 (docs/16_ROADMAP.md), the only phase in this project needing real
 * infrastructure. Three callables:
 *
 *  - `getAiSummary`      — read a cached analysis. No auth.
 *  - `generateAiSummary` — spend a credit on a fresh one. Requires
 *    Google-Sign-In-backed Firebase Auth.
 *  - `redeemPurchase`    — turn a verified Play purchase, paid or the $0
 *    free-grant product, into credits. Requires auth.
 *
 * Everything each of these does with Gemini, Firestore or the Play Developer
 * API lives in its own file, tested where it can be (`products.js`,
 * `play-verify.js`, `cache-key.js` all have plain node:test coverage that
 * runs with no emulator and no network — see `npm test` in this directory).
 * This file only wires initialization and re-exports.
 */

import { initializeApp } from 'firebase-admin/app';

initializeApp();

export { getAiSummary, generateAiSummary } from './analyze.js';
export { redeemPurchase } from './billing.js';
