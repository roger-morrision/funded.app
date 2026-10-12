import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { DEVNET_GENESIS_HASH, readProgramDataEvidence } from '../server/automatic-reward-chain.mjs';

// Single-use, bounded QA settlement. Dry run prepares and inspects the transaction;
// --execute is required to sign and submit the exact creator-approved payout.
const execute = process.argv.includes('--execute');
const origin = 'https://funded.vip';
const mint = '4rgB6cD9voLGCjMdCG5c9FtD9YrXqHJVgatKp2ps5Xih';
const collection = '4xchUGEXFqQTC8PAV6aiD7NKVEUa8Zgoi3RSsApRdESgZs6X8wjbYuhAHEcYwyvGEkahP3wBPxQjJRLNvh1so826';
const claimId = `${collection}:${mint}:x`;
const recipient = 'ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC';
const amount = 187_844n;
const programId = '61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa';
const programHash = '65993e0b50fcf6650ecaa6e8e4b23c1ff345547e55c2d7b07ead4ba81333c77d';
const authority = '7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y';
const expectedCreator = '8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk';

async function request(path, body) {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120_000),
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${data.error || 'unknown error'}`);
  return { status: response.status, data };
}

const [status, browser, xReady, activity] = await Promise.all([
  request('/api/status'), request('/build-settings.json'), request('/api/x-fee/status'),
  request(`/api/tokens/${mint}/fee-activity`),
]);
assert.equal(status.data.cluster, 'devnet');
assert.equal(browser.data.cluster, 'devnet');
assert.equal(browser.data.mainnetEnabled, false);
assert.equal(xReady.data.ready, true);
assert.equal(activity.data.cluster, 'devnet');
if (process.env.X_QA_EXPECT_BUILD) assert.equal(status.data.build, process.env.X_QA_EXPECT_BUILD);
const x = activity.data.overview?.receivers?.find(row => row.id === 'x');
assert.equal(x?.recipient?.toLowerCase(), '@johntrand83');
assert.equal(BigInt(x.allocatedLamports), amount);
assert.equal(BigInt(x.confirmedPaidLamports), 0n, 'This QA payout is already recorded as paid; do not replay it.');
assert.deepEqual(x.payoutSignatures || [], []);

const rpc = (await readFile('.secrets/solana-devnet-rpc-url', 'utf8')).trim();
const connection = new Connection(rpc, 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
const program = await readProgramDataEvidence(connection, new PublicKey(programId));
assert.equal(program.sha256, programHash);

const manifest = JSON.parse(await readFile('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
assert.equal(manifest.find(row => row.role === 'creator' && row.cluster === 'devnet')?.address, expectedCreator);
const prepared = await request(`/api/sol-claims/${encodeURIComponent(claimId)}/execute`, {});
assert.equal(prepared.status, 202);
assert.equal(prepared.data.status, 'awaiting-creator-signature');
assert.equal(prepared.data.creatorWallet, expectedCreator);
assert.equal(prepared.data.recipient, recipient);
assert.equal(prepared.data.claimId, claimId);
assert.equal(BigInt(prepared.data.amountLamports), amount);
const transaction = Transaction.from(Buffer.from(prepared.data.transaction, 'base64'));
assert.equal(transaction.feePayer?.toBase58(), authority);
assert.equal(transaction.instructions.length, 1);
assert.equal(transaction.instructions[0].programId.toBase58(), programId);
assert(transaction.instructions[0].keys.some(key => key.pubkey.toBase58() === recipient));
assert(transaction.instructions[0].keys.some(key => key.pubkey.toBase58() === expectedCreator));

if (!execute) {
  console.log(JSON.stringify({ dryRun: true, build: status.data.build, claimId, recipient,
    amountLamports: amount.toString(), creator: expectedCreator, programId, transactionPrepared: true }));
  process.exit(0);
}

const encoded = (await readFile('.secrets/solana-devnet-creator-secret-key', 'utf8')).trim();
const creator = Keypair.fromSecretKey(bs58.decode(encoded));
assert.equal(creator.publicKey.toBase58(), expectedCreator);
transaction.partialSign(creator);
const paid = await request(`/api/sol-claims/${encodeURIComponent(claimId)}/execute`, {
  creatorSignedTransaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
});
assert.equal(paid.data.status, 'paid');
assert.equal(paid.data.to, recipient);
assert.equal(BigInt(paid.data.amountLamports), amount);
const signature = paid.data.signature;
assert(signature, 'No finalized payout signature returned; reconcile before retrying.');
const finalized = await connection.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
assert(finalized && finalized.meta?.err === null);
const index = finalized.transaction.message.accountKeys.findIndex(key => key.pubkey.toBase58() === recipient);
assert(index >= 0);
const delta = BigInt(finalized.meta.postBalances[index]) - BigInt(finalized.meta.preBalances[index]);
assert.equal(delta, amount);
const after = (await request(`/api/tokens/${mint}/fee-activity`)).data.overview?.receivers?.find(row => row.id === 'x');
assert.equal(BigInt(after.confirmedPaidLamports), amount);
assert(after.payoutSignatures?.includes(signature));
console.log(JSON.stringify({ finalized: true, build: status.data.build, claimId, recipient,
  amountLamports: amount.toString(), recipientDeltaLamports: delta.toString(), signature }));
