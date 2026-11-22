import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { buildCommunityManifest, verifyCommunityProof } from '../../community-merkle.js';

const wallet = index => {
  const bytes = Buffer.alloc(32, 7);
  bytes.writeUInt32LE(index, 0);
  return new PublicKey(bytes).toBase58();
};
const input = (count, excludedWallets = []) => {
  const eligibilityMint = wallet(count + 2);
  return { drop:wallet(count + 3), launchMint:wallet(count + 1), eligibilityMint,
    migrationSignature:bs58.encode(Buffer.alloc(64, 1)), migrationSlot:1,
    migrationBlockTime:1, amountBaseUnits:String(count), excludedWallets,
    snapshot:{ mint:eligibilityMint, slot:1, blockTime:1, finalized:true,
      coverage:'finalized-exact-slot-v1', supplyBaseUnits:String(count),
      accounts:Array.from({ length:count }, (_, index) => ({ wallet:wallet(index), balance:'1' })) } };
};

test('streamed community snapshot hash preserves the existing byte format', () => {
  const data = input(3, [wallet(1)]), manifest = buildCommunityManifest(data);
  const u64 = value => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; };
  const u32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
  const address = value => new PublicKey(value).toBuffer();
  const ordered = [...data.snapshot.accounts].sort((a, b) => a.wallet.localeCompare(b.wallet));
  const legacyBytes = Buffer.concat([
    Buffer.from('funded-community-snapshot-v1'), address(data.launchMint), address(data.eligibilityMint),
    u64(1), u64(1), u64(3), u32(3),
    ...ordered.flatMap(row => [address(row.wallet), u64(row.balance)]),
    u32(1), address(wallet(1)),
  ]);
  assert.equal(manifest.snapshotHash, createHash('sha256').update(legacyBytes).digest('hex'));
  assert.equal(manifest.leaves.length, 2);
});

test('70,000-holder community manifest hashes and proves without argument overflow', () => {
  const data = input(70_000), manifest = buildCommunityManifest(data);
  assert.equal(manifest.leaves.length, 70_000);
  assert.equal(manifest.snapshotHash, '3748739e2a023511e6de939d87eea1c64cce4b90c7ce9b075f0860c91f6c63e4');
  for (const leaf of [manifest.leaves[0], manifest.leaves.at(-1)])
    assert(verifyCommunityProof({ drop:data.drop, recipient:leaf.recipient,
      amount:leaf.amount, index:leaf.index, proof:leaf.proof, root:manifest.root }));
});
