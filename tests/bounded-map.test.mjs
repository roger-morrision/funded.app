import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBounded } from '../server/bounded-map.mjs';

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
