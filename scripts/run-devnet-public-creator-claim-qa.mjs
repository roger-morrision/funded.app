import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';

const mint = new PublicKey(process.argv.find(arg => arg.startsWith('--mint='))?.slice(7) || '').toBase58();
const execute = process.argv.includes('--execute');
assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false');
const creator = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY || ''));
const manifest = JSON.parse(readFileSync('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
assert.equal(creator.publicKey.toBase58(), manifest.find(row => row.role === 'creator' && row.cluster === 'devnet')?.address);
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const base = 'http://127.0.0.1:8788';
const get = async path => {
  const response = await fetch(base + path, { signal:AbortSignal.timeout(30_000) });
  const data = await response.json();
  assert(response.ok, `${path}: ${data.error || response.status}`);
  return data;
};
const post = async (path, payload) => {
  const response = await fetch(base + path, { method:'POST', headers:{ origin:'https://funded.vip', 'content-type':'application/json' },
    body:JSON.stringify(payload), signal:AbortSignal.timeout(30_000) });
  const data = await response.json();
  assert(response.ok, `${path}: ${data.error || response.status}`);
  return data;
};
const launch = (await get('/api/launches?limit=100')).find(row => row.mint === mint);
assert(launch?.onchainVerified && launch.cluster === 'devnet' && launch.creatorWallet === creator.publicKey.toBase58());
const path = `/api/tokens/${mint}/fee-activity`;
const before = await get(path);
const claim = before.overview?.creatorClaim;
const amount = BigInt(claim?.claimableLamports || '0');
assert(claim?.eligible && amount >= 10_000_000n && amount <= 50_000_000n, 'Creator claim is not eligible or exceeds the QA cap.');
const receiver = before.overview.receivers.find(row => row.id === 'creator');
const oldPaid = BigInt(receiver.confirmedPaidLamports);
const oldSignatures = new Set(receiver.payoutSignatures);
console.log(JSON.stringify({ stage:'preflight', execute, mint, creator:creator.publicKey.toBase58(), amountLamports:String(amount),
  requestIds:claim.requestIds, paidBeforeLamports:String(oldPaid) }));
if (!execute) process.exit(0);

const challenge = await post(`/api/tokens/${mint}/creator-claim/prepare`, {});
assert.equal(BigInt(challenge.amountLamports), amount);
const signed = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.statement), creator.secretKey));
const requested = await post(`/api/tokens/${mint}/creator-claim/request`, { challengeId:challenge.challengeId, signature:signed });
assert.equal(requested.status, 'payout-requested');
assert.equal(requested.wallet, creator.publicKey.toBase58());
assert.equal(BigInt(requested.amountLamports), amount);
console.log(JSON.stringify({ stage:'requested', mint, amountLamports:String(amount) }));
let paid;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const next = await get(path);
  const current = next.overview.receivers.find(row => row.id === 'creator');
  if (BigInt(current.confirmedPaidLamports) >= oldPaid + amount
    && current.payoutSignatures.some(signature => !oldSignatures.has(signature))) { paid = current; break; }
  await new Promise(resolve => setTimeout(resolve, 10_000));
}
assert(paid, 'Creator payout was not finalized within five minutes.');
const payouts = [];
for (const signature of paid.payoutSignatures.filter(value => !oldSignatures.has(value))) {
  const receipt = await connection.getTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:1 });
  assert(receipt?.meta?.err === null);
  const keys = receipt.transaction.message.staticAccountKeys || receipt.transaction.message.accountKeys;
  const index = keys.findIndex(key => key.toBase58() === creator.publicKey.toBase58());
  assert(index >= 0);
  const delta = BigInt(receipt.meta.postBalances[index] - receipt.meta.preBalances[index]);
  assert(delta > 0n);
  payouts.push({ signature, recipientDeltaLamports:String(delta) });
}
assert.equal(payouts.reduce((sum, row) => sum + BigInt(row.recipientDeltaLamports), 0n), amount);
console.log(JSON.stringify({ stage:'verified', mint, creator:creator.publicKey.toBase58(), amountLamports:String(amount), payouts }));
