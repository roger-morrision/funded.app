import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from '@solana/web3.js';
import { OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import { buildTradeTransaction } from '../pump-trading.js';
import { buildMintRouterInitializeInstruction } from '../mint-router-launch.js';
import { deriveFeeRouter, verifyMintFeeRouterAccount } from '../fee-router.js';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { launchPolicyStatement } from '../launch-policy-auth.js';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { createAutomaticRewardChain } from '../server/automatic-reward-chain.mjs';
import { createHolderHistoryIndexer } from '../server/holder-history-indexer.mjs';
import { createRewardScheduler } from '../server/reward-scheduler.mjs';
import { createRewardFundingProcessor } from '../server/reward-funding-processor.mjs';

const cluster = String(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER || '').trim();
assert.equal(cluster, 'devnet', 'This verifier is restricted to Solana Devnet.');
assert.equal(String(process.env.VITE_ALLOW_MAINNET || 'false'), 'false', 'Mainnet must remain disabled.');

function configuredWallet(name) {
  const encoded = String(process.env[name] || '').trim();
  assert(encoded, `${name} is required.`);
  return Keypair.fromSecretKey(bs58.decode(encoded));
}

const creator = configuredWallet('SOLANA_DEVNET_CREATOR_SECRET_KEY');
const holder = configuredWallet('SOLANA_DEVNET_CLAIMANT_SECRET_KEY');
const referrer = configuredWallet('SOLANA_DEVNET_REFERRER_SECRET_KEY');
const level2Key = process.env.SOLANA_DEVNET_REFERRER_LEVEL_2_SECRET_KEY;
const level3Key = process.env.SOLANA_DEVNET_REFERRER_LEVEL_3_SECRET_KEY;
assert.equal(Boolean(level2Key), Boolean(level3Key), 'Both additional referral wallets must be configured together.');
const referralWallets = level2Key ? [referrer, configuredWallet('SOLANA_DEVNET_REFERRER_LEVEL_2_SECRET_KEY'), configuredWallet('SOLANA_DEVNET_REFERRER_LEVEL_3_SECRET_KEY')] : [referrer];
const keeper = configuredWallet('SOLANA_KEEPER_SECRET_KEY');
const authority = configuredWallet('FUNDED_ROUTER_AUTHORITY_SECRET_KEY');
const payoutPath = String(process.env.SOLANA_REFERRAL_PAYOUT_KEYPAIR_PATH || '').trim();
const payoutSecret = String(process.env.SOLANA_REFERRAL_PAYOUT_SECRET_KEY || '').trim();
assert(payoutPath || payoutSecret, 'A dedicated referral payout signer is required before starting the on-chain journey.');
const payout = payoutPath
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(payoutPath, 'utf8'))))
  : Keypair.fromSecretKey(bs58.decode(payoutSecret));
const pumpRevenue = new PublicKey(process.env.FUNDED_PUMP_REVENUE_WALLET || '').toBase58();
const tradeFeeOwner = String(process.env.FUNDED_TRADE_FEE_OWNER || process.env.VITE_FUNDED_TRADE_FEE_OWNER || '').trim();
assert.equal(new Set([creator, holder, ...referralWallets, keeper, authority].map(wallet => wallet.publicKey.toBase58()).concat(pumpRevenue)).size, 5 + referralWallets.length, 'Test wallet and app roles must be distinct.');
assert(![keeper, authority, ...referralWallets, creator, holder].some(wallet => wallet.publicKey.equals(payout.publicKey))
  && ![pumpRevenue, tradeFeeOwner].includes(payout.publicKey.toBase58()), 'The referral payout signer must be a dedicated wallet.');

const rpcUrl = String(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet')).trim();
const connection = new Connection(rpcUrl, 'finalized');
const official = new Connection(clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), await official.getGenesisHash(), 'Configured RPC is not Solana Devnet.');
assert((await connection.getBalance(payout.publicKey, 'finalized')) > 10_000_000,
  'The dedicated referral payout signer needs at least 0.01 Devnet SOL before starting the journey.');

const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID);
const expectedProgramDataSha256 = String(process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256 || '').trim();
assert(expectedProgramDataSha256, 'FUNDED_REWARD_PROGRAM_DATA_SHA256 is required.');
const legacyRouter = await connection.getAccountInfo(deriveFeeRouter(programId).address, 'finalized');
assert(legacyRouter?.data?.length === 74 && new PublicKey(legacyRouter.data.subarray(41, 73)).equals(authority.publicKey),
  'The configured router authority does not match the on-chain Devnet router; no test transaction was sent.');

