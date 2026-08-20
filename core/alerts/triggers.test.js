/**
 * Alert rule tests.
 *
 * The failure this file exists to prevent is the one that actually happened:
 * a standing condition announced on every sweep. Eight identical "entry point"
 * notifications for NU and PATH inside two hours.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTriggers } from './triggers.js';

const SETTINGS = {
  notify_earnings_filings: 1, notify_red_flags: 1, notify_margin_of_safety: 1,
  notify_capital_returns: 1, notify_sunday_digest: 1
};

const stock = (o = {}) => ({
  ticker: 'NU', health_score: 91, altman_z: 3.5, piotroski_score: 7,
  checklist: [{ id: 1, status: 'pass' }],
  summary: {
    metrics: { currentRatio: 1.6, grossMargin: 0.5, pegRatio: 0.9, shareChangeYoY: -0.01 },
    peHistory: { percentile: 5, scoreable: true }
  },
  ...o
});

const snap = (o = {}) => ({
  health_score: 91, checklist: { 1: 'pass' }, altman_z: 3.5, piotroski_score: 7,
  current_ratio: 1.6, gross_margin: 0.5, pe_percentile: 5, peg_ratio: 0.9,
  share_change: -0.01, ...o
});

test('a standing cheap PEG does not re-alert every sweep', () => {
  // NU's PEG has been 0.90 for months. Before the fix this fired on every
  // sweep because the condition was a state test with no edge guard.
  const alerts = evaluateTriggers(stock(), snap(), SETTINGS);
  assert.equal(alerts.filter((a) => a.type === 'MARGIN_OF_SAFETY').length, 0);
});

test('crossing into a cheap PEG does alert, once', () => {
  const alerts = evaluateTriggers(stock(), snap({ peg_ratio: 1.8 }), SETTINGS);
  const mos = alerts.filter((a) => a.type === 'MARGIN_OF_SAFETY');
  assert.equal(mos.length, 1);
  assert.match(mos[0].body, /1\.80/, 'the crossing should state where it came from');

  // The next sweep, with the snapshot updated, must stay quiet.
  assert.equal(
    evaluateTriggers(stock(), snap({ peg_ratio: 0.9 }), SETTINGS)
      .filter((a) => a.type === 'MARGIN_OF_SAFETY').length,
    0
  );
});

test('crossing into a cheap P/E percentile alerts', () => {
  const alerts = evaluateTriggers(stock(), snap({ pe_percentile: 60, peg_ratio: 0.9 }), SETTINGS);
  assert.equal(alerts.filter((a) => a.type === 'MARGIN_OF_SAFETY').length, 1);
});

test('a P/E history too short to be a range cannot signal cheapness', () => {
  // NU's history is 33 months across too few profitable years, so its 0th
  // percentile reflects an earnings recovery, not a cheaper multiple.
  const s = stock();
  s.summary.peHistory = { percentile: 0, scoreable: false };
  const alerts = evaluateTriggers(s, snap({ pe_percentile: 60, peg_ratio: 0.9 }), SETTINGS);
  assert.equal(alerts.filter((a) => a.type === 'MARGIN_OF_SAFETY').length, 0);
});

test('a first sighting never alerts', () => {
  assert.equal(evaluateTriggers(stock(), null, SETTINGS).length, 0);
});

test('a health score below the bar does not alert on price alone', () => {
  const alerts = evaluateTriggers(
    stock({ health_score: 70 }), snap({ health_score: 70, peg_ratio: 1.8 }), SETTINGS
  );
  assert.equal(alerts.filter((a) => a.type === 'MARGIN_OF_SAFETY').length, 0);
});

test('buyback alerts fire on the crossing, not the state', () => {
  const s = stock();
  s.summary.metrics.shareChangeYoY = -0.05;
  assert.equal(
    evaluateTriggers(s, snap({ share_change: -0.05 }), SETTINGS)
      .filter((a) => a.type === 'CAPITAL_RETURN').length,
    0, 'already buying back is not news'
  );
  assert.equal(
    evaluateTriggers(s, snap({ share_change: 0 }), SETTINGS)
      .filter((a) => a.type === 'CAPITAL_RETURN').length,
    1, 'starting to buy back is'
  );
});
