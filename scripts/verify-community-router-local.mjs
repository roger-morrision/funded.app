import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo, transferChecked } from '@solana/spl-token';
import { communityLeaf } from '../community-merkle.js';
import { buildCommunityClaimInstruction, buildCommunityInitializeInstruction, communityAddresses } from '../server/community-claim-chain.mjs';
import { readCommunityReserveStatus } from '../server/community-reserve-status.mjs';
import { rewardAddresses } from '../server/automatic-reward-chain.mjs';

const rpcUrl = new URL(process.env.LOCAL_SOLANA_RPC_URL || 'http://127.0.0.1:18899');
if (!['127.0.0.1', 'localhost'].includes(rpcUrl.hostname)) throw new Error('Only a loopback local validator is permitted.');
const connection = new Connection(rpcUrl.toString(), 'confirmed');
const programId = new PublicKey('2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik');
const digest = name => createHash('sha256').update(name).digest().subarray(0, 8);
const authority = Keypair.generate(), creator = Keypair.generate(), recipient = Keypair.generate();
const send = (instruction, signers = [authority]) => sendAndConfirmTransaction(connection,
  new Transaction().add(instruction), signers, { commitment:'confirmed' });
for (const wallet of [authority, creator]) {
  const signature = await connection.requestAirdrop(wallet.publicKey, 10_000_000_000);
  await connection.confirmTransaction(signature, 'confirmed');
}
const mint = await createMint(connection, authority, creator.publicKey, null, 0);
const eligibilityMint = await createMint(connection, authority, creator.publicKey, null, 0);
const creatorToken = await getOrCreateAssociatedTokenAccount(connection, creator, mint, creator.publicKey);
await mintTo(connection, creator, mint, creatorToken.address, creator, 100);
const [router] = PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')], programId);
await send(new TransactionInstruction({ programId, keys:[
  { pubkey:authority.publicKey, isSigner:true, isWritable:true },
  { pubkey:router, isSigner:false, isWritable:true },
  { pubkey:SystemProgram.programId, isSigner:false, isWritable:false },
], data:digest('global:initialize') }));
const { vault } = rewardAddresses({ programId, authority:authority.publicKey, mint });
await send(new TransactionInstruction({ programId, keys:[
  { pubkey:authority.publicKey, isSigner:true, isWritable:true },
  { pubkey:mint, isSigner:false, isWritable:false },
  { pubkey:vault, isSigner:false, isWritable:true },
  { pubkey:router, isSigner:false, isWritable:false },
  { pubkey:SystemProgram.programId, isSigner:false, isWritable:false },
], data:digest('global:initialize_reward_vault') }));
const source = await getOrCreateAssociatedTokenAccount(connection, authority, mint, vault, true);
const fundingSignature = await transferChecked(connection, creator, creatorToken.address, mint, source.address, creator, 100, 0);
assert.equal(Number((await getAccount(connection, source.address)).amount), 100);
const { drop } = communityAddresses({ programId, authority:authority.publicKey, mint });
const migrationSlot = Math.max(1, await connection.getSlot('finalized'));
const migrationBlockTime = Math.floor(Date.now() / 1000) - 60;
const manifest = { drop:drop.toBase58(), launchMint:mint.toBase58(), eligibilityMint:eligibilityMint.toBase58(),
  migrationSignature:bs58.encode(Buffer.alloc(64, 7)), migrationSlot, snapshotSlot:migrationSlot,
  migrationBlockTime, totalAmount:'100', allocatedAmount:'100', snapshotHash:'09'.repeat(32),
  leaves:[{ recipient:recipient.publicKey.toBase58(), amount:'100', index:0, proof:[] }] };
manifest.root = communityLeaf({ drop:manifest.drop, recipient:recipient.publicKey, amount:'100', index:0 }).toString('hex');
const opening = buildCommunityInitializeInstruction({ programId, authority:authority.publicKey,
  creator:creator.publicKey, mint, eligibilityMint, tokenProgram:(await connection.getAccountInfo(mint)).owner,
  manifest, sourceVaultBalance:'100' });
const wrong = new TransactionInstruction({ programId, keys:opening.instruction.keys,
  data:Buffer.from(opening.instruction.data) });
wrong.data.writeBigUInt64LE(99n, wrong.data.length - 12);
await assert.rejects(send(wrong));
assert.equal(await connection.getAccountInfo(drop), null);
const openSignature = await send(opening.instruction);
await connection.confirmTransaction(openSignature, 'finalized');
const observed = await readCommunityReserveStatus({ connection, programId, authority:authority.publicKey,
  fundingAuthority:creator.publicKey, mint, reservedTokens:100, fundingSignature,
  expectedEligibilityMint:eligibilityMint, dropOpeningSignature:openSignature });
if (!observed.verified) {
  const transaction = await connection.getTransaction(openSignature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
  console.error(JSON.stringify({ observed, status:await connection.getSignatureStatus(openSignature, { searchTransactionHistory:true }),
    keys:transaction.transaction.message.accountKeys.map(row => row.toBase58?.() || row),
    instructions:transaction.transaction.message.instructions,
    preTokenBalances:transaction.meta.preTokenBalances, postTokenBalances:transaction.meta.postTokenBalances }));
}
assert.equal(observed.status, 'drop-active');
assert.equal(observed.verified, true);
assert.equal(observed.merkleRoot, manifest.root);
assert.equal(Number((await getAccount(connection, source.address)).amount), 0);
assert.equal(Number((await getAccount(connection, new PublicKey(opening.dropToken))).amount), 100);
await assert.rejects(send(opening.instruction));
const recipientToken = await getOrCreateAssociatedTokenAccount(connection, authority, mint, recipient.publicKey);
const claim = buildCommunityClaimInstruction({ programId, authority:authority.publicKey, mint,
  tokenProgram:(await connection.getAccountInfo(mint)).owner, manifest,
  recipient:recipient.publicKey, payer:authority.publicKey });
const claimSignature = await send(claim.instruction);
assert.equal(Number((await getAccount(connection, recipientToken.address)).amount), 100);
assert.equal(Number((await getAccount(connection, new PublicKey(opening.dropToken))).amount), 0);
await assert.rejects(send(claim.instruction));
console.log(JSON.stringify({ ok:true, runtime:'local-agave-4.1.2-sbf', mint:mint.toBase58(), drop:drop.toBase58(),
  creatorSignedOpening:false, opened:openSignature, claimed:claimSignature, sourceAfter:'0', recipientAfter:'100',
  wrongAmountRejected:true, openingReplayRejected:true, duplicateClaimRejected:true }));
