import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { buildCommunityManifest } from '../community-merkle.js';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { communityAddresses } from '../server/community-claim-chain.mjs';
import { indexCommunityClaims } from '../server/community-claim-index.mjs';
import { feePayoutStats } from '../server/fee-payout-stats.mjs';

const key = () => Keypair.generate().publicKey.toBase58();
const hash = name => createHash('sha256').update(name).digest().subarray(0, 8);
const programId = key(), authority = key(), eligibilityMint = key(), holder = key(), other = key();
const expectedProgramDataSha256 = 'ab'.repeat(32);
const signature = bs58.encode(Buffer.alloc(64, 7));

function fixture() {
  const accounts = new Map(), state = { communityDrops:{} };
  const ledger = { read:async () => structuredClone(state), transaction:async mutate => mutate(state) };
  const connection = {
    getGenesisHash:async () => DEVNET_GENESIS_HASH,
    getAccountInfo:async address => accounts.get(address.toBase58()) || null,
    getMultipleAccountsInfo:async addresses => addresses.map(address => accounts.get(address.toBase58()) || null),
  };
  function addDrop(mint, claimedRecipients = [holder]) {
    const { drop } = communityAddresses({ programId, authority, mint });
    const manifest = buildCommunityManifest({ drop:drop.toBase58(), launchMint:mint, eligibilityMint,
      migrationSignature:signature, migrationSlot:123, migrationBlockTime:1_800_000_000,
      snapshot:{ mint:eligibilityMint, slot:123, blockTime:1_800_000_000, finalized:true,
        coverage:'finalized-exact-slot-v1', supplyBaseUnits:'100',
        accounts:[{ wallet:holder, balance:'50' }, { wallet:other, balance:'50' }] }, amountBaseUnits:'1000' });
    state.communityDrops[mint] = { mint, programId, authority, eligibilityMint,
      reservedBaseUnits:'1000', openingSignature:signature, manifest };
    const bytes = Buffer.alloc(350);
    hash('account:CommunityDrop').copy(bytes, 0);
    Buffer.from(bs58.decode(authority)).copy(bytes, 8);
    Buffer.from(bs58.decode(authority)).copy(bytes, 72);
    Buffer.from(bs58.decode(mint)).copy(bytes, 104);
    Buffer.from(bs58.decode(eligibilityMint)).copy(bytes, 136);
    Buffer.from(manifest.root, 'hex').copy(bytes, 168);
    Buffer.from(manifest.snapshotHash, 'hex').copy(bytes, 200);
    bytes.writeBigUInt64LE(1000n, 312);
    bytes.writeUInt32LE(manifest.leaves.length, 344);
    let claimed = 0n;
    for (const leaf of manifest.leaves) {
      if (!claimedRecipients.includes(leaf.recipient)) continue;
      const { payment } = communityAddresses({ programId, authority, mint, recipient:leaf.recipient });
      const paymentBytes = Buffer.alloc(92);
      hash('account:CommunityPayment').copy(paymentBytes, 0);
      drop.toBuffer().copy(paymentBytes, 8);
      Buffer.from(bs58.decode(leaf.recipient)).copy(paymentBytes, 40);
      paymentBytes.writeBigUInt64LE(BigInt(leaf.amount), 72);
      paymentBytes.writeUInt32LE(leaf.index, 80);
      accounts.set(payment.toBase58(), { owner:{ equals:value => value.toBase58() === programId }, data:paymentBytes });
      claimed += BigInt(leaf.amount);
    }
    bytes.writeBigUInt64LE(claimed, 320);
    accounts.set(drop.toBase58(), { owner:{ equals:value => value.toBase58() === programId }, data:bytes });
    return { drop:drop.toBase58(), bytes, manifest };
  }
  const run = () => indexCommunityClaims({ connection, ledger, programId, authority, eligibilityMint,
    expectedProgramDataSha256, programEvidence:async () => ({ account:{ executable:true }, sha256:expectedProgramDataSha256 }) });
  return { addDrop, run, state, accounts };
}

test('indexes finalized community payments by recipient across launches', async () => {
  const f = fixture();
  f.addDrop(key()); f.addDrop(key());
  const result = await f.run();
  assert.equal(result.drops.length, 2);
  assert.equal(result.payments.length, 2);
  assert.equal(result.payments.every(row => row.recipient === holder), true);
  assert.deepEqual(f.state.communityClaimIndex, result);
  const stats = feePayoutStats({}, { schedules:{}, communityClaimIndex:result },
    { cluster:'devnet', commitment:'finalized', status:'no-records' });
  assert.equal(stats.fundedHolder.status, 'verified');
  assert.deepEqual(stats.fundedHolder.top, { recipient:holder, claimCount:2, launchCount:2 });
  assert.equal(stats.fundedHolder.asset, 'launched tokens');
  assert.equal(stats.fundedHolder.paidLamports, undefined);
});

test('rejects incomplete or altered finalized payment accounts without replacing the index', async () => {
  const f = fixture(), { drop, bytes, manifest } = f.addDrop(key());
  await f.run();
  const prior = structuredClone(f.state.communityClaimIndex);
  bytes.writeBigUInt64LE(999n, 320);
  await assert.rejects(f.run(), /do not reconcile/);
  assert.deepEqual(f.state.communityClaimIndex, prior);
  bytes.writeBigUInt64LE(BigInt(manifest.leaves.find(row => row.recipient === holder).amount), 320);
  const payment = communityAddresses({ programId, authority, mint:manifest.launchMint, recipient:holder }).payment.toBase58();
  f.accounts.get(payment).data.writeBigUInt64LE(1n, 72);
  await assert.rejects(f.run(), /does not match/);
  assert.deepEqual(f.state.communityClaimIndex, prior);
  assert.equal(f.accounts.has(drop), true);
});
