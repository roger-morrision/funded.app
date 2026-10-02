import test from 'node:test';
import assert from 'node:assert/strict';
import { homeLaunchFeeIndex } from '../server/home-launch-fee-index.mjs';

test('fee index sums only mint-attributed verified collections for verified launches', () => {
  const launch = { cluster: 'devnet', onchainVerified: true, creator: 'router',
    pumpFeeRoute: { scope: 'per-mint-v2', router: 'router' } };
  const row = { mint: 'mintA', cluster: 'devnet', status: 'collected', attribution: 'mint-verified',
    onchainVerified: true, signature: 'signature', collectedLamports: '100000000' };
  const index = homeLaunchFeeIndex({ launches: { mintA: launch, mintB: launch, mintC: { ...launch, onchainVerified: false } },
    collections: { a: row, b: { ...row, collectedLamports: '200000000' }, c: { ...row, mint: 'mintC' },
      d: { ...row, attribution: 'shared-router' }, e: { ...row, onchainVerified: false } } }, 'devnet');
  assert.deepEqual(index.items, [{ mint: 'mintA', collectedLamports: '300000000' }, { mint: 'mintB', collectedLamports: '0' }]);
});
