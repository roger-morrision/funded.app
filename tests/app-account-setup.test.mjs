import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import bs58 from 'bs58';
import { developerLockLaunchInstructions, developerReleaseInstructions, DEVELOPER_TOKEN_LOCK_PROGRAM_ID,
  DEVELOPER_TOKEN_LOCK_SECONDS } from '../developer-token-lock.js';
import { buildCommunityInitializeInstruction, communityAddresses } from '../server/community-claim-chain.mjs';
import { communityLeaf } from '../community-merkle.js';
import { createCommunityAutoDelivery } from '../server/community-auto-delivery.mjs';
import { communityProgramForLaunch } from '../server/community-program-config.mjs';
import { communityOpeningInstructions } from '../server/community-opening-instructions.mjs';

const creator = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const authority = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const mint = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
const eligibilityMint = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;
const programId = new PublicKey('9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm');
const config = { ready:true, programId:DEVELOPER_TOKEN_LOCK_PROGRAM_ID, lockSeconds:DEVELOPER_TOKEN_LOCK_SECONDS };
function assertSetup(ix, { payer, owner, tokenProgram, destination }) {
  assert(ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
  assert.deepEqual([...ix.data], [1]); // CreateIdempotent
  assert(ix.keys[0].pubkey.equals(payer));
  assert(ix.keys[0].isSigner);
  assert(ix.keys[1].pubkey.equals(destination));
  assert(ix.keys[2].pubkey.equals(owner));
  assert(ix.keys[3].pubkey.equals(mint));
  assert(ix.keys[5].pubkey.equals(tokenProgram));
}
function communityArgs(tokenProgram = TOKEN_2022_PROGRAM_ID) {
  const drop = communityAddresses({ programId, authority, mint }).drop.toBase58();
  const leaf = { recipient:creator.toBase58(), amount:'100', index:0, proof:[] };
  return { programId, authority, creator, mint, eligibilityMint, tokenProgram, sourceVaultBalance:'100', manifest:{
    drop, launchMint:mint.toBase58(), eligibilityMint:eligibilityMint.toBase58(),
    root:communityLeaf({ drop, ...leaf }).toString('hex'), snapshotHash:'09'.repeat(32),
    migrationSignature:bs58.encode(new Uint8Array(64).fill(7)), migrationSlot:1234, migrationBlockTime:1_800_000_000,
    totalAmount:'100', allocatedAmount:'100', remainderAmount:'0', leaves:[leaf],
  } };
}

test('launch creates the escrow ATA atomically before the unchanged custody instruction', () => {
  const [setup, lock] = developerLockLaunchInstructions({ mint, creator, amount:123n, config });
  assertSetup(setup, { payer:creator, owner:lock.keys[3].pubkey, tokenProgram:TOKEN_2022_PROGRAM_ID, destination:lock.keys[4].pubkey });
  assert.equal(lock.data.readBigUInt64LE(8), 123n);
  assert.deepEqual(developerLockLaunchInstructions({ mint, creator, amount:0n }), []);
  assert.throws(() => developerLockLaunchInstructions({ mint, creator, amount:1n, config:{...config, ready:false} }), /unavailable/);
});

test('permissionless release setup always recreates the original creator destination', () => {
  const [setup, release] = developerReleaseInstructions({ mint, creator, payer:authority });
  const destination = getAssociatedTokenAddressSync(mint, creator, false, TOKEN_2022_PROGRAM_ID);
  assertSetup(setup, { payer:authority, owner:creator, tokenProgram:TOKEN_2022_PROGRAM_ID, destination });
  assert(release.keys[5].pubkey.equals(destination));
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey:authority,
    recentBlockhash:mint.toBase58(), instructions:[setup, release] }).compileToV0Message());
  assert(transaction.serialize().length <= 1232);
});

