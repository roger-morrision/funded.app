import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { communityAddresses } from '../server/community-claim-chain.mjs';
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
function fixture({ store = makeStore(), observedHash = pin, reserveStatus = 'funded', openingOverrides = {}, snapshot = fixedSnapshot,
  qaCutoffMints = mint } = {}) {
  const paymentAccounts = new Map();
  const connection = { getGenesisHash:async () => DEVNET_GENESIS_HASH,
    getAccountInfo:async address => address.toBase58() === mint ? { owner:TOKEN_PROGRAM_ID, data:mintBytes } : paymentAccounts.get(address.toBase58()) || null,
    getTokenAccountBalance:async () => ({ value:{ amount:'1000' } }) };
  const reserveReader = async ({ dropOpeningSignature }) => {
    if (!dropOpeningSignature) return { status:reserveStatus, verified:reserveStatus === 'funded' };
    const row = (await store.read()).communityDrops[mint];
    return { status:'drop-active', verified:true, drop:row.manifest.drop, merkleRoot:row.manifest.root,
      snapshotHash:row.manifest.snapshotHash, migrationSlot:123, totalBaseUnits:'1000', expiresAt:2_100_000_000,
      ...openingOverrides };
  };
  return { store, paymentAccounts, service:createCommunityClaimService({ connection, store, programId, authority, eligibilityMint,
    expectedCommunityProgramDataSha256:pin, captureSnapshot:async () => snapshot,
    captureQaSnapshot:async () => snapshot, qaCutoffMint:qaCutoffMints, qaCutoffAuthority:authority, reserveReader,
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
  assert.equal((await service.openingInstruction(mint)).instruction.keys.length, 15);
  await assert.rejects(service.prepare({ ...input, migrationSignature:bs58.encode(Buffer.alloc(64, 8)) }), /immutable/);
});

test('Devnet QA cutoff is explicitly labeled and cannot replace a migration manifest', async () => {
  const { service } = fixture({ qaCutoffMints:`${key()},${mint}` });
  const qa = await service.prepare({ ...input, snapshotBasis:'devnet-qa-cutoff' });
  assert.equal(qa.snapshotBasis, 'devnet-qa-cutoff');
  await assert.rejects(service.prepare(input), /immutable/);
  await assert.rejects(service.prepare({ ...input, snapshotBasis:'unknown' }), /Unsupported/);
  await assert.rejects(fixture({ qaCutoffMints:key() }).service.prepare({
    ...input, snapshotBasis:'devnet-qa-cutoff' }), /exact launch mint/);
});

test('keeps finalized community claims visible after a drop closes or expires', async () => {
  const { service, paymentAccounts } = fixture({ openingOverrides:{ status:'drop-closed', expiresAt:1 } });
  const prepared = await service.prepare(input);
  await service.recordOpening({ mint, signature:'opening-finalized' });
  assert.equal((await service.recipientProof({ mint, wallet:holder })).status, 'expired');
  const { payment } = communityAddresses({ programId, authority, mint, recipient:holder });
  const data = Buffer.alloc(92);
  createHash('sha256').update('account:CommunityPayment').digest().copy(data,0,0,8);
  new PublicKey(prepared.manifest.drop).toBuffer().copy(data,8);
  new PublicKey(holder).toBuffer().copy(data,40);
  data.writeBigUInt64LE(1000n,72);
  data.writeUInt32LE(0,80);
  paymentAccounts.set(payment.toBase58(), { owner:new PublicKey(programId), data });
  const claimed = await service.recipientProof({ mint, wallet:holder });
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.payment, payment.toBase58());
  await assert.rejects(service.claimInstruction({ mint, wallet:holder }), /No verified unclaimed/);
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
    eligibilityMint, cluster:'mainnet-beta' }), /unavailable for this configuration/);
  await assert.rejects(fixture({ reserveStatus:'funding-unverified' }).service.prepare(input), /verified finalized funding/);
  const { service } = fixture({ observedHash:'cd'.repeat(32) });
  await service.prepare(input);
  await assert.rejects(service.openingInstruction(mint), /differs from the reviewed build/);
  await assert.rejects(service.recipientProof({ mint, wallet:holder }), /differs from the reviewed build/);
});

test('does not advertise a program-address allocation as wallet-claimable or rewrite its immutable manifest', async () => {
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from('qa-pool')], new PublicKey(programId));
  const snapshot = { ...fixedSnapshot, accounts:[{ wallet:pool.toBase58(), balance:'100' }] };
  const { service, paymentAccounts } = fixture({ snapshot });
  const prepared = await service.prepare(input);
  await service.recordOpening({ mint, signature:'opening-finalized' });
  const before = await service.prepared(mint);
  const proof = await service.recipientProof({ mint, wallet:pool.toBase58() });
  assert.equal(proof.status, 'unavailable');
  assert.equal(proof.reasonCode, 'program-address-allocation');
  assert.equal(proof.amount, '1000');
  await assert.rejects(service.claimInstruction({ mint, wallet:pool.toBase58() }), /program address.*connected wallet/);
  assert.deepEqual(await service.prepared(mint), before);

  // A valid historical payment must still win over the unsupported-wallet guard.
  const { payment } = communityAddresses({ programId, authority, mint, recipient:pool });
  const data = Buffer.alloc(92);
  createHash('sha256').update('account:CommunityPayment').digest().copy(data, 0, 0, 8);
  new PublicKey(prepared.manifest.drop).toBuffer().copy(data, 8);
  pool.toBuffer().copy(data, 40);
  data.writeBigUInt64LE(1000n, 72);
  data.writeUInt32LE(0, 80);
  paymentAccounts.set(payment.toBase58(), { owner:new PublicKey(programId), data });
  assert.equal((await service.recipientProof({ mint, wallet:pool.toBase58() })).status, 'claimed');
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
  assert.equal((await service.openingInstruction(mint)).instruction.keys.length, 15);
});
