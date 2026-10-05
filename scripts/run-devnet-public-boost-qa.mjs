import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, clusterApiUrl } from '@solana/web3.js';
import { BOOST_MEMO_PROGRAM } from '../boost-offer.js';

const mint = new PublicKey(process.argv.find(arg => arg.startsWith('--mint='))?.slice(7) || '');
const execute = process.argv.includes('--execute');
assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false');
const creator = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY || ''));
const manifest = JSON.parse(readFileSync('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
assert.equal(creator.publicKey.toBase58(), manifest.find(row => row.role === 'creator' && row.cluster === 'devnet')?.address,
  'Only the rotated Devnet QA creator may purchase this test Boost.');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const base = 'http://127.0.0.1:8788';
const health = await (await fetch(`${base}/api/health`, { signal:AbortSignal.timeout(15_000) })).json();
assert.equal(health.launchPolicy?.cluster, 'devnet');
const launches = await (await fetch(`${base}/api/launches?limit=100`, { signal:AbortSignal.timeout(15_000) })).json();
assert(launches.some(row => row.mint === mint.toBase58() && row.onchainVerified), 'Use a verified funded.vip QA launch.');

async function post(path, input) {
  const response = await fetch(base + path, { method:'POST', headers:{ origin:'https://funded.vip', 'content-type':'application/json' },
    body:JSON.stringify(input), signal:AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) throw new Error(`${path}: ${response.status} ${data.error || 'request failed'}`);
  return { status:response.status, data };
}

const { status:quoteStatus, data:quote } = await post('/api/boosts/quote', {
  mint:mint.toBase58(), payer:creator.publicKey.toBase58(), packageId:'10x',
});
assert.equal(quoteStatus, 201);
assert.equal(quote.cluster, 'devnet');
assert.equal(quote.mint, mint.toBase58());
assert.equal(quote.payer, creator.publicKey.toBase58());
assert.equal(quote.packageId, '10x');
assert.equal(quote.memo, `funded.vip:boost:devnet:${quote.id}`);
assert(Number.isSafeInteger(quote.lamports) && quote.lamports > 0 && quote.lamports <= 900_000_000,
  'Boost QA payment exceeds the 0.9 Devnet SOL cap.');
assert(Date.parse(quote.expiresAt) - Date.now() > 120_000, 'Boost quote is too close to expiry.');
const recipient = new PublicKey(quote.recipient);
assert(!recipient.equals(creator.publicKey));
const payerBalance = await connection.getBalance(creator.publicKey, 'finalized');
assert(payerBalance >= quote.lamports + 20_000_000, 'QA creator lacks SOL for the bounded Boost payment and fees.');
console.log(JSON.stringify({ stage:'preflight', execute, mint:mint.toBase58(), quoteId:quote.id,
  payer:creator.publicKey.toBase58(), recipient:recipient.toBase58(), amountLamports:quote.lamports,
  payerBalanceLamports:payerBalance, expiresAt:quote.expiresAt, signerManifestVerified:true }));
if (!execute) process.exit(0);

const latest = await connection.getLatestBlockhash('finalized');
const transaction = new Transaction({ feePayer:creator.publicKey, recentBlockhash:latest.blockhash }).add(
  SystemProgram.transfer({ fromPubkey:creator.publicKey, toPubkey:recipient, lamports:quote.lamports }),
  new TransactionInstruction({ keys:[], programId:new PublicKey(BOOST_MEMO_PROGRAM), data:Buffer.from(quote.memo) }),
);
transaction.sign(creator);
const signature = bs58.encode(transaction.signature);
console.log(JSON.stringify({ stage:'signed', quoteId:quote.id, signature }));
const submitted = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight:false, preflightCommitment:'confirmed', maxRetries:2 });
assert.equal(submitted, signature);
const confirmation = await connection.confirmTransaction({ signature, ...latest }, 'finalized');
assert.equal(confirmation.value.err, null);
const receipt = await connection.getTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
assert(receipt && receipt.meta?.err === null);
const recipientIndex = receipt.transaction.message.accountKeys.findIndex(key => key.equals(recipient));
assert(recipientIndex >= 0);
assert.equal(receipt.meta.postBalances[recipientIndex] - receipt.meta.preBalances[recipientIndex], quote.lamports,
  'Boost recipient on-chain balance delta differs from the reviewed quote.');
let confirmed;
for (let attempt = 0; attempt < 10; attempt += 1) {
  confirmed = await post('/api/boosts/confirm', { quoteId:quote.id, signature });
  if (confirmed.status !== 202) break;
  await new Promise(resolve => setTimeout(resolve, 2_000));
}
assert.equal(confirmed?.data?.status, 'finalized', 'Boost payment is finalized but app indexing remains pending. Retry confirmation with the printed signature.');
console.log(JSON.stringify({ stage:'payment-finalized', quoteId:quote.id, signature, recipientDeltaLamports:quote.lamports }));
let boosts;
for (let attempt = 0; attempt < 15; attempt += 1) {
  boosts = await (await fetch(`${base}/api/boosts?mint=${mint.toBase58()}`, { signal:AbortSignal.timeout(15_000) })).json();
  if (boosts.active?.[mint.toBase58()]?.packages?.some(item => item.packageId === '10x')) break;
  await new Promise(resolve => setTimeout(resolve, 2_000));
}
assert(boosts.active?.[mint.toBase58()]?.packages?.some(item => item.packageId === '10x'), 'The paid Boost did not appear in the active package list.');
console.log(JSON.stringify({ stage:'verified', mint:mint.toBase58(), quoteId:quote.id, signature,
  slot:receipt.slot, recipientDeltaLamports:quote.lamports, activeMultiplier:boosts.active[mint.toBase58()].multiplier }));
