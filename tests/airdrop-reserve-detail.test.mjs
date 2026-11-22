import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { createAirdropsRoutes } from '../server/routes/airdrops.mjs';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';

test('a selected reserve completes while a directory refresh is pending', async () => {
  const mint = 'Kj2yDt7s3g58KP8bcMTkLPZSPWYZBcdK8MpzqUQNj3c';
  const directoryRead = Promise.withResolvers();
  let storeReads = 0;
  const { handle } = createAirdropsRoutes({
    solanaCluster: 'devnet',
    store: {
      read: () => ++storeReads === 1 ? directoryRead.promise : { launches: {} },
    },
    automaticRewardStore: { read: () => ({}) },
    makeReserveConnection: () => ({ getGenesisHash: () => DEVNET_GENESIS_HASH }),
    respond: (response, status, data) => Object.assign(response, { status, data }),
  });

  async function request(query = '') {
    const response = {};
    const handled = await handle({ method: 'GET' }, response, new URL('/api/airdrops/reserves' + query, 'https://test.invalid'));
    assert.equal(handled, true);
    return response;
  }

  const directory = request();
  const selected = Promise.all([request('?mint=' + mint), request('?mint=' + mint)]);
  try {
    const responses = await Promise.race([selected, setImmediate()]);
    assert.ok(responses, 'selected requests must complete before the blocked directory read');
    assert.equal(storeReads, 2, 'duplicate selected requests should share one read');
    const [first, second] = responses;
    assert.equal(first.status, 200);
    assert.equal(first.data.cluster, 'devnet');
    assert.deepEqual(first.data.reserves, []);
    assert.deepEqual(second, first);
    assert.deepEqual(await request('?mint=' + mint), first);
    assert.equal(storeReads, 2, 'a new selected request should reuse the completed cache');
  } finally {
    directoryRead.resolve({ launches: {} });
    await Promise.allSettled([directory, selected]);
  }
  assert.equal((await directory).status, 200);
});
