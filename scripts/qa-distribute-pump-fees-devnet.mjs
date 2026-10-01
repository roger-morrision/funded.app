import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js';

const mint = process.argv[2];
const collectionSignature = process.argv[3];
assert.match(mint || '', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Pass the QA mint.');
assert.match(collectionSignature || '', /^[1-9A-HJ-NP-Za-km-z]{64,88}$/, 'Pass its new collection signature.');
assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet', 'Devnet only.');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false', 'Mainnet must stay disabled.');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', 'Configured RPC is not Devnet.');
const creator = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY || ''));
const referralWallets = [
  process.env.SOLANA_DEVNET_REFERRER_SECRET_KEY,
  process.env.SOLANA_DEVNET_REFERRER_LEVEL_2_SECRET_KEY,
  process.env.SOLANA_DEVNET_REFERRER_LEVEL_3_SECRET_KEY,
].map(value => Keypair.fromSecretKey(bs58.decode(value || '')));
assert.equal(creator.publicKey.toBase58(), '8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk', 'Unexpected QA creator.');
assert.deepEqual(referralWallets.map(wallet => wallet.publicKey.toBase58()), [
  '7ngaVZdeipr6uZy2inh267PjZLLYFuAfsPoTRZixjJMk',
  '9wFEV3bLscLqvXVYwXMyF5CaniccndLi4fGivSCuYs3R',
  '4yRRW1ikd1JaSzZFCngnx2ChuUHu1FRdRCTS6m5NN42v',
], 'Unexpected QA referral wallets.');

const base = 'http://127.0.0.1:8788';
const token = readFileSync('.secrets/funded-api-token', 'utf8').trim();
async function request(path, input, authenticated = false) {
  const response = await fetch(base + path, { method:input ? 'POST' : 'GET', headers:{
    origin:'https://funded.vip', ...(input ? { 'content-type':'application/json' } : {}),
    ...(authenticated ? { authorization:`Bearer ${token}` } : {}),
  }, body:input ? JSON.stringify(input) : undefined, signal:AbortSignal.timeout(30_000) });
  const data = await response.json();
  assert(response.ok, `${path}: ${response.status} ${data.error || 'request failed'}`);
  return data;
}
const sign = (statement, wallet) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(statement), wallet.secretKey));
const activityPath = `/api/tokens/${mint}/fee-activity`;
const activity = await request(activityPath);
assert(activity.collections.some(row => row.signature === collectionSignature && row.collectedLamports > 0), 'Collection is not recorded for this mint.');
assert.equal(activity.overview.creatorWallet, creator.publicKey.toBase58(), 'Mint belongs to a different creator.');
const allocation = activity.overview.receivers;
for (const [index, wallet] of referralWallets.entries()) {
  assert.equal(allocation.find(row => row.id === `referral-${index + 1}`)?.recipient, wallet.publicKey.toBase58(), `Referral level ${index + 1} recipient differs.`);
}

const referrals = [];
for (const [index, wallet] of referralWallets.entries()) {
  const level = index + 1;
  const prepared = await request('/api/referral-claims/prepare', { settlementSignature:collectionSignature, recipientWallet:wallet.publicKey.toBase58(), level }, true);
  assert(Number(prepared.amount) > 0 && Number(prepared.amount) <= 0.001, 'Referral payout exceeds QA cap.');
  await request(`/api/referral-claims/${prepared.id}/verify`, { publicKey:wallet.publicKey.toBase58(), signature:sign(prepared.statement, wallet) });
  const before = await connection.getBalance(wallet.publicKey, 'finalized');
  const paid = await request(`/api/referral-claims/${prepared.id}/execute`, {});
  assert.equal(paid.status, 'paid');
  const chain = await connection.getSignatureStatus(paid.signature, { searchTransactionHistory:true });
  assert.equal(chain.value?.confirmationStatus, 'finalized');
  assert.equal(chain.value?.err, null);
  const after = await connection.getBalance(wallet.publicKey, 'finalized');
  const expected = Math.round(Number(prepared.amount) * 1_000_000_000);
  assert.equal(after - before, expected, `Referral level ${level} balance delta differs.`);
  referrals.push({ level, wallet:wallet.publicKey.toBase58(), amountLamports:expected, signature:paid.signature });
}

const refreshed = await request(activityPath);
if (process.argv.includes('--referrals-only')) {
  console.log(JSON.stringify({ cluster:'devnet', mint, collectionSignature, referrals, creator:'not-tested-in-referrals-only-mode' }, null, 2));
  process.exit(0);
}
assert(refreshed.overview.creatorClaim.eligible, 'Creator claim did not reach the minimum.');
assert(BigInt(refreshed.overview.creatorClaim.claimableLamports) <= 50_000_000n, 'Creator payout exceeds QA cap.');
const creatorBefore = refreshed.overview.receivers.find(item => item.id === 'creator');
const previouslyPaid = BigInt(creatorBefore.confirmedPaidLamports);
const previousSignatures = new Set(creatorBefore.payoutSignatures);
const challenge = await request(`/api/tokens/${mint}/creator-claim/prepare`, {});
const requested = await request(`/api/tokens/${mint}/creator-claim/request`, {
  challengeId:challenge.challengeId, signature:sign(challenge.statement, creator),
});
assert.equal(requested.status, 'payout-requested');
assert.equal(requested.wallet, creator.publicKey.toBase58());
const amount = BigInt(requested.amountLamports);
let creatorPaid = null;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const next = await request(activityPath);
  const row = next.overview.receivers.find(item => item.id === 'creator');
  if (BigInt(row.confirmedPaidLamports) >= previouslyPaid + amount
    && row.payoutSignatures.some(signature => !previousSignatures.has(signature))) {
    creatorPaid = row;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 10_000));
}
assert(creatorPaid, 'Creator payout was not finalized within five minutes.');
const creatorPayouts = [];
for (const signature of creatorPaid.payoutSignatures.filter(signature => !previousSignatures.has(signature))) {
  const tx = await connection.getTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:1 });
  assert(tx && tx.meta?.err == null, 'Creator payout transaction is not finalized.');
  const keys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
  const index = keys.findIndex(key => key.toBase58() === creator.publicKey.toBase58());
  assert(index >= 0, 'Creator is missing from payout transaction.');
  const delta = BigInt(tx.meta.postBalances[index] - tx.meta.preBalances[index]);
  assert(delta > 0n, 'Creator did not receive SOL in payout transaction.');
  creatorPayouts.push({ signature, recipientDeltaLamports:String(delta) });
}
assert.equal(creatorPayouts.reduce((sum, row) => sum + BigInt(row.recipientDeltaLamports), 0n), amount,
  'New creator payout signatures do not total the requested amount.');
console.log(JSON.stringify({ cluster:'devnet', mint, collectionSignature, referrals, creator:{ wallet:creator.publicKey.toBase58(), requestedLamports:String(amount), payouts:creatorPayouts } }, null, 2));