async function finalizedTransaction(instructions, signers) {
  // Use a finalized blockhash so every backend behind an RPC load balancer has
  // observed it before preflight. This avoids false "blockhash not found"
  // failures from a confirmed hash returned by a node ahead of its peers.
  const latest = await connection.getLatestBlockhash('finalized');
  const transaction = new Transaction({ recentBlockhash: latest.blockhash, feePayer: signers[0].publicKey }).add(...instructions);
  transaction.sign(...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'finalized');
  assert.equal(confirmation.value.err, null, `Devnet transaction failed: ${signature}`);
  const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
  assert.equal(status.value?.confirmationStatus, 'finalized', `Devnet transaction is not finalized: ${signature}`);
  assert.equal(status.value?.err, null, `Devnet transaction finalized with an error: ${signature}`);
  return signature;
}

async function ensureCreatorFunding() {
  const target = 70_000_000;
  const creatorBalance = await connection.getBalance(creator.publicKey, 'finalized');
  if (creatorBalance >= target) return { signature: null, amount: 0, before: creatorBalance, after: creatorBalance };
  const amount = target - creatorBalance;
  const sourceBalance = await connection.getBalance(referrer.publicKey, 'finalized');
  assert(sourceBalance > amount + 20_000_000, 'The configured Devnet referrer wallet cannot safely top up the creator test wallet.');
  const signature = await finalizedTransaction([
    SystemProgram.transfer({ fromPubkey: referrer.publicKey, toPubkey: creator.publicKey, lamports: amount }),
  ], [referrer]);
  const after = await connection.getBalance(creator.publicKey, 'finalized');
  assert.equal(after - creatorBalance, amount, 'Creator test-wallet top-up did not produce the exact finalized balance delta.');
  return { signature, amount, before: creatorBalance, after };
}

async function waitForServer(base, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Isolated API exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Isolated API did not become ready.');
}

async function waitForFinalizedSignature(signature) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    if (status.value?.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.value.err)}`);
    if (status.value?.confirmationStatus === 'finalized') return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Transaction ${signature} did not finalize within the verification window.`);
}

function walletSignature(statement, wallet) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(statement), wallet.secretKey));
}

const fixtureDirectory = await mkdtemp(join(tmpdir(), 'funded-test-wallet-journey-'));
const storePath = join(fixtureDirectory, 'funded-store.json');
const automaticStorePath = join(fixtureDirectory, 'automatic-rewards.json');
const apiToken = randomBytes(24).toString('hex');
const port = 18_000 + Math.floor(Math.random() * 2_000);
const base = `http://127.0.0.1:${port}`;
let serverOutput = '';
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATABASE_URL: '',
    FUNDED_STORE_PATH: storePath,
    AUTOMATIC_REWARD_STORE_PATH: automaticStorePath,
    FUNDED_API_TOKEN: apiToken,
    CORS_ORIGIN: base,
    SOLANA_CLUSTER: 'devnet',
    VITE_SOLANA_CLUSTER: 'devnet',
    VITE_ALLOW_MAINNET: 'false',
    SOLANA_RPC_URL: rpcUrl,
    FUNDED_FEE_ROUTER_PROGRAM_ID: programId.toBase58(),
    VITE_FUNDED_FEE_ROUTER_PROGRAM_ID: programId.toBase58(),
    FUNDED_MINT_FEE_ROUTER_ENABLED: 'true',
    SOLANA_KEEPER_CONFIGURED: 'true',
    SOLANA_ALLOW_KEEPER_TRANSFER: 'true',
    DEVNET_TEST_MODE: 'true',
    FUNDED_ROUTER_AUTHORITY_SECRET_KEY: process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY,
    SOLANA_KEEPER_SECRET_KEY: process.env.SOLANA_KEEPER_SECRET_KEY,
    FUNDED_PUMP_REVENUE_WALLET: pumpRevenue,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverOutput = `${serverOutput}${chunk}`.slice(-12_000); });

async function post(path, input, { authorized = false, cookie = null } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { origin: base, cookie } : {}),
      ...(authorized ? { authorization: `Bearer ${apiToken}` } : {}),
    },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}

