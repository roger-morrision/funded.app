import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { createExploreAccountSnapshot } from '../server/explore-account-snapshot.mjs';

const mint = 'So11111111111111111111111111111111111111112';
const account = { owner: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), lamports: 1, executable: false, data: Buffer.from([1, 2, 3]) };

test('the feed snapshot serves a recent read at once and refreshes it in the background', async () => {
  let time = 0, reads = 0, release;
  const read = createExploreAccountSnapshot({ now: () => time, firstWaitMs: 50, getConnection: () => ({
    getMultipleAccountsInfo: keys => { reads++; assert.equal(keys.length, 2); return new Promise(resolve => { release = () => resolve([account, null]); }); },
  }) });
  const first = read([mint]);
  await new Promise(resolve => setImmediate(resolve));
  release();
  const snapshot = await first;
  assert.equal(snapshot.accounts[mint].mint.data, 'AQID');
  assert.equal(snapshot.accounts[mint].curve, null);
  time = 10_000;
  assert.ok(await read([mint]), 'a read under a minute old is served without waiting');
  assert.equal(reads, 2, 'one background refresh started');
  time = 120_000;
  assert.equal(await read([mint]), null, 'an expired read is not served while the refresh is slow');
});

test('a failed or missing read leaves the feed without a snapshot', async () => {
  const read = createExploreAccountSnapshot({ firstWaitMs: 20, getConnection: () => ({ getMultipleAccountsInfo: async () => { throw new Error('429'); } }) });
  assert.equal(await read([mint]), null);
  assert.equal(await read(['not-a-key']), null);
  assert.equal(await read([]), null);
});
