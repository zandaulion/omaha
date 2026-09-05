/**
 * The guard on PROMPT_VERSION.
 *
 * A version constant nobody is forced to bump is a version constant that does
 * not move. This pins a hash of prompt.js and fails when its contents change,
 * so a change to what the model is told cannot ship without somebody deciding
 * whether every cached analysis is now out of date.
 *
 * When this fails, do one of two things and update the hash either way:
 *
 *   - the change alters what the model is told  -> bump PROMPT_VERSION, which
 *     marks every cached summary superseded and offers a re-analysis
 *   - the change is a comment or a rename       -> leave the version alone
 *
 * Deliberately not automatic. Only a person can say whether a wording change
 * is worth re-spending money on every cached analysis in the database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { PROMPT_VERSION } from './prompt.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// sha256 of core/analysis/prompt.js, first 16 hex characters.
const PINNED = 'f653cceb30c5feb0';
const PINNED_FOR_VERSION = 2;

test('a change to the prompt is a decision about every cached analysis', () => {
  const actual = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(here, 'prompt.js')))
    .digest('hex')
    .slice(0, 16);

  assert.equal(
    actual,
    PINNED,
    'prompt.js changed. If the change alters what the model is told, bump ' +
    'PROMPT_VERSION so every cached summary is marked superseded; if it is ' +
    'cosmetic, leave the version alone. Update PINNED to ' + actual + ' either way.'
  );
  assert.equal(
    PROMPT_VERSION,
    PINNED_FOR_VERSION,
    'PROMPT_VERSION moved without the pinned hash being updated, so the guard ' +
    'is no longer guarding anything.'
  );
});
