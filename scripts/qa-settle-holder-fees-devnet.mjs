import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, Transaction } from '@solana/web3.js';

const base = 'https://funded.vip';
const mint = 'EtMFvbnLJMmp4PWqDVSqYzWfkWhZy3FznJQTN35rYWPc';
const collection = process.argv.find(value => value.startsWith('--collection='))?.slice(13);
const execute = process.argv.includes('--execute');
assert(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(collection || ''), 'A finalized QA collection signature is required.');
const creator = Keypair.fromSecretKey(bs58.decode(readFileSync('.secrets/solana-devnet-creator-secret-key', 'utf8').trim()));
assert.equal(creator.publicKey.toBase58(), '8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk');
const connection = new Connection(readFileSync('.secrets/solana-devnet-rpc-url', 'utf8').trim(), 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const launchResponse = await fetch(`${base}/api/launches`, { signal:AbortSignal.timeout(20_000) });
assert(launchResponse.ok);
const launch = (await launchResponse.json()).find(row => row.mint === mint);
assert(launch?.onchainVerified && launch.cluster === 'devnet' && launch.pumpFeeRoute?.scope === 'per-mint-v3');
assert.equal(launch.creatorWallet, creator.publicKey.toBase58());

async function post(path, input) {
  const response = await fetch(`${base}${path}`, { method:'POST', headers:{
    origin:base, 'content-type':'application/json' }, body:JSON.stringify(input), signal:AbortSignal.timeout(120_000) });
  const result = await response.json();
  assert(response.ok, `${path}: HTTP ${response.status}, ${result.error || 'unknown error'}`);
  return result;
}
async function creatorSigned(path) {
  const prepared = await post(path, {});
  if (prepared.status === 'finalized') return prepared;
  assert.equal(prepared.status, 'awaiting-creator-signature');
  const transaction = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
  transaction.partialSign(creator);
  const settled = await post(path, { creatorSignedTransaction:transaction.serialize({
    requireAllSignatures:false, verifySignatures:false }).toString('base64') });
  assert.equal(settled.status, 'finalized');
  return settled;
}
const settlementPath = `/api/tokens/${mint}/v3-settlement/${collection}`;
const prepared = await post(settlementPath, {});
console.log(JSON.stringify({ stage:'preflight', cluster:'devnet', mint, collection,
  creator:creator.publicKey.toBase58(), status:prepared.status,
  amountLamports:prepared.amountLamports || prepared.expectedLamports || null, execute }));
if (!execute) process.exit(0);
const settlement = prepared.status === 'finalized' ? prepared : await creatorSigned(settlementPath);
assert.equal(settlement.status, 'finalized');
const funding = await creatorSigned(`/api/tokens/${mint}/v3-creator-reward-funding/${collection}`);
assert.equal(funding.status, 'finalized');
assert.equal(funding.balanceDeltaVerified, true);
for (const signature of [settlement.settlementSignature, funding.signature]) {
  const status = await connection.getSignatureStatus(signature, { searchTransactionHistory:true });
  assert.equal(status.value?.confirmationStatus, 'finalized');
  assert.equal(status.value?.err, null);
}
console.log(JSON.stringify({ stage:'funded-finalized', mint, collection,
  settlementSignature:settlement.settlementSignature, fundingSignature:funding.signature,
  holderLamports:settlement.allocationPlan?.creatorDirected?.holderLamports,
  xLamports:settlement.allocationPlan?.creatorDirected?.xLamports,
  fundedAmountLamports:funding.amount, recipient:funding.recipient }));
process.exit(0);
