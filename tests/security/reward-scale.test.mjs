import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { buildRewardManifest, verifyRewardProof } from '../../reward-merkle.js';

test('70,000-holder reward manifest proves its edge entitlements', () => {
  const address = index => {
    const bytes = Buffer.alloc(32, 11);
    bytes.writeUInt32LE(index, 0);
    return new PublicKey(bytes).toBase58();
  };
  const cycleId = 'a1'.repeat(32);
  const manifest = buildRewardManifest({ cycleId, asset:'SOL',
    allocations:Array.from({ length:70_000 }, (_, index) => ({ recipient:address(index), amount:'1' })) });
  assert.equal(manifest.leaves.length, 70_000);
  assert.equal(manifest.totalAmount, '70000');
  for (const leaf of [manifest.leaves[0], manifest.leaves.at(-1)]) {
    assert(verifyRewardProof({ cycleId, asset:'SOL', recipient:leaf.recipient,
      amount:leaf.amount, index:leaf.index, proof:leaf.proof, root:manifest.root }));
  }
});
