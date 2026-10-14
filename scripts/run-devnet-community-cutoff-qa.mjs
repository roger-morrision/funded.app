import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { qaCommunityCutoffMemo } from '../server/community-snapshot.mjs';

// Disposable Devnet QA only. No private key, manifest, or token is written to disk.
const mint = new PublicKey(process.env.FUNDED_QA_COMMUNITY_MINT || '');
const eligibilityMint = new PublicKey(process.env.FUNDED_TOKEN_MINT || '');
assert.equal(process.env.SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.FUNDED_QA_COMMUNITY_CUTOFF_ENABLED, 'true');
const authority = Keypair.fromSecretKey(bs58.decode(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || ''));
const creator = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY || ''));
assert.equal(authority.publicKey.toBase58(), process.env.FUNDED_QA_COMMUNITY_CUTOFF_AUTHORITY);
assert.equal(creator.publicKey.toBase58(), '8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk');
const rpc = process.env.SOLANA_DEVNET_RPC_URL || readFileSync('.secrets/solana-devnet-rpc-url', 'utf8').trim();
const connection = new Connection(rpc, 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
const api = new URL(process.env.FUNDED_PREVIEW_API_URL || 'https://funded.vip');
assert(['https://funded.vip/', 'http://127.0.0.1:8788/'].includes(api.href));
const token = readFileSync(process.env.FUNDED_API_TOKEN_FILE || '.secrets/funded-api-token', 'utf8').trim();
assert(token, 'The funded.vip QA API bearer token is required.');

async function post(path, body) {
  const response = await fetch(new URL(path, api), { method:'POST',
    headers:{ authorization:`Bearer ${token}`, 'content-type':'application/json', origin:'https://funded.vip' },
    body:JSON.stringify(body), signal:AbortSignal.timeout(90_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${result.error || 'unavailable'}`);
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
const statusResponse = await fetch(new URL('/api/status', api), { signal:AbortSignal.timeout(15_000) });
assert(statusResponse.ok, 'The funded.vip status endpoint is unavailable.');
const status = await statusResponse.json();
assert.equal(status.cluster || status.network, 'devnet', 'App must report Devnet.');
const resume = process.argv.find(arg => arg.startsWith('--resume-opening-signature='))?.split('=')[1];
if (resume && !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(resume))
  throw new Error('A valid finalized opening signature is required for recovery.');
let cutoffSignature, approvalSignature = null, openingSignature, snapshotBasis;
if (resume) {
  const response = await fetch(new URL(`/api/airdrops/claims/status?mint=${mint}`, api),
    { headers:{ authorization:`Bearer ${token}` }, signal:AbortSignal.timeout(15_000) });
  assert(response.ok, 'Prepared QA claim status is unavailable.');
  const prepared = await response.json();
  assert.equal(prepared.snapshotBasis, 'devnet-qa-cutoff');
  cutoffSignature = prepared.migrationSignature;
  openingSignature = resume;
  snapshotBasis = prepared.snapshotBasis;
} else {
  const memo = qaCommunityCutoffMemo({ launchMint:mint, eligibilityMint });
  const marker = new TransactionInstruction({
    programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
    keys:[{ pubkey:authority.publicKey, isSigner:true, isWritable:false }], data:Buffer.from(memo) });
  cutoffSignature = await send(marker, [authority]);
  console.error(JSON.stringify({ step:'cutoff-finalized', signature:cutoffSignature }));
  const prepared = await post('/api/airdrops/claims/prepare-qa', {
    mint:mint.toBase58(), migrationSignature:cutoffSignature });
  assert.equal(prepared.snapshotBasis, 'devnet-qa-cutoff');
  snapshotBasis = prepared.snapshotBasis;
  const approval = await post('/api/airdrops/claims/approval-instruction', {
    mint:mint.toBase58(), appOwner:authority.publicKey.toBase58() });
  approvalSignature = await send(instruction(approval), [authority]);
  console.error(JSON.stringify({ step:'snapshot-approval-finalized', signature:approvalSignature }));
  const opening = await post('/api/airdrops/claims/opening-instruction', { mint:mint.toBase58() });
  openingSignature = await send(instruction(opening), [authority]);
  console.error(JSON.stringify({ step:'drop-opening-finalized', signature:openingSignature }));
}
await post('/api/airdrops/claims/opening-receipt', { mint:mint.toBase58(), signature:openingSignature });
const proofResponse = await fetch(new URL(`/api/airdrops/claims/proof?mint=${mint}&wallet=${creator.publicKey}`, api),
  { signal:AbortSignal.timeout(30_000) });
assert(proofResponse.ok, 'Community proof endpoint is unavailable.');
const proof = await proofResponse.json();
assert.equal(proof.status, 'claimable', 'Disposable creator is not in the verified eligibility snapshot.');
const claim = await post('/api/airdrops/claims/claim-instruction', {
  mint:mint.toBase58(), wallet:creator.publicKey.toBase58() });
const mintInfo = await connection.getAccountInfo(mint, 'finalized');
assert(mintInfo, 'Finalized community mint is unavailable.');
const recipientToken = getAssociatedTokenAddressSync(mint, creator.publicKey, false, mintInfo.owner);
assert.equal(claim.recipientToken, recipientToken.toBase58(), 'Claim instruction targets a different token program.');
const before = await connection.getTokenAccountBalance(recipientToken, 'finalized').catch(() => null);
const claimSignature = await send(instruction(claim), [creator]);
console.error(JSON.stringify({ step:'community-claim-finalized', signature:claimSignature }));
const after = await connection.getTokenAccountBalance(recipientToken, 'finalized');
assert.equal(BigInt(after.value.amount) - BigInt(before?.value?.amount || '0'), BigInt(claim.amount));
const paidResponse = await fetch(new URL(`/api/airdrops/claims/proof?mint=${mint}&wallet=${creator.publicKey}`, api),
  { signal:AbortSignal.timeout(30_000) });
assert(paidResponse.ok && (await paidResponse.json()).status === 'claimed',
  'The finalized CommunityPayment account is not indexed as claimed.');
console.log(JSON.stringify({ status:'finalized-devnet-qa-community-claim',
  snapshotBasis, mint:mint.toBase58(),
  recipient:creator.publicKey.toBase58(), amountBaseUnits:claim.amount,
  cutoffSignature, approvalSignature, openingSignature, claimSignature }, null, 2));
