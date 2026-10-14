import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction,
  sendAndConfirmTransaction } from '@solana/web3.js';
import { buildTradeTransaction } from '../pump-trading.js';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';

// Disposable, in-memory wallets only. A successful run creates one new V3
// collection and pays its three frozen referral levels through funded.vip.
const mint = new PublicKey('EtMFvbnLJMmp4PWqDVSqYzWfkWhZy3FznJQTN35rYWPc');
const creatorAddress = '8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk';
const authorityAddress = '7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y';
const programId = '9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';
const base = 'https://funded.vip';
const feeOwner = new PublicKey('CmhmRtKYExJC76R5nsPV9ovPYacoEQFEL7VhaKRZmLy2');
assert.equal(process.argv[2], '--execute', 'Pass --execute for the bounded Devnet QA flow.');
const authority = Keypair.fromSecretKey(bs58.decode(readFileSync('.secrets/funded-router-authority-secret-key', 'utf8').trim()));
const creator = Keypair.fromSecretKey(bs58.decode(readFileSync('.secrets/solana-devnet-creator-secret-key', 'utf8').trim()));
assert.equal(authority.publicKey.toBase58(), authorityAddress);
assert.equal(creator.publicKey.toBase58(), creatorAddress);
const connection = new Connection(readFileSync('.secrets/solana-devnet-rpc-url', 'utf8').trim(), 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
const status = await (await fetch(`${base}/api/status`)).json();
assert.equal(status.cluster, 'devnet');
assert.equal(status.status, 'operational');
const launch = (await (await fetch(`${base}/api/launches`)).json()).find(row => row.mint === mint.toBase58());
assert(launch?.onchainVerified && launch.creatorWallet === creatorAddress
  && launch.pumpFeeRoute?.scope === 'per-mint-v3'
  && launch.pumpFeeRoute.programId === programId);
const activity = await (await fetch(`${base}/api/tokens/${mint}/fee-activity`)).json();
assert.equal(activity.overview?.pump?.accruedLamports, '0', 'Use a QA mint with no prior uncollected fees.');
assert.equal(activity.collections?.length, 1, 'This one-shot QA mint already has a new collection; do not create another referral chain.');
const token = readFileSync('.secrets/funded-api-token', 'utf8').trim();
async function post(path, input, authorized = false) {
  const response = await fetch(`${base}${path}`, { method:'POST',
    headers:{ origin:base, 'content-type':'application/json',
      ...(authorized ? { authorization:`Bearer ${token}` } : {}) },
    body:JSON.stringify(input), signal:AbortSignal.timeout(120_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${result.error || 'request failed'}`);
  return result;
}
const sign = (message, wallet) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey));
const referrers = Array.from({ length:3 }, () => Keypair.generate());
const rent = await connection.getMinimumBalanceForRentExemption(0, 'finalized');
assert((await connection.getBalance(authority.publicKey, 'finalized')) > 300_000_000,
  'QA authority needs a 0.3 SOL reserve before the bounded trade.');
const fundSignature = await sendAndConfirmTransaction(connection, new Transaction().add(
  ...referrers.map(wallet => SystemProgram.transfer({ fromPubkey:authority.publicKey,
    toPubkey:wallet.publicKey, lamports:rent + 100_000 }))), [authority], { commitment:'finalized' });
console.log(JSON.stringify({ stage:'ephemeral-wallets-funded', fundSignature,
  wallets:referrers.map(wallet => wallet.publicKey.toBase58()) }));
const codes = [];
for (const wallet of referrers) {
  const prepared = await post('/api/referrals/registration/prepare', { wallet:wallet.publicKey.toBase58() });
  const registered = await post('/api/referrals/registration/verify', {
    wallet:wallet.publicKey.toBase58(), challengeId:prepared.challengeId,
    signature:sign(prepared.statement, wallet) });
  codes.push(registered.code);
}
for (const [child, parentCode] of [
  [referrers[0], codes[1]], [referrers[1], codes[2]], [creator, codes[0]],
]) {
  const prepared = await post('/api/referrals/attribution/prepare', {
    wallet:child.publicKey.toBase58(), code:parentCode, source:'devnet-qa' });
  const attributed = await post('/api/referrals/attribution/verify', {
    wallet:child.publicKey.toBase58(), challengeId:prepared.challengeId,
    signature:sign(prepared.statement, child) });
  assert.equal(attributed.wallet, child.publicKey.toBase58());
}
console.log(JSON.stringify({ stage:'three-level-attribution-recorded',
  creator:creatorAddress, wallets:referrers.map(wallet => wallet.publicKey.toBase58()) }));
// RPC block time may trail the server clock. Wait until the signed attribution
// exists before the fee event's on-chain timestamp.
const attributionCompletedAt = Math.floor(Date.now() / 1000);
let chainCaughtUp = false;
for (let attempt = 0; attempt < 30; attempt++) {
  const slot = await connection.getSlot('finalized');
  const blockTime = await connection.getBlockTime(slot);
  if (blockTime && blockTime > attributionCompletedAt) { chainCaughtUp = true; break; }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert(chainCaughtUp, 'Devnet block time has not caught up to the referral attribution.');
const trade = await buildTradeTransaction({ connection, side:'buy', mint,
  user:authority.publicKey, amount:0.1, slippagePercent:3, feeOwner });
const tradeSignature = await sendAndConfirmTransaction(connection,
  new Transaction().add(...trade.instructions), [authority], { commitment:'finalized' });
console.log(JSON.stringify({ stage:'pump-trade-finalized', tradeSignature }));
const collected = await post('/api/keeper/collect', { mint:mint.toBase58() }, true);
assert.equal(collected.status, 'collected');
assert(collected.onchainVerified && collected.collectedLamports > 0);
console.log(JSON.stringify({ stage:'v3-fees-collected', collectionSignature:collected.signature,
  grossLamports:collected.collectedLamports }));
const settlementPath = `/api/tokens/${mint}/v3-settlement/${collected.signature}`;
const preparedSettlement = await post(settlementPath, {});
assert.equal(preparedSettlement.status, 'awaiting-creator-signature');
const settlementTx = Transaction.from(Buffer.from(preparedSettlement.transaction, 'base64'));
settlementTx.partialSign(creator);
const settlement = await post(settlementPath, { creatorSignedTransaction:settlementTx.serialize({
  requireAllSignatures:false, verifySignatures:false }).toString('base64') });
assert.equal(settlement.status, 'finalized');
assert.deepEqual(settlement.referralUpline, referrers.map(wallet => wallet.publicKey.toBase58()));
console.log(JSON.stringify({ stage:'v3-settlement-finalized', signature:settlement.settlementSignature,
  referralUpline:settlement.referralUpline }));
const payouts = [];
for (const [index, wallet] of referrers.entries()) {
  const level = index + 1;
  const path = `/api/tokens/${mint}/v3-referral-payout/${collected.signature}/${level}`;
  const prepared = await post(path, {});
  assert.equal(prepared.status, 'awaiting-creator-signature');
  assert.equal(prepared.recipient, wallet.publicKey.toBase58());
  assert(BigInt(prepared.amountLamports) > 0n && BigInt(prepared.amountLamports) < 1_000_000n);
  const before = await connection.getBalance(wallet.publicKey, 'finalized');
  const tx = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
  tx.partialSign(creator);
  const paid = await post(path, { creatorSignedTransaction:tx.serialize({
    requireAllSignatures:false, verifySignatures:false }).toString('base64') });
  assert.equal(paid.status, 'finalized');
  assert.equal(paid.balanceDeltaVerified, true);
  assert.equal((await connection.getBalance(wallet.publicKey, 'finalized')) - before,
    Number(prepared.amountLamports));
  payouts.push({ level, wallet:wallet.publicKey.toBase58(),
    amountLamports:prepared.amountLamports, signature:paid.signature });
  console.log(JSON.stringify({ stage:'v3-referral-payout-finalized', ...payouts.at(-1) }));
}
const refreshed = await (await fetch(`${base}/api/rewards/automatic`)).json();
assert.equal(refreshed.modes.referrals, 'v3-referral-payout-recorded');
console.log(JSON.stringify({ status:'finalized-app-recorded-v3-referral-payouts',
  mint:mint.toBase58(), collectionSignature:collected.signature, payouts }, null, 2));
process.exit(0);