for (const tokenProgram of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
  test(`community opening creates the canonical ${tokenProgram} vault before transferring reserves`, () => {
    const args = communityArgs(tokenProgram), built = buildCommunityInitializeInstruction(args);
    assert.equal(built.instructions[1], built.instruction);
    assertSetup(built.instructions[0], { payer:authority, owner:new PublicKey(built.drop), tokenProgram, destination:new PublicKey(built.dropToken) });
    const transaction = new VersionedTransaction(new TransactionMessage({ payerKey:authority,
      recentBlockhash:mint.toBase58(), instructions:built.instructions }).compileToV0Message());
    assert(transaction.serialize().length <= 1232);
    assert.throws(() => buildCommunityInitializeInstruction({...args, sourceVaultBalance:'99'}), /fully funded/);
    assert.throws(() => buildCommunityInitializeInstruction({...args, manifest:{...args.manifest, root:'00'.repeat(32)}}), /Merkle proof/);
  });
}

test('legacy community routers retain internal setup until explicitly configured for the new binary', () => {
  const launch = { onchainVerified:true, cluster:'devnet', pumpFeeRoute:{ scope:'per-mint-v3', verified:true,
    programId:programId.toBase58(), initialAuthority:authority.toBase58() } };
  const env = { FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId.toBase58(), FUNDED_V3_PROGRAM_DATA_SHA256:'ab'.repeat(32) };
  const legacy = communityProgramForLaunch(launch, env, () => ({publicKey:authority}));
  assert.equal(legacy.accountSetup, 'program');
  assert.equal(buildCommunityInitializeInstruction({...communityArgs(), accountSetup:legacy.accountSetup}).instructions.length, 1);
  const next = communityProgramForLaunch(launch, {...env, FUNDED_V3_COMMUNITY_ACCOUNT_SETUP:'app'}, () => ({publicKey:authority}));
  assert.equal(next.accountSetup, 'app');
  assert.throws(() => communityProgramForLaunch(launch, {...env, FUNDED_V3_COMMUNITY_ACCOUNT_SETUP:'unknown'}, () => ({publicKey:authority})), /setup mode/);
});

test('automatic delivery submits the complete ordered setup and opening transaction', async () => {
  const built = buildCommunityInitializeInstruction(communityArgs());
  const worker = createCommunityAutoDelivery({ connection:{
    getAccountInfo:async () => null, getLatestBlockhash:async () => ({blockhash:mint.toBase58(), lastValidBlockHeight:100}),
    getMinimumBalanceForRentExemption:async () => 1000,
  }, store:{}, service:{ approvalInstruction:async () => built.instruction, openingInstruction:async () => built },
  authority:{publicKey:authority}, programId:programId.toBase58(), approvedHash:'ab'.repeat(32),
  execute:async ({prepare}) => {
    const {transaction} = await prepare();
    const ixs = TransactionMessage.decompile(transaction.message).instructions;
    assert.equal(ixs.length, 3);
    assert(ixs[1].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    assert(ixs[2].data.equals(built.instruction.data));
    return {status:'prepared'};
  } });
  assert.deepEqual(await worker.open({ snapshotBasis:'pump-migration', authority:authority.toBase58(),
    programId:programId.toBase58(), mint:mint.toBase58(), manifest:communityArgs().manifest }), {status:'prepared'});
});

test('standalone worker validates canonical setup and preserves old API compatibility', () => {
  const built = buildCommunityInitializeInstruction(communityArgs());
  const serialize = ix => ({programId:ix.programId.toBase58(), data:ix.data.toString('base64'),
    accounts:ix.keys.map(k => ({...k, pubkey:k.pubkey.toBase58()}))});
  const prepared = {drop:built.drop, ...serialize(built.instruction), instructions:built.instructions.map(serialize)};
  const args = {prepared, programId, authority, mint, drop:built.drop};
  assert.equal(communityOpeningInstructions(args).length, 2);
  const legacy = {...prepared}; delete legacy.instructions;
  assert.equal(communityOpeningInstructions({...args, prepared:legacy}).length, 1);
  for (const mutate of [
    row => { row.instructions[0].accounts[2].pubkey = creator.toBase58(); },
    row => { row.instructions[0].accounts[0].pubkey = creator.toBase58(); },
    row => { row.instructions[0].data = 'AA=='; },
    row => { row.instructions.reverse(); },
    row => { row.instructions.push(row.instructions[1]); },
    row => { row.accounts[0].pubkey = creator.toBase58(); },
  ]) {
    const tampered = structuredClone(prepared); mutate(tampered);
    assert.throws(() => communityOpeningInstructions({...args, prepared:tampered}));
  }
});
