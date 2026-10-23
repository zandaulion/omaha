import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const functionsRequire = createRequire(new URL('../functions/package.json', import.meta.url));
process.env.GCLOUD_PROJECT = 'demo-omaha-sdk';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-omaha-sdk' });

test('real callable SDK preserves authentication and input guards', async (t) => {
  const express = functionsRequire('express');
  const functions = await import('../functions/src/index.js');
  const names = ['getBalance', 'claimFreeGrant', 'redeemPurchase', 'getAiSummary', 'generateAiSummary'];
  const app = express();
  app.use(express.json());
  for (const name of names) app.post('/' + name, functions[name]);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const name of names) {
      await t.test(name, async () => {
        const response = await fetch(origin + '/' + name, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}'
        });
        // Shared cached summaries are intentionally public; an empty ticker
        // must fail validation before any Firestore request. Paid/account
        // operations must fail authentication before modifying credits.
        assert.equal(response.status, name === 'getAiSummary' ? 400 : 401);
        assert.equal((await response.json()).error.status, name === 'getAiSummary' ? 'INVALID_ARGUMENT' : 'UNAUTHENTICATED');
      });
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
