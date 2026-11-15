import test from 'node:test';
import assert from 'node:assert/strict';
import { createVolumeChangeTracker } from '../server/volume-change.mjs';

const HOUR = 3_600_000;
function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async readMarketActivity(mint, cluster) { return rows.get(`${cluster}:${mint}`) || null; },
    async writeMarketActivity(mint, cluster, data) { rows.set(`${cluster}:${mint}`, structuredClone(data)); },
  };
}

test('24h volume change compares with the snapshot nearest to a day earlier', async () => {
  let clock = 1_000 * HOUR;
  const store = memoryStore();
  const tracker = createVolumeChangeTracker({ store, cluster: 'mainnet-beta', now: () => clock });
  await tracker.record('mintA', 1000);
  assert.equal(await tracker.change('mintA', 1500), null, 'no day of history yet');
  clock += 10 * 60_000;
  await tracker.record('mintA', 9999);
  assert.equal(store.rows.get('mainnet-beta:volume-24h-history:mintA').snapshots.length, 1, 'records at most hourly');
  clock += 24 * HOUR - 10 * 60_000;
  assert.equal(await tracker.change('mintA', 1500), 50);
  // A fresh tracker (after a restart) reads the saved history.
  const restarted = createVolumeChangeTracker({ store, cluster: 'mainnet-beta', now: () => clock });
  assert.equal(await restarted.change('mintA', 500), -50);
});

test('history older than a day plus the window is dropped', async () => {
  let clock = 0;
  const store = memoryStore();
  const tracker = createVolumeChangeTracker({ store, cluster: 'c', now: () => clock });
  await tracker.record('m', 10);
  clock += 30 * HOUR;
  await tracker.record('m', 20);
  assert.deepEqual(store.rows.get('c:volume-24h-history:m').snapshots.map(row => row.usd), [20]);
  assert.equal(await tracker.change('m', 40), null);
});
