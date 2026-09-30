import assert from 'node:assert/strict';
import { test } from 'node:test';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { createCommunityClaimService } from '../server/community-claim-service.mjs';

const key = () => Keypair.generate().publicKey.toBase58();
const programId = key(), authority = key(), creator = key(), mint = key(), eligibilityMint = key(), holder = key();
const migrationSignature = bs58.encode(Buffer.alloc(64, 7));
const fixedSnapshot = { mint:eligibilityMint, slot:123, blockTime:1_800_000_000, finalized:true,
  coverage:'finalized-exact-slot-v1', supplyBaseUnits:'100', accounts:[{ wallet:holder, balance:'100' }] };
const mintBytes = Buffer.alloc(82); mintBytes[44] = 0;
const makeStore = () => {
  const state = {};
  return { read:async () => structuredClone(state), transaction:async mutate => mutate(state) };
};
const pin = 'ab'.repeat(32);
function fixture({ store = makeStore(), observedHash = pin, reserveStatus = 'funded', openingOverrides = {}, snapshot = fixedSnapshot } = {}) {
  const connection = { getGenesisHash:async () => DEVNET_GENESIS_HASH,
    getAccountInfo:async address => address.toBase58() === mint ? { owner:TOKEN_PROGRAM_ID, data:mintBytes } : null,
    getTokenAccountBalance:async () => ({ value:{ amount:'1000' } }) };
  const reserveReader = async ({ dropOpeningSignature }) => {
    if (!dropOpeningSignature) return { status:reserveStatus, verified:reserveStatus === 'funded' };
    const row = (await store.read()).communityDrops[mint];
    return { status:'drop-active', verified:true, drop:row.manifest.drop, merkleRoot:row.manifest.root,
      snapshotHash:row.manifest.snapshotHash, migrationSlot:123, totalBaseUnits:'1000', expiresAt:2_100_000_000,
      ...openingOverrides };
  };
  return { store, service:createCommunityClaimService({ connection, store, programId, authority, eligibilityMint,
    expectedCommunityProgramDataSha256:pin, captureSnapshot:async () => snapshot, reserveReader,
    programEvidence:async () => ({ account:{ executable:true }, sha256:observedHash }) }) };
}
const input = { mint, creator, reservedTokens:1000, fundingSignature:'funded-finalized', migrationSignature };

test('persists one immutable exact-slot manifest and leaves proofs unavailable before opening', async () => {
  const { service } = fixture();
  const first = await service.prepare(input);
  const second = await service.prepare(input);
  assert.equal(first.manifest.root, second.manifest.root);
  assert.equal(first.snapshot.coverage, 'finalized-exact-slot-v1');
  assert.equal((await service.recipientProof({ mint, wallet:holder })).status, 'unavailable');
  assert.equal((await service.openingInstruction(mint)).instruction.keys.length, 13);
  await assert.rejects(service.prepare({ ...input, migrationSignature:bs58.encode(Buffer.alloc(64, 8)) }), /immutable/);
});

test('publishes only a verified recipient proof after the immutable opening receipt', async () => {
  const { service } = fixture();
  await service.prepare(input);
  const opened = await service.recordOpening({ mint, signature:'opening-finalized' });
  assert.equal(opened.verified, true);
  assert.equal((await service.recordOpening({ mint, signature:'opening-finalized' })).signature, 'opening-finalized');
  await assert.rejects(service.recordOpening({ mint, signature:'different-opening' }), /immutable/);
  const proof = await service.recipientProof({ mint, wallet:holder });
  assert.equal(proof.status, 'claimable');
  assert.equal(proof.amount, '1000');
  const claim = await service.claimInstruction({ mint, wallet:holder });
  assert.equal(claim.amount, '1000');
  assert.equal(claim.instruction.keys[0].pubkey.toBase58(), holder);
  assert.equal(claim.instruction.keys[0].isSigner, true);
  assert.equal(claim.instruction.keys[2].pubkey.toBase58(), holder);
  assert.equal(claim.instruction.programId.toBase58(), programId);
  await assert.rejects(service.claimInstruction({ mint, wallet:key() }), /No verified unclaimed/);
  assert.equal((await service.recipientProof({ mint, wallet:key() })).status, 'ineligible');
});

test('fails closed on Mainnet, unverified funding and unpinned program bytes', async () => {
  assert.throws(() => createCommunityClaimService({ connection:{}, store:makeStore(), programId, authority,
    eligibilityMint, cluster:'mainnet-beta' }), /Devnet-only/);
  await assert.rejects(fixture({ reserveStatus:'funding-unverified' }).service.prepare(input), /verified finalized funding/);
  const { service } = fixture({ observedHash:'cd'.repeat(32) });
  await service.prepare(input);
  await assert.rejects(service.openingInstruction(mint), /differs from the reviewed build/);
  await assert.rejects(service.recipientProof({ mint, wallet:holder }), /differs from the reviewed build/);
});

test('refuses a finalized opening receipt whose on-chain root differs from the persisted manifest', async () => {
  const { service } = fixture({ openingOverrides:{ merkleRoot:'00'.repeat(32) } });
  await service.prepare(input);
  await assert.rejects(service.recordOpening({ mint, signature:'opening-finalized' }), /differ from the immutable/);
  assert.equal((await service.prepared(mint)).openingSignature, null);
});

test('opens a full reserve when integer pro-rata shares leave token dust for the expiry recipient', async () => {
  const other = key();
  const snapshot = { ...fixedSnapshot, supplyBaseUnits:'3', accounts:[
    { wallet:holder, balance:'1' }, { wallet:other, balance:'2' }] };
  const { service } = fixture({ snapshot });
  const record = await service.prepare(input);
  assert.equal(record.manifest.allocatedAmount, '999');
  assert.equal(record.manifest.remainderAmount, '1');
  assert.equal((await service.openingInstruction(mint)).instruction.keys.length, 13);
});
