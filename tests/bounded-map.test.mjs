import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBounded } from '../server/bounded-map.mjs';
import { scanExploreMarketsBounded } from '../src/app/controllers/explore-loading.js';

test('bounded mapping preserves reserve order and caps concurrent RPC work', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapBounded([30, 5, 20, 10, 15], 2, async (delay, index) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, delay));
    active -= 1;
    return index;
  });
  assert.deepEqual(result, [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test('bounded mapping propagates verification failure instead of returning partial results', async () => {
  await assert.rejects(mapBounded([1, 2, 3], 2, async value => {
    if (value === 2) throw new Error('RPC proof unavailable');
    return value;
  }), /RPC proof unavailable/);
});

test('Explore scans at most four markets while still visiting the fifth', async () => {
  const releases = [];
  const visited = [];
  let active = 0, peak = 0;
  const scanning = scanExploreMarketsBounded([0, 1, 2, 3, 4], item => new Promise(resolve => {
    visited.push(item);
    active++;
    peak = Math.max(peak, active);
    releases.push(() => { active--; resolve(); });
  }));
  assert.deepEqual(visited, [0, 1, 2, 3]);
  releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(visited, [0, 1, 2, 3, 4]);
  for (const release of releases) release();
  await scanning;
  assert.equal(peak, 4);
});