async function referralSessionCookie(wallet) {
  const challenge = await fetch(`${base}/api/referrals/session/prepare`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ wallet: wallet.publicKey.toBase58() }),
  });
  const prepared = await challenge.json();
  assert(challenge.ok, `Referral session preparation failed: ${prepared.error || challenge.status}`);
  const verified = await fetch(`${base}/api/referrals/session/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ challengeId: prepared.challengeId, wallet: wallet.publicKey.toBase58(), signature: walletSignature(prepared.statement, wallet) }),
  });
  const result = await verified.json();
  assert(verified.ok && result.wallet === wallet.publicKey.toBase58(), `Referral session verification failed: ${result.error || verified.status}`);
  const cookie = verified.headers.get('set-cookie')?.split(';', 1)[0];
  assert(cookie?.startsWith('funded_referral_session='), 'Referral session cookie was not issued.');
  return cookie;
}

let result;
let stage = 'starting-isolated-api';
try {
  await waitForServer(base, server);
  stage = 'checking-mint-router-readiness';
  const routeResponse = await fetch(`${base}/api/mint-router/status`);
  assert(routeResponse.ok, 'Mint-router readiness endpoint failed.');
  const routeStatus = await routeResponse.json();
  assert.equal(routeStatus.ready, true,
    `Mint-specific collection is not ready: ${(routeStatus.reasons || []).join('; ')}`);
  stage = 'funding-creator-test-wallet';
  const topUp = await ensureCreatorFunding();

  stage = 'registering-referral';
  let inviterCode = null;
  for (const wallet of [...referralWallets].reverse()) {
    const registration = await post('/api/referrals/registration/prepare', { wallet: wallet.publicKey.toBase58() });
    const registered = await post('/api/referrals/registration/verify', {
      challengeId: registration.challengeId,
      wallet: wallet.publicKey.toBase58(),
      signature: walletSignature(registration.statement, wallet),
    });
    if (inviterCode) {
      const attribution = await post('/api/referrals/attribution/prepare', { wallet: wallet.publicKey.toBase58(), code: inviterCode });
      const attributed = await post('/api/referrals/attribution/verify', {
        challengeId: attribution.challengeId,
        wallet: wallet.publicKey.toBase58(),
        signature: walletSignature(attribution.statement, wallet),
      });
      assert.equal(attributed.inviterWallet, referralWallets[referralWallets.indexOf(wallet) + 1].publicKey.toBase58());
    }
    inviterCode = registered.code;
  }
  const attribution = await post('/api/referrals/attribution/prepare', { wallet: creator.publicKey.toBase58(), code: inviterCode });
  const attributed = await post('/api/referrals/attribution/verify', {
    challengeId: attribution.challengeId,
    wallet: creator.publicKey.toBase58(),
    signature: walletSignature(attribution.statement, creator),
  });
  assert.equal(attributed.inviterWallet, referrer.publicKey.toBase58(), 'Creator referral attribution does not match the test referrer.');

  stage = 'initializing-mint-router';
  const mint = Keypair.generate();
  const initialized = buildMintRouterInitializeInstruction({ programId, mint: mint.publicKey, payer: creator.publicKey });
  const mintRouterSignature = await finalizedTransaction([initialized.instruction], [creator, mint]);
  const checkedRouter = await verifyMintFeeRouterAccount({ connection, programId, mint: mint.publicKey, expectedAuthority: authority.publicKey });
  assert(checkedRouter.verified, `Mint router verification failed: ${checkedRouter.reason}`);
  const router = checkedRouter.address;

  stage = 'creating-pump-coin';
  const launchName = `Funded Journey ${Date.now().toString(36).slice(-6)}`;
  const launchSymbol = 'FJNY';
  const launchInstruction = await PUMP_SDK.createV2Instruction({
    mint: mint.publicKey,
    name: launchName,
    symbol: launchSymbol,
    uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`,
    creator: router,
    user: creator.publicKey,
    mayhemMode: false,
    holderReward: false,
  });
  const launchSignature = await finalizedTransaction([launchInstruction], [creator, mint]);
  const curve = await new OnlinePumpSdk(connection).fetchBondingCurve(mint.publicKey);
  assert(curve.creator.equals(router), 'Pump creator-fee authority does not match the mint router.');

  stage = 'registering-launch-policy';
  const feeDistribution = buildFeeDistributionPolicy({
    creatorWalletPercent: 70,
    holderAirdropPercent: 10,
    solClaimPercent: 0,
    feeRouterAddress: router.toBase58(),
  });
  const launchRecord = {
    mint: mint.publicKey.toBase58(),
    chain: 'solana',
    cluster: 'devnet',
    signature: launchSignature,
    creatorWallet: creator.publicKey.toBase58(),
    communityAllocation: 3,
    feeDistribution,
    pumpFeeRoute: { router: router.toBase58(), scope: 'per-mint-v2', transaction: launchSignature },
  };
  launchRecord.policySignature = walletSignature(launchPolicyStatement(launchRecord), creator);
  const registeredLaunch = await post('/api/launches', launchRecord);
  assert.equal(registeredLaunch.onchainVerified, true, 'The app did not verify the Devnet launch on chain.');
  assert.equal(registeredLaunch.automaticRewards?.status, 'registered', 'The app did not register holder rewards for the launch.');

  stage = 'buying-launch-token';
  const holderSolBeforeTrade = await connection.getBalance(holder.publicKey, 'finalized');
  assert(holderSolBeforeTrade > 20_000_000, 'The holder test wallet needs more than 0.02 Devnet SOL.');
  const sharedRouter = deriveFeeRouter(programId).address;
  const feeOwner = new PublicKey(process.env.VITE_FUNDED_TRADE_FEE_OWNER || sharedRouter.toBase58());
  const buy = await buildTradeTransaction({ connection, side: 'buy', mint: mint.publicKey, user: holder.publicKey, amount: 0.01, slippagePercent: 3, feeOwner });
  const buySignature = await finalizedTransaction(buy.instructions, [holder]);
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(holder.publicKey, { mint: mint.publicKey }, 'finalized');
  assert.equal(tokenAccounts.value.length, 1, 'The holder buy did not create exactly one token account.');
  const rawAfterBuy = BigInt(tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount);
  const decimals = Number(tokenAccounts.value[0].account.data.parsed.info.tokenAmount.decimals);
  assert(rawAfterBuy > 0n, 'The finalized buy produced no holder tokens.');
  stage = 'selling-partial-launch-token-balance';
  const sellAmount = Number(rawAfterBuy) / (10 ** decimals) * 0.2;
  const sell = await buildTradeTransaction({ connection, side: 'sell', mint: mint.publicKey, user: holder.publicKey, amount: sellAmount, slippagePercent: 3, feeOwner });
  const sellSignature = await finalizedTransaction(sell.instructions, [holder]);
  const rawAfterSell = BigInt((await connection.getTokenAccountBalance(tokenAccounts.value[0].pubkey, 'finalized')).value.amount);
  assert(rawAfterSell > 0n && rawAfterSell < rawAfterBuy, 'The holder sell did not leave the expected positive token balance.');

  stage = 'collecting-creator-fees';
  const collection = await post('/api/keeper/collect', { mint: mint.publicKey.toBase58() }, { authorized: true });
  assert.equal(collection.status, 'collected', 'The app did not collect a positive creator-fee balance.');
  assert.equal(collection.onchainVerified, true, 'The creator-fee collection lacks on-chain mint-router evidence.');
  assert(Number(collection.collectedLamports) > 0, 'The creator-fee collection produced no positive balance delta.');
  await waitForFinalizedSignature(collection.signature);

  stage = 'settling-collected-fees';
  const settlement = await post('/api/settlements/claims', { claimSignature: collection.signature }, { authorized: true });
  for (const [index, wallet] of referralWallets.entries()) {
    const referralLevel = settlement.fundedApp.referralLevels.find(item => item.level === index + 1);
    assert.equal(referralLevel?.recipient, wallet.publicKey.toBase58(), `Settlement did not resolve referral level ${index + 1}.`);
    assert.equal(referralLevel?.status, 'claimable', `Referral level ${index + 1} is not claimable.`);
  }
  assert(Number(settlement.creatorDestinations.holderAirdrop) > 0, 'Settlement did not allocate a positive holder reward.');

  stage = 'executing-manual-referral-claim';
  const manualReferralClaims = [];
  for (const [index, wallet] of referralWallets.entries()) {
    const level = index + 1;
    const manualClaim = await post('/api/referral-claims/prepare', {
      settlementSignature: collection.signature,
      recipientWallet: wallet.publicKey.toBase58(),
      level,
    }, { authorized: true });
    const verifiedClaim = await post(`/api/referral-claims/${manualClaim.id}/verify`, {
      publicKey: wallet.publicKey.toBase58(),
      signature: walletSignature(manualClaim.statement, wallet),
    });
    assert.equal(verifiedClaim.status, 'wallet-verified', `Referral level ${level} wallet signature was not accepted.`);
    const before = await connection.getBalance(wallet.publicKey, 'finalized');
    const cookie = await referralSessionCookie(wallet);
    const payout = await post(`/api/referral-claims/${manualClaim.id}/execute`, {}, { cookie });
    await waitForFinalizedSignature(payout.signature);
    const after = await connection.getBalance(wallet.publicKey, 'finalized');
    const expected = Math.floor(Number(manualClaim.amount) * 1_000_000_000);
    assert.equal(after - before, expected, `Referral level ${level} payout lacks the exact finalized recipient balance delta.`);
    manualReferralClaims.push({ level, recipient:wallet.publicKey.toBase58(), claimId:manualClaim.id, amountSol:manualClaim.amount,
      payoutSignature:payout.signature, finalizedBalanceDeltaLamports:String(after - before) });
  }

  stage = 'processing-automatic-reward-funding';
  const automaticStore = createAutomaticRewardStore(automaticStorePath);
  const chain = createAutomaticRewardChain({ connection, programId, authority, expectedProgramDataSha256 });
  const indexer = createHolderHistoryIndexer({ connection, store: automaticStore, rpcUrl });
  const scheduler = createRewardScheduler({ store: automaticStore, chain, indexer });
  const fundingProcessor = createRewardFundingProcessor({ store: automaticStore, chain, scheduler });
  const fundingResult = await fundingProcessor.processPending();
  assert.equal(fundingResult.status, 'processed', 'Queued automatic reward funding was not processed.');
  assert(fundingResult.funded >= 2, 'Holder and operations automatic funding requests were not both funded.');

  stage = 'capturing-finalized-holder-history';
  const now = Math.floor(Date.now() / 1000);
  // Model the just-completed hour so the accelerated test remains payable
  // against Solana's real on-chain clock. Snapshot timestamps and pool timing
  // are isolated test-ledger inputs; every balance and transfer remains real.
  const periodStart = Math.floor(now / 3600) * 3600 - 3600;
  const cutoffAt = periodStart + 3600;
  const opening = await indexer.capture(mint.publicKey.toBase58(), periodStart * 1000);
  assert(opening.accounts.some(row => row.wallet === holder.publicKey.toBase58() && BigInt(row.balance) > 0n), 'Finalized holder indexing did not include the test holder.');
  const initialSlot = opening.slot;
  for (let attempt = 0; attempt < 40 && await connection.getSlot('finalized') <= initialSlot; attempt += 1) await new Promise(resolve => setTimeout(resolve, 250));
  const closing = await indexer.capture(mint.publicKey.toBase58(), (cutoffAt - 1) * 1000);
  assert(closing.slot > initialSlot, 'A second finalized holder snapshot could not be captured.');
  const excludedWallets = closing.accounts.filter(row => row.wallet !== holder.publicKey.toBase58()).map(row => row.wallet);

  await scheduler.register({
    mint: mint.publicKey.toBase58(),
    asset: 'SOL',
    periodSeconds: 3600,
    sampleIntervalSeconds: 1800,
    payoutDelaySeconds: 0,
    activatedAt: periodStart,
    firstPeriodStart: periodStart,
    excludedWallets,
  });
  const rewardState = await automaticStore.read();
  const availableHolderFunding = Object.values(rewardState.rewardPools || {})
    .filter(pool => pool.mint === mint.publicKey.toBase58() && pool.asset === 'SOL' && pool.status === 'available' && pool.fundedAt >= periodStart && pool.fundedAt < cutoffAt)
    .reduce((sum, pool) => sum + BigInt(pool.amount), 0n);
  const automaticMinimum = 10_000_000n;
  let automaticTopUp = null;
  if (availableHolderFunding < automaticMinimum) {
    stage = 'topping-up-automatic-holder-pool';
    const amount = automaticMinimum - availableHolderFunding;
    automaticTopUp = await chain.fundSolVault({ mint: mint.publicKey.toBase58(), amount: String(amount) });
    await scheduler.recordFundedPool({
      id: `test-wallet-top-up:${launchSignature}`,
      mint: mint.publicKey.toBase58(),
      asset: 'SOL',
      amount: String(amount),
      fundingSignature: automaticTopUp.signature,
      balanceDeltaVerified: automaticTopUp.balanceDeltaVerified,
      fundedAt: cutoffAt - 1,
    });
  }

  stage = 'executing-automatic-holder-reward';
  const holderBalanceBefore = await connection.getBalance(holder.publicKey, 'finalized');
  const prepared = await scheduler.prepare(now);
  assert(prepared.some(item => item.mint === mint.publicKey.toBase58()), 'The accelerated holder schedule was not prepared.');
  const execution = await scheduler.execute(now);
  assert(execution.submitted >= 1, 'The automatic holder reward submitted no payout.');
  const finalRewardState = await automaticStore.read();
  const creatorSchedule = Object.values(finalRewardState.schedules || {}).find(row => row.kind === 'creator' && row.mint === mint.publicKey.toBase58());
  const creatorRequest = Object.values(finalRewardState.fundingRequests || {}).find(row => row.kind === 'creator' && row.mint === mint.publicKey.toBase58());
  assert.equal(creatorRequest?.status, 'claimable', 'Creator fees must remain claimable until the creator requests payout.');
  assert.equal(creatorSchedule, undefined, 'Creator fees below the claim minimum must not be paid automatically.');
  const creatorPrepare = await fetch(`${base}/api/tokens/${mint.publicKey.toBase58()}/creator-claim/prepare`, {
    method:'POST', headers:{ 'content-type':'application/json', origin:base }, body:'{}',
  });
  const creatorMinimum = await creatorPrepare.json();
  assert.equal(creatorPrepare.status, 409, 'A creator claim below the 0.01 SOL minimum must be rejected.');
  assert.equal(creatorMinimum.eligible, false);
  assert.equal(creatorMinimum.claimableLamports, creatorRequest.amount);
  assert.equal(creatorMinimum.minimumLamports, '10000000');
  const holderSchedule = Object.values(finalRewardState.schedules || {}).find(row => row.kind === 'holder' && row.mint === mint.publicKey.toBase58() && row.periodStart === periodStart);
  assert.equal(holderSchedule?.status, 'paid', 'The automatic holder schedule did not reach paid status.');
  const holderPayment = holderSchedule.payments?.[holder.publicKey.toBase58()];
  assert.equal(holderPayment?.status, 'paid', 'The indexed holder did not receive the automatic reward.');
  await waitForFinalizedSignature(holderPayment.signature);
  const holderBalanceAfter = await connection.getBalance(holder.publicKey, 'finalized');
  assert.equal(BigInt(holderBalanceAfter - holderBalanceBefore), BigInt(holderPayment.amount), 'Automatic holder payout lacks the exact finalized recipient balance delta.');

  result = {
    status: 'passed',
    verification: 'devnet-test-wallet-create-trade-holder-and-referral-rewards',
    cluster: 'devnet',
    mainnetEnabled: false,
    privateKeysPersisted: false,
    isolatedLedger: fixtureDirectory,
    scheduleClock: 'accelerated-one-hour-test-period',
    wallets: {
      creator: creator.publicKey.toBase58(),
      holder: holder.publicKey.toBase58(),
      referrer: referrer.publicKey.toBase58(),
      referralLevel2: referralWallets[1]?.publicKey.toBase58() || null,
      referralLevel3: referralWallets[2]?.publicKey.toBase58() || null,
    },
    coin: {
      mint: mint.publicKey.toBase58(),
      router: router.toBase58(),
      mintRouterSignature,
      launchSignature,
      name: launchName,
      symbol: launchSymbol,
    },
    trades: {
      buySignature,
      sellSignature,
      tokenUnitsAfterBuy: rawAfterBuy.toString(),
      tokenUnitsAfterSell: rawAfterSell.toString(),
    },
    fees: {
      collectionSignature: collection.signature,
      collectedLamports: String(collection.collectedLamports),
      settlementStatus: settlement.status,
      holderAllocationSol: settlement.creatorDestinations.holderAirdrop,
    },
    manualReferralClaims,
    automaticHolderReward: {
      scheduleId: holderSchedule.id,
      snapshotSlots: holderSchedule.snapshotSlots,
      sourceFundingLamports: availableHolderFunding.toString(),
      topUpSignature: automaticTopUp?.signature || null,
      payoutSignature: holderPayment.signature,
      paymentAccount: holderPayment.payment,
      finalizedBalanceDeltaLamports: String(holderBalanceAfter - holderBalanceBefore),
    },
    creatorClaim: {
      status: 'below-minimum',
      claimableLamports: creatorMinimum.claimableLamports,
      minimumLamports: creatorMinimum.minimumLamports,
    },
    creatorTopUp: topUp,
  };
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', stage, error: String(error.message || error), isolatedLedger: fixtureDirectory, serverOutput }, null, 2));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
}
