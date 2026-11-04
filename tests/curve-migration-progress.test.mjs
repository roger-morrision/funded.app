import test from 'node:test';
import assert from 'node:assert/strict';
import { curveMigrationProgress } from '../explore-onchain-metrics.js';
import { launchCardProgressState } from '../src/features/home/launch-card-view.js';

const initial = 793_100_000_000_000n;

test('migration progress is the share of initial real tokens already sold', () => {
  assert.equal(curveMigrationProgress({ realTokenReserves: initial }, initial), 0);
  assert.equal(curveMigrationProgress({ realTokenReserves: initial / 2n }, initial), 50);
  assert.equal(curveMigrationProgress({ realTokenReserves: 0n }, initial), 100);
  assert.equal(curveMigrationProgress({ realTokenReserves: initial }, null), null);
});

test('launch cards draw the bar only from the Pump global basis', () => {
  const card = launchCardProgressState({ complete:false, curveProgressPercent:37.6, curveProgressBasis:'pump-global' });
  assert.equal(card.value, 37.6);
  assert.equal(card.text, '37% to migration');
  assert.equal(launchCardProgressState({ complete:false, curveProgressPercent:37.6 }).value, null);
  assert.equal(launchCardProgressState({ complete:false, curveProgressPercent:0.4, curveProgressBasis:'pump-global' }).text, '<1% to migration');
});
