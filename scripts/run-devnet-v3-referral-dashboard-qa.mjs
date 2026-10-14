import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { chromium, expect } from '@playwright/test';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction,
  VersionedTransaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { buildTradeTransaction } from '../pump-trading.js';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { quoteAtomicReserveBuy } from '../launch-community-reserve.js';
import { submitPumpDevnetLaunch } from '../launch-flow.js';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { launchPolicyStatement } from '../launch-policy-auth.js';
import { devnetMetadataUri, metadataStatement } from '../devnet-metadata.js';
import { formatReferralLamports } from '../referral-amount.js';

// One-shot Devnet QA. All newly generated wallet keys stay in this process.
assert.equal(process.argv[2], '--execute', 'Pass --execute for bounded Devnet QA.');
const base = 'https://funded.vip';
const programId = '9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';
const authorityAddress = '7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y';
const feeOwner = new PublicKey('CmhmRtKYExJC76R5nsPV9ovPYacoEQFEL7VhaKRZmLy2');
const issuer = Keypair.fromSecretKey(bs58.decode(readFileSync('.secrets/solana-devnet-creator-secret-key', 'utf8').trim()));
const authority = Keypair.fromSecretKey(bs58.decode(readFileSync('.secrets/funded-router-authority-secret-key', 'utf8').trim()));
assert.equal(issuer.publicKey.toBase58(), '8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk');
assert.equal(authority.publicKey.toBase58(), authorityAddress);
const connection = new Connection(readFileSync('.secrets/solana-devnet-rpc-url', 'utf8').trim(), 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
const status = await (await fetch(`${base}/api/status`)).json();
assert.equal(status.cluster, 'devnet');
assert.equal(status.status, 'operational');
const config = await (await fetch(`${base}/api/v3-launch-config`)).json();
const reserveConfig = await (await fetch(`${base}/api/launch-reserve-config`)).json();
assert(config.ready && config.programId === programId && config.initialAuthority === authorityAddress);
assert.equal(reserveConfig.programId, programId);
const quote = await quoteAtomicReserveBuy({ connection, supply:1_000_000_000,
  decimals:6, reserveTokens:30_000_000, developerBaseUnits:0n });
assert(quote.maxSolAmountLamports <= 1_000_000_000n, 'QA community reserve buy exceeds 1 SOL.');
assert((await connection.getBalance(issuer.publicKey, 'finalized')) > 1_500_000_000,
  'Disposable issuer needs more than 1.5 Devnet SOL before funding a QA creator.');
assert((await connection.getBalance(authority.publicKey, 'finalized')) > 250_000_000,
  'Disposable trade authority needs more than 0.25 Devnet SOL.');
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
const creator = Keypair.generate();
const referrers = Array.from({ length:3 }, () => Keypair.generate());
const rent = await connection.getMinimumBalanceForRentExemption(0, 'finalized');
const fundingSignature = await sendAndConfirmTransaction(connection,
  new Transaction().add(SystemProgram.transfer({ fromPubkey:issuer.publicKey,
    toPubkey:creator.publicKey, lamports:1_100_000_000 }),
  ...referrers.map(wallet => SystemProgram.transfer({ fromPubkey:issuer.publicKey,
    toPubkey:wallet.publicKey, lamports:rent + 100_000 }))),
  [issuer], { commitment:'finalized' });
console.error(JSON.stringify({ stage:'disposable-wallets-funded', fundingSignature,
  creator:creator.publicKey.toBase58(), referrers:referrers.map(wallet => wallet.publicKey.toBase58()) }));
const codes = [];
for (const wallet of referrers) {
  const challenge = await post('/api/referrals/registration/prepare', { wallet:wallet.publicKey.toBase58() });
  const record = await post('/api/referrals/registration/verify', {
    wallet:wallet.publicKey.toBase58(), challengeId:challenge.challengeId,
    signature:sign(challenge.statement, wallet) });
  codes.push(record.code);
}
for (const [child, code, parent] of [
  [referrers[0], codes[1], referrers[1]],
  [referrers[1], codes[2], referrers[2]],
  [creator, codes[0], referrers[0]],
]) {
  const challenge = await post('/api/referrals/attribution/prepare', {
    wallet:child.publicKey.toBase58(), code, source:'devnet-qa' });
  const record = await post('/api/referrals/attribution/verify', {
    wallet:child.publicKey.toBase58(), challengeId:challenge.challengeId,
    signature:sign(challenge.statement, child) });
  assert.equal(record.inviterWallet, parent.publicKey.toBase58());
}
console.error(JSON.stringify({ stage:'disposable-upline-recorded', creator:creator.publicKey.toBase58() }));
const suffix = Date.now().toString(36).slice(-6);
const name = `Funded Referral QA ${suffix}`, symbol = 'FRQA';
const launch = await submitPumpDevnetLaunch({ connection, payer:creator.publicKey,
  provider:{ signTransaction:async tx => {
    if (tx instanceof VersionedTransaction) tx.sign([creator]); else tx.partialSign(creator);
    return tx;
  } },
  input:{ name, symbol, supply:1_000_000_000, decimals:6,
    initialBuyPercent:0, reserveTokens:30_000_000,
    maxInitialBuyLamports:quote.maxSolAmountLamports },
  feeRouterProgramId:programId, useMintRouter:true,
  v3FeeRouter:{ programId, initialAuthority:authorityAddress, split:config.protocolSplit },
  reserveConfig,
  prepareMetadata:async ({ mint }) => {
    const record = { mint, creatorWallet:creator.publicKey.toBase58(), name, symbol,
      description:'Disposable Devnet referral dashboard test token. No monetary value.',
      tagline:'Referral QA', roadmap:'', website:'', x:'', telegram:'', discord:'', imageSha256:'' };
    const saved = await post('/api/devnet-metadata', { ...record,
      imageBase64:'', imageType:'', signature:sign(metadataStatement(record), creator) });
    assert.equal(saved.uri, devnetMetadataUri(mint));
    return saved.uri;
  },
  onJournal:event => {
    if (event.signature) console.error(JSON.stringify({ stage:'launch-transaction',
      state:event.state, step:event.step, signature:event.signature }));
  },
});
const mint = (launch.mint.publicKey || launch.mint).toBase58();
console.error(JSON.stringify({ stage:'v3-qa-launch-finalized', mint, signature:launch.signature }));
const feeDistribution = buildFeeDistributionPolicy({ creatorWalletPercent:80,
  holderAirdropPercent:0, solClaimPercent:0, feeRouterAddress:launch.feeRouter.toBase58() });
const policy = { mint, chain:'solana', cluster:'devnet', signature:launch.signature,
  creatorWallet:creator.publicKey.toBase58(), communityAllocation:3,
  feeDistribution, pumpFeeRoute:{ router:launch.feeRouter.toBase58(),
    scope:'per-mint-v3', transaction:launch.signature, programId,
    initialAuthority:authorityAddress, protocolSplit:config.protocolSplit } };
const registered = await post('/api/launches', { ...policy,
  policySignature:sign(launchPolicyStatement(policy), creator) });
assert(registered.onchainVerified && registered.pumpFeeRoute?.scope === 'per-mint-v3');
assert(registered.communityReserve?.verified);
console.error(JSON.stringify({ stage:'v3-qa-launch-registered', mint }));
const attributionCompletedAt = Math.floor(Date.now() / 1000);
let chainCaughtUp = false;
for (let attempt = 0; attempt < 30; attempt++) {
  const blockTime = await connection.getBlockTime(await connection.getSlot('finalized'));
  if (blockTime && blockTime > attributionCompletedAt) { chainCaughtUp = true; break; }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert(chainCaughtUp, 'Devnet block time has not caught up to the referral graph.');
const trade = await buildTradeTransaction({ connection, side:'buy', mint:new PublicKey(mint),
  user:authority.publicKey, amount:0.1, slippagePercent:3, feeOwner });
const tradeSignature = await sendAndConfirmTransaction(connection,
  new Transaction().add(...trade.instructions), [authority], { commitment:'finalized' });
console.error(JSON.stringify({ stage:'v3-qa-trade-finalized', tradeSignature }));
const collected = await post('/api/keeper/collect', { mint }, true);
assert(collected.onchainVerified && collected.status === 'collected' && collected.collectedLamports > 0);
console.error(JSON.stringify({ stage:'v3-qa-collection-finalized', signature:collected.signature,
  amount:collected.collectedLamports }));
async function creatorSigned(path) {
  const prepared = await post(path, {});
  assert.equal(prepared.status, 'awaiting-creator-signature');
  const tx = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
  tx.partialSign(creator);
  return post(path, { creatorSignedTransaction:tx.serialize({
    requireAllSignatures:false, verifySignatures:false }).toString('base64') });
}
const settlement = await creatorSigned(`/api/tokens/${mint}/v3-settlement/${collected.signature}`);
assert.equal(settlement.status, 'finalized');
assert.deepEqual(settlement.referralUpline, referrers.map(wallet => wallet.publicKey.toBase58()));
console.error(JSON.stringify({ stage:'v3-qa-settlement-finalized', signature:settlement.settlementSignature }));
const payouts = [];
const browser = await chromium.launch({ headless:true });
try {
for (const [index, wallet] of referrers.entries()) {
  const level = index + 1;
  const path = `/api/tokens/${mint}/v3-referral-payout/${collected.signature}/${level}`;
  const before = await connection.getBalance(wallet.publicKey, 'finalized');
  const paid = await creatorSigned(path);
  assert(paid.status === 'finalized' && paid.balanceDeltaVerified);
  const after = await connection.getBalance(wallet.publicKey, 'finalized');
  assert.equal(after - before, Number(paid.amount));
  const unsigned = await fetch(`${base}/api/referral-claims?wallet=${wallet.publicKey}`);
  assert.equal(unsigned.status, 401, 'Private referral claims must require a wallet session.');
  const prepared = await post('/api/referrals/session/prepare', { wallet:wallet.publicKey.toBase58() });
  const response = await fetch(`${base}/api/referrals/session/verify`, { method:'POST',
    headers:{ origin:base, 'content-type':'application/json' },
    body:JSON.stringify({ challengeId:prepared.challengeId,
      wallet:wallet.publicKey.toBase58(), signature:sign(prepared.statement, wallet) }),
    signal:AbortSignal.timeout(30_000) });
  const session = await response.json();
  assert(response.ok && session.authenticated && session.wallet === wallet.publicKey.toBase58());
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert(cookie?.startsWith('funded_referral_session='));
  const claimsResponse = await fetch(`${base}/api/referral-claims?wallet=${wallet.publicKey}`, {
    headers:{ cookie }, signal:AbortSignal.timeout(30_000) });
  assert(claimsResponse.ok);
  const claims = await claimsResponse.json();
  assert(claims.claims.some(row => row.level === level && row.mint === mint
    && row.payoutSignature === paid.signature && row.amountLamports === paid.amount
    && row.status === 'paid'));
  const dashboardResponse = await fetch(`${base}/api/referrals/dashboard?wallet=${wallet.publicKey}`, {
    headers:{ cookie }, signal:AbortSignal.timeout(30_000) });
  assert(dashboardResponse.ok);
  const dashboard = await dashboardResponse.json();
  assert(dashboard.qualifiedCreators >= 1);
  // The session cookie was issued for a real signed challenge. Only the
  // extension provider is emulated so the headless browser can connect.
  const context = await browser.newContext();
  await context.addCookies([{ name:'funded_referral_session',
    value:cookie.slice(cookie.indexOf('=') + 1), url:base,
    httpOnly:true, secure:true, sameSite:'Lax' }]);
  await context.addInitScript(({ address }) => {
    localStorage.setItem('funded.app.wallet.provider', 'phantom');
    const listeners = new Map();
    const provider = {
      isPhantom:true, isConnected:false, publicKey:null,
      on(event, callback) { listeners.set(event,
        [...(listeners.get(event) || []), callback]); },
      async connect() { provider.publicKey = { toBase58:() => address,
        toString:() => address }; provider.isConnected = true;
        for (const callback of listeners.get('connect') || []) callback(provider.publicKey);
        return { publicKey:provider.publicKey }; },
      async signMessage() { throw new Error('The already signed QA session must be reused.'); },
    };
    window.phantom = { solana:provider };
    window.solana = provider;
  }, { address:wallet.publicKey.toBase58() });
  const page = await context.newPage();
  await page.goto(`${base}/#referrals`, { waitUntil:'domcontentloaded' });
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state', 'ready',
    { timeout:45_000 });
  await expect(page.locator('#connect-button')).toHaveClass(/wallet-pill-connected/);
  const displayAmount = `${formatReferralLamports(paid.amount)} SOL`;
  try {
    await expect(page.locator('#referral-paid-total')).toHaveText(displayAmount,
      { timeout:30_000 });
    await expect(page.locator('#referral-ledger-list')).toContainText(displayAmount);
    await expect(page.locator('#referral-claim-center')).toContainText(paid.signature);
  } catch (error) {
    console.error(JSON.stringify({ stage:'live-referral-browser-failed',
      wallet:wallet.publicKey.toBase58(), connectedClass:await page.locator('#connect-button').getAttribute('class'),
      panel:await page.locator('#referral-claim-center').innerText() }));
    throw error;
  }
  await context.close();
  payouts.push({ level, wallet:wallet.publicKey.toBase58(), signature:paid.signature,
    amountLamports:paid.amount, dashboardClaimVisible:true, browserDashboardVisible:true,
    qualifiedCreators:dashboard.qualifiedCreators });
  console.error(JSON.stringify({ stage:'private-referral-dashboard-verified', ...payouts.at(-1) }));
}
} finally { await browser.close(); }
console.log(JSON.stringify({ status:'finalized-v3-referral-private-dashboard', mint,
  launchSignature:launch.signature, tradeSignature, collectionSignature:collected.signature,
  settlementSignature:settlement.settlementSignature, payouts }, null, 2));
process.exit(0);
