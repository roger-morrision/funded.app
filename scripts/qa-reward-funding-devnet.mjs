// A deliberately narrow, repeatable check for the disposable ZYNC Devnet mint.
// Dry run by default. --execute signs only the three exact collection allocations.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { clusterApiUrl, Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { deriveMintFeeRouter } from '../fee-router.js';
import { DEVNET_GENESIS_HASH, readProgramDataEvidence } from '../server/automatic-reward-chain.mjs';
import { buildMintRouterSettlementInstruction, readMintClaimRecord } from '../server/mint-router-payout.mjs';
import { verifyFinalizedSettlementDelta } from '../server/creator-settlement-transaction.mjs';

const mint = 'ZYNCP99vqtdQmiFUG7uvYTBPi66UGKJjRo2zNVLnQAL';
const source = '5hAsYG6cZZpsiANfb2rLdxvKkp12VgLJuHnTV2pLhx875Bu8JpC3ctQEqUeyqWRcXpRiAeyqCSCRtqLQHW3K8F6r';
const programId = '61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa';
const programHash = '65993e0b50fcf6650ecaa6e8e4b23c1ff345547e55c2d7b07ead4ba81333c77d';
const creatorAddress = '8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk';
const authorityAddress = '7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y';
const expected = [
  { id:`${source}:holders`, kind:'holder', amount:'1790808', domain:'holder-funding' },
  { id:`${source}:operations`, kind:'operations', amount:'1790808', domain:'operations-funding' },
  { id:`${source}:community`, kind:'community-reserve', amount:'358162', domain:'community-reserve' },
];
const execute = process.argv.includes('--execute');
assert.equal(process.env.VITE_SOLANA_CLUSTER || process.env.SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false');
assert.equal(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID, programId);
assert.equal(process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256, programHash);
assert.equal(process.env.FUNDED_REWARD_AUTHORITY, authorityAddress);
const rpcFile = process.env.SOLANA_RPC_URL_FILE || process.env.SOLANA_DEVNET_RPC_URL_FILE;
const rpcUrl = rpcFile ? readFileSync(rpcFile, 'utf8').trim() : clusterApiUrl('devnet');
const connection = new Connection(rpcUrl, { commitment:'finalized', disableRetryOnRateLimit:true });
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
const program = await readProgramDataEvidence(connection, new PublicKey(programId));
assert.equal(program.sha256, programHash, 'The deployed router bytecode differs.');
const router = deriveMintFeeRouter(programId, mint).address;
const routerAccount = await connection.getAccountInfo(router, 'finalized');
assert(routerAccount?.owner.equals(new PublicKey(programId)), 'QA mint router belongs to another program.');
const routerBefore = routerAccount.lamports;
const rentFloor = await connection.getMinimumBalanceForRentExemption(routerAccount.data.length, 'finalized');
const total = expected.reduce((sum, row) => sum + Number(row.amount), 0);
assert(routerBefore - total >= rentFloor, 'The three allocations would violate router rent.');

const base = 'http://127.0.0.1:8787';
const path = `/api/tokens/${mint}/reward-funding`;
async function request(url, body) {
  const response = await fetch(base + url, { method:body ? 'POST' : 'GET',
    headers:{ origin:'https://funded.vip', ...(body ? { 'content-type':'application/json' } : {}) },
    body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(120_000) });
  const result = await response.json();
  assert(response.ok, `${url}: HTTP ${response.status}: ${result.error || 'request failed'}`);
  return result;
}
const pending = await request(`${path}/pending`);
assert.equal(pending.creatorWallet, creatorAddress);
for (const row of expected) {
  const actual = pending.requests.find(request => request.id === row.id);
  assert(actual, `Missing immutable allocation ${row.kind}.`);
  assert.equal(actual.kind, row.kind);
  assert.equal(actual.amountLamports, row.amount);
  assert(['pending','awaiting-creator-signature'].includes(actual.status), `${row.kind} was already attempted; reconcile before rerunning.`);
}
console.log(JSON.stringify({ stage:'preflight', mode:execute ? 'approved-execution' : 'read-only',
  cluster:'devnet', mint, programId, programHash, router:router.toBase58(), routerBefore,
  rentFloor, total, allocations:expected.map(({ id, kind, amount }) => ({ id, kind, amount })) }));
if (!execute) process.exit(0);

const creatorFile = process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY_FILE;
assert(creatorFile, 'The mounted disposable QA creator key file is required.');
const creator = Keypair.fromSecretKey(bs58.decode(readFileSync(creatorFile, 'utf8').trim()));
assert.equal(creator.publicKey.toBase58(), creatorAddress, 'The mounted signer is not the QA creator.');
for (const row of expected) {
  const prepared = await request(`${path}/settle`, { requestId:row.id });
  assert.equal(prepared.status, 'awaiting-creator-signature');
  assert.equal(prepared.requestId, row.id);
  assert.equal(prepared.creatorWallet, creatorAddress);
  assert.equal(prepared.amountLamports, row.amount);
  assert.equal(prepared.kind, row.kind);
  const recipient = new PublicKey(prepared.recipient);
  const instruction = buildMintRouterSettlementInstruction({ programId, mint, authority:authorityAddress,
    creator:creatorAddress, recipient, amountLamports:row.amount, obligationId:row.id, claimDomain:row.domain });
  const transaction = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
  assert.equal(transaction.feePayer.toBase58(), authorityAddress);
  const exact = new Transaction({ feePayer:new PublicKey(authorityAddress), recentBlockhash:transaction.recentBlockhash })
    .add(instruction);
  assert(transaction.serializeMessage().equals(exact.serializeMessage()), 'Prepared transaction differs from the capped allocation.');
  assert.equal(await connection.getAccountInfo(instruction.claim, 'finalized'), null, 'Allocation claim already exists.');
  const destinationBefore = await connection.getBalance(recipient, 'finalized');
  transaction.partialSign(creator);
  const settled = await request(`${path}/settle`, { requestId:row.id,
    creatorSignedTransaction:transaction.serialize({ requireAllSignatures:false, verifySignatures:false }).toString('base64') });
  assert.equal(settled.status, 'vault-funded');
  assert.equal(settled.requestId, row.id);
  assert.equal(settled.amountLamports, row.amount);
  assert.equal(settled.recipient, recipient.toBase58());
  assert.equal(settled.claim, instruction.claim.toBase58());
  assert(readMintClaimRecord(await connection.getAccountInfo(instruction.claim, 'finalized'), {
    programId, mint, recipient, amountLamports:row.amount, claimId:instruction.claimId, share:instruction.share }),
  'Finalized on-chain claim does not match the allocation.');
  await verifyFinalizedSettlementDelta({ connection, signature:settled.signature, router, recipient, amountLamports:row.amount });
  const destinationAfter = await connection.getBalance(recipient, 'finalized');
  assert.equal(destinationAfter - destinationBefore, Number(row.amount), 'Finalized vault balance delta differs.');
  console.log(JSON.stringify({ stage:'finalized', kind:row.kind, requestId:row.id, signature:settled.signature,
    claim:settled.claim, recipient:settled.recipient, amountLamports:row.amount,
    destinationBefore, destinationAfter, exactBalanceDeltaVerified:true }));
}
const routerAfter = await connection.getBalance(router, 'finalized');
assert.equal(routerBefore - routerAfter, total, 'Router balance did not decrease by exactly the approved total.');
console.log(JSON.stringify({ stage:'complete', cluster:'devnet', mint, routerBefore, routerAfter, total,
  finalizedAllocations:expected.length, privateKeyPersistedByTest:false }));
