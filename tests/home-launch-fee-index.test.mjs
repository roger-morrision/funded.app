import test from 'node:test';
import assert from 'node:assert/strict';
import { homeLaunchFeeIndex } from '../server/home-launch-fee-index.mjs';

test('fee index sums only unique verified V3 collections for matching V3 launches', () => {
  const launch = { cluster: 'devnet', onchainVerified: true, creator: 'router',
    pumpFeeRoute: { scope: 'per-mint-v3', verified: true, programId: 'v3-program', router: 'router' } };
  const row = { mint: 'mintA', cluster: 'devnet', status: 'collected', attribution: 'mint-verified',
    onchainVerified: true, scope: 'per-mint-v3', programId: 'v3-program', router: 'router',
    signature: 'signature-a', collectedLamports: '100000000' };
  const index = homeLaunchFeeIndex({ launches: { mintA: launch, mintB: launch,
    mintC: { ...launch, onchainVerified: false }, mintD: { ...launch, pumpFeeRoute: { ...launch.pumpFeeRoute, scope: 'per-mint-v2' } } },
    collections: { a: row, b: { ...row, signature: 'signature-b', collectedLamports: '200000000' },
      duplicate: { ...row, collectedLamports: '500000000' }, c: { ...row, mint: 'mintC' },
      d: { ...row, attribution: 'shared-router' }, e: { ...row, onchainVerified: false },
      old: { ...row, mint: 'mintD', scope: 'per-mint-v2' },
      wrongProgram: { ...row, signature: 'signature-c', programId: 'other' },
      wrongRouter: { ...row, signature: 'signature-d', router: 'other' } } }, 'devnet');
  assert.equal(index.coverage, 'verified-v3-collected-creator-fees-only');
  assert.deepEqual(index.items, [{ mint: 'mintA', collectedLamports: '300000000' }, { mint: 'mintB', collectedLamports: '0' }]);
});
