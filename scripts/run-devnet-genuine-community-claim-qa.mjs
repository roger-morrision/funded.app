import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { verifyPumpMigrationTransaction } from '../server/community-snapshot.mjs';

// Completes one already-prepared genuine Pump migration drop on disposable Devnet.
const mint = new PublicKey(process.argv.find(arg => arg.startsWith('--mint='))?.slice(7) || '');
const migrationSignature = process.argv.find(arg => arg.startsWith('--migration-signature='))?.slice(22);
assert.match(migrationSignature || '', /^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
const authority = Keypair.fromSecretKey(bs58.decode(readFileSync('.secrets/funded-router-authority-secret-key', 'utf8').trim()));
const creator = Keypair.fromSecretKey(bs58.decode(readFileSync('.secrets/solana-devnet-creator-secret-key', 'utf8').trim()));
assert.equal(authority.publicKey.toBase58(), '7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
assert.equal(creator.publicKey.toBase58(), '8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk');
const connection = new Connection(readFileSync('.secrets/solana-devnet-rpc-url', 'utf8').trim(), 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
const migration = await connection.getTransaction(migrationSignature,
  { commitment:'finalized', maxSupportedTransactionVersion:0 });
const migrated = verifyPumpMigrationTransaction({ transaction:migration, launchMint:mint });
const base = 'https://funded.vip';
const token = readFileSync('.secrets/funded-api-token', 'utf8').trim();
async function post(path, input) {
  const response = await fetch(`${base}${path}`, { method:'POST',
    headers:{ authorization:`Bearer ${token}`, origin:base, 'content-type':'application/json' },
    body:JSON.stringify(input), signal:AbortSignal.timeout(120_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${result.error || 'request failed'}`);
  return result;
}
function instruction(row) {
  return new TransactionInstruction({ programId:new PublicKey(row.programId),
    keys:row.accounts.map(account => ({ pubkey:new PublicKey(account.pubkey),
      isSigner:account.isSigner, isWritable:account.isWritable })),
    data:Buffer.from(row.data, 'base64') });
}
async function send(ix, signers) {
  return sendAndConfirmTransaction(connection, new Transaction().add(ix), signers,
    { commitment:'finalized', skipPreflight:false });
}
const statusResponse = await fetch(`${base}/api/airdrops/claims/status?mint=${mint}`, {
  headers:{ authorization:`Bearer ${token}` }, signal:AbortSignal.timeout(30_000) });
assert(statusResponse.ok);
const prepared = await statusResponse.json();
assert.equal(prepared.status, 'prepared');
assert.equal(prepared.snapshotBasis, 'pump-migration');
assert.equal(prepared.migrationSignature, migrationSignature);
assert.equal(prepared.migrationSlot, migrated.slot);
const approval = await post('/api/airdrops/claims/approval-instruction', {
  mint:mint.toBase58(), appOwner:authority.publicKey.toBase58() });
const approvalSignature = await send(instruction(approval), [authority]);
console.error(JSON.stringify({ stage:'genuine-snapshot-approval-finalized', signature:approvalSignature }));
const opening = await post('/api/airdrops/claims/opening-instruction', { mint:mint.toBase58() });
const openingSignature = await send(instruction(opening), [authority]);
console.error(JSON.stringify({ stage:'genuine-drop-opening-finalized', signature:openingSignature }));
await post('/api/airdrops/claims/opening-receipt', { mint:mint.toBase58(), signature:openingSignature });
const proofUrl = `${base}/api/airdrops/claims/proof?mint=${mint}&wallet=${creator.publicKey}`;
const proofResponse = await fetch(proofUrl, { signal:AbortSignal.timeout(30_000) });
assert(proofResponse.ok);
const proof = await proofResponse.json();
assert.equal(proof.status, 'claimable');
const claim = await post('/api/airdrops/claims/claim-instruction', {
  mint:mint.toBase58(), wallet:creator.publicKey.toBase58() });
const mintInfo = await connection.getAccountInfo(mint, 'finalized');
assert(mintInfo);
const recipientToken = getAssociatedTokenAddressSync(mint, creator.publicKey, false, mintInfo.owner);
assert.equal(claim.recipientToken, recipientToken.toBase58());
const before = await connection.getTokenAccountBalance(recipientToken, 'finalized').catch(() => null);
const claimSignature = await send(instruction(claim), [creator]);
console.error(JSON.stringify({ stage:'genuine-community-claim-finalized', signature:claimSignature }));
const after = await connection.getTokenAccountBalance(recipientToken, 'finalized');
assert.equal(BigInt(after.value.amount) - BigInt(before?.value?.amount || '0'), BigInt(claim.amount));
const paidResponse = await fetch(proofUrl, { signal:AbortSignal.timeout(30_000) });
assert(paidResponse.ok && (await paidResponse.json()).status === 'claimed');
console.log(JSON.stringify({ status:'finalized-genuine-pump-migration-community-claim',
  mint:mint.toBase58(), migrationSignature, migrationSlot:migrated.slot,
  approvalSignature, openingSignature, claimSignature,
  recipient:creator.publicKey.toBase58(), amountBaseUnits:claim.amount }, null, 2));
process.exit(0);
