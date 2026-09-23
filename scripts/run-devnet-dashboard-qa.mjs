import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { submitPumpDevnetLaunch } from '../launch-flow.js';
import { buildTradeTransaction } from '../pump-trading.js';
import { deriveFeeRouter, verifyFeeRouterAccount } from '../fee-router.js';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { buildLaunchBurnPolicy, createLaunchBurnTiers } from '../launch-burn-policy.js';
import { launchPolicyStatement } from '../launch-policy-auth.js';

const execute = process.argv.includes('--execute');
const cluster = String(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER || '').trim();
assert.equal(cluster, 'devnet', 'This QA journey is restricted to Solana Devnet.');
assert.equal(String(process.env.VITE_ALLOW_MAINNET || 'false'), 'false', 'Mainnet must remain disabled.');
assert.ok(process.env.DATABASE_URL, 'The shared dashboard PostgreSQL DATABASE_URL is required.');
assert.ok(process.env.FUNDED_API_TOKEN, 'FUNDED_API_TOKEN is required.');

function configuredWallet(name) {
  const encoded = String(process.env[name] || '').trim();
  assert(encoded, `${name} is required.`);
  return Keypair.fromSecretKey(bs58.decode(encoded));
}

const creator = configuredWallet('SOLANA_DEVNET_CREATOR_SECRET_KEY');
const holder = configuredWallet('SOLANA_DEVNET_CLAIMANT_SECRET_KEY');
const referrer = configuredWallet('SOLANA_DEVNET_REFERRER_SECRET_KEY');
assert.equal(new Set([creator.publicKey, holder.publicKey, referrer.publicKey].map(key => key.toBase58())).size, 3, 'QA wallet roles must be distinct.');

const rpcUrl = String(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet')).trim();
const connection = new Connection(rpcUrl, 'finalized');
const official = new Connection(clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), await official.getGenesisHash(), 'Configured RPC is not Solana Devnet.');

const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID);
const fundedMint = new PublicKey(process.env.FUNDED_TOKEN_MINT || process.env.VITE_FUNDED_TOKEN_MINT);
const sharedRouter = deriveFeeRouter(programId);
const checkedSharedRouter = await verifyFeeRouterAccount({ connection, programId: programId.toBase58() });
assert.equal(checkedSharedRouter.verified, true, `The shared fee router is not verified: ${checkedSharedRouter.reason}`);
assert.equal(checkedSharedRouter.address.toBase58(), sharedRouter.address.toBase58(), 'Configured shared router PDA does not match the program.');

const [creatorBalance, holderBalance, referrerBalance, fundedMintAccount] = await Promise.all([
  connection.getBalance(creator.publicKey, 'finalized'),
  connection.getBalance(holder.publicKey, 'finalized'),
  connection.getBalance(referrer.publicKey, 'finalized'),
  getMint(connection, fundedMint, 'finalized'),
]);
const creatorFundedAccount = await getAccount(connection, getAssociatedTokenAddressSync(fundedMint, creator.publicKey), 'finalized');
const burnPolicy = buildLaunchBurnPolicy({
  tierId: 'boost',
  fundedMint: fundedMint.toBase58(),
  tiers: createLaunchBurnTiers({
    boostAmount: Number(process.env.VITE_FUNDED_BOOST_BURN_AMOUNT || 25_000),
    proAmount: Number(process.env.VITE_FUNDED_PRO_BURN_AMOUNT || 100_000),
    premierAmount: Number(process.env.VITE_FUNDED_PREMIER_BURN_AMOUNT || 250_000),
  }),
});
const burnBaseUnits = BigInt(burnPolicy.amountTokens) * (10n ** BigInt(fundedMintAccount.decimals));
assert(creatorBalance >= 35_000_000, 'The creator test wallet needs at least 0.035 Devnet SOL. No faucet request was attempted.');
assert(holderBalance >= 25_000_000, 'The holder test wallet needs at least 0.025 Devnet SOL. No faucet request was attempted.');
assert(referrerBalance >= 5_000_000, 'The referrer test wallet needs at least 0.005 Devnet SOL. No faucet request was attempted.');
assert(creatorFundedAccount.amount >= burnBaseUnits, `The creator test wallet needs ${burnPolicy.amountTokens} $FUNDED for the Boost burn.`);

console.log(JSON.stringify({
  stage: 'preflight',
  mode: execute ? 'execute' : 'read-only',
  cluster,
  mainnetEnabled: false,
  database: 'shared-postgresql',
  faucetRequested: false,
  wallets: {
    creator: creator.publicKey.toBase58(),
    holder: holder.publicKey.toBase58(),
    referrer: referrer.publicKey.toBase58(),
  },
  balancesSol: {
    creator: creatorBalance / 1e9,
    holder: holderBalance / 1e9,
    referrer: referrerBalance / 1e9,
  },
  fundedBalanceTokens: Number(creatorFundedAccount.amount) / (10 ** fundedMintAccount.decimals),
  promotionBurnTokens: burnPolicy.amountTokens,
  router: sharedRouter.address.toBase58(),
}));
if (!execute) process.exit(0);

const base = 'http://127.0.0.1:8795';
const apiToken = process.env.FUNDED_API_TOKEN;
let serverOutput = '';
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '8795',
    SOLANA_CLUSTER: 'devnet',
    VITE_SOLANA_CLUSTER: 'devnet',
    VITE_ALLOW_MAINNET: 'false',
    DEVNET_TEST_MODE: 'true',
    DEV_MODE: 'false',
    SOLANA_KEEPER_CONFIGURED: 'true',
    SOLANA_ALLOW_KEEPER_TRANSFER: 'true',
    FUNDED_MINT_FEE_ROUTER_ENABLED: 'true',
    SOLANA_KEEPER_SECRET_KEY: process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY,
    FUNDED_ROUTER_AUTHORITY_SECRET_KEY: process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', chunk => { serverOutput = `${serverOutput}${chunk}`.slice(-16_000); });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode != null) throw new Error(`QA API exited with code ${server.exitCode}.`);
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('QA API did not become ready.');
}

async function request(path, { method = 'GET', input, authorized = false } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(input === undefined ? {} : { 'content-type': 'application/json' }),
      ...(authorized ? { authorization: `Bearer ${apiToken}` } : {}),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}

async function post(path, input, options = {}) {
  return request(path, { method: 'POST', input, ...options });
}

function walletSignature(statement, wallet) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(statement), wallet.secretKey));
}

async function waitForFinalizedSignature(signature) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    if (status.value?.err) throw new Error(`Devnet transaction failed: ${signature} ${JSON.stringify(status.value.err)}`);
    if (status.value?.confirmationStatus === 'finalized') return;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Devnet transaction did not finalize: ${signature}`);
}

async function finalizedTrade({ side, mint, wallet, amount }) {
  const prepared = await buildTradeTransaction({
    connection,
    side,
    mint,
    user: wallet.publicKey,
    amount,
    slippagePercent: 3,
    feeOwner: sharedRouter.address,
  });
  const latest = await connection.getLatestBlockhash('finalized');
  const transaction = new Transaction({ recentBlockhash: latest.blockhash, feePayer: wallet.publicKey }).add(...prepared.instructions);
  transaction.sign(wallet);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'finalized');
  assert.equal(confirmation.value.err, null, `${side} transaction failed: ${signature}`);
  await waitForFinalizedSignature(signature);
  return { signature, feeLamports: prepared.feeLamports };
}

let stage = 'starting-shared-ledger-api';
let result;
try {
  const health = await waitForServer();
  assert.equal(health.ok, true, 'QA API is unhealthy.');

  stage = 'registering-referrer';
  const registrationChallenge = await post('/api/referrals/registration/prepare', { wallet: referrer.publicKey.toBase58() });
  const registration = await post('/api/referrals/registration/verify', {
    challengeId: registrationChallenge.challengeId,
    wallet: referrer.publicKey.toBase58(),
    signature: walletSignature(registrationChallenge.statement, referrer),
  });

  stage = 'attributing-creator-referral';
  const attributionChallenge = await post('/api/referrals/attribution/prepare', {
    wallet: creator.publicKey.toBase58(),
    code: registration.code,
  });
  const attribution = await post('/api/referrals/attribution/verify', {
    challengeId: attributionChallenge.challengeId,
    wallet: creator.publicKey.toBase58(),
    signature: walletSignature(attributionChallenge.statement, creator),
  });
  assert.equal(attribution.inviterWallet, referrer.publicKey.toBase58(), 'The creator is already attributed to a different wallet.');

  stage = 'launching-boost-coin';
  const name = `Funded Dashboard QA ${Date.now().toString(36).slice(-6)}`;
  const symbol = 'FDQA';
  const provider = { signTransaction: async transaction => { transaction.partialSign(creator); return transaction; } };
  const launch = await submitPumpDevnetLaunch({
    connection,
    provider,
    payer: creator.publicKey,
    input: { name, symbol, supply: 1_000_000_000, decimals: 6, initialBuyPercent: 0 },
    feeRouterAddress: sharedRouter.address.toBase58(),
    feeRouterProgramId: programId,
    useMintRouter: true,
    launchBurn: burnPolicy,
  });
  await waitForFinalizedSignature(launch.signature);
  if (launch.mintRouterSignature) await waitForFinalizedSignature(launch.mintRouterSignature);
  assert.equal(launch.launchBurnReceipt?.verified, true, 'The Boost $FUNDED burn was not verified.');

  stage = 'registering-launch-policy';
  const feeDistribution = buildFeeDistributionPolicy({
    creatorWalletPercent: 70,
    holderAirdropPercent: 10,
    solClaimPercent: 0,
    feeRouterAddress: launch.feeRouter.toBase58(),
  });
  const launchRecord = {
    chain: 'solana',
    cluster: 'devnet',
    mint: launch.mint.publicKey.toBase58(),
    creatorWallet: creator.publicKey.toBase58(),
    name,
    symbol,
    signature: launch.signature,
    communityAllocation: 3,
    feeDistribution,
    creatorLaunchBurn: { ...burnPolicy, status: 'verified', receipt: launch.launchBurnReceipt },
    pumpFeeRoute: {
      router: launch.feeRouter.toBase58(),
      scope: 'per-mint-v2',
      transaction: launch.signature,
    },
  };
  launchRecord.policySignature = walletSignature(launchPolicyStatement(launchRecord), creator);
  const registeredLaunch = await post('/api/launches', launchRecord);
  assert.equal(registeredLaunch.onchainVerified, true, 'The shared launch record is not on-chain verified.');
  assert.equal(registeredLaunch.automaticRewards?.status, 'registered', 'Automatic rewards were not registered for the launch.');
  assert.equal(registeredLaunch.communityAirdrop?.reservedTokens, 30_000_000, 'The 3% community reserve was not published.');

  stage = 'buying-and-selling-coin';
  const mint = launch.mint.publicKey;
  const buy = await finalizedTrade({ side: 'buy', mint, wallet: holder, amount: 0.01 });
  const holderTokenAccount = getAssociatedTokenAddressSync(mint, holder.publicKey);
  const rawAfterBuy = (await getAccount(connection, holderTokenAccount, 'finalized')).amount;
  assert(rawAfterBuy > 0n, 'The finalized buy produced no holder tokens.');
  const sellTokens = Number(rawAfterBuy / 5n) / 1_000_000;
  assert(sellTokens > 0, 'The holder balance is too small for a partial sell.');
  const sell = await finalizedTrade({ side: 'sell', mint, wallet: holder, amount: sellTokens });
  const rawAfterSell = (await getAccount(connection, holderTokenAccount, 'finalized')).amount;
  assert(rawAfterSell > 0n && rawAfterSell < rawAfterBuy, 'The partial sell did not leave the expected positive holder balance.');

  stage = 'collecting-creator-fees';
  const collection = await post('/api/keeper/collect', { mint: mint.toBase58() }, { authorized: true });
  assert.equal(collection.status, 'collected', 'The test trades produced no collectible creator fees.');
  assert.equal(collection.onchainVerified, true, 'The collection lacks mint-router evidence.');
  assert(Number(collection.collectedLamports) > 0, 'The collection recorded no positive balance delta.');
  await waitForFinalizedSignature(collection.signature);

  stage = 'settling-fee-distribution';
  const settlement = await post('/api/settlements/claims', { claimSignature: collection.signature }, { authorized: true });
  const referralLevel = settlement.fundedApp.referralLevels.find(item => item.level === 1);
  assert.equal(referralLevel?.recipient, referrer.publicKey.toBase58(), 'The direct referral recipient was not resolved.');
  assert.equal(referralLevel?.status, 'claimable', 'The direct referral reward is not claimable.');
  assert(Number(settlement.creatorDestinations.holderAirdrop) > 0, 'The holder reward allocation is not positive.');
  assert.notEqual(settlement.automaticRewards?.status, 'queue-failed', 'Automatic reward funding was not queued.');

  stage = 'executing-wallet-signed-referral-claim';
  const claim = await post('/api/referral-claims/prepare', {
    settlementSignature: collection.signature,
    recipientWallet: referrer.publicKey.toBase58(),
    level: 1,
  }, { authorized: true });
  const verifiedClaim = await post(`/api/referral-claims/${claim.id}/verify`, {
    publicKey: referrer.publicKey.toBase58(),
    signature: walletSignature(claim.statement, referrer),
  });
  assert.equal(verifiedClaim.status, 'wallet-verified', 'The referral claim signature was not accepted.');
  const referralBefore = await connection.getBalance(referrer.publicKey, 'finalized');
  const payout = await post(`/api/referral-claims/${claim.id}/execute`, {});
  await waitForFinalizedSignature(payout.signature);
  const referralAfter = await connection.getBalance(referrer.publicKey, 'finalized');
  const expectedReferralLamports = Math.floor(Number(claim.amount) * 1_000_000_000);
  assert.equal(referralAfter - referralBefore, expectedReferralLamports, 'The referral payout lacks the exact finalized recipient balance delta.');

  stage = 'indexing-market-activity';
  const activity = await request(`/api/tokens/${mint.toBase58()}/market-activity`);
  assert(Number(activity.tradeCount24h) >= 2, 'The shared market index did not find both test trades.');
  assert(Number(activity.volume24hSol) > 0, 'The shared market index recorded no trading volume.');

  stage = 'verifying-dashboard-evidence';
  const evidence = await request('/api/evidence/receipts');
  const verifiedCollection = evidence.verifiedCollections?.find(item => item.signature === collection.signature);
  const verifiedPayout = evidence.verifiedPayouts?.find(item => item.signature === payout.signature);
  assert(verifiedCollection, 'The collection signature is absent from verified dashboard evidence.');
  assert(verifiedPayout, 'The referral payout signature is absent from verified dashboard evidence.');
  assert.equal(verifiedPayout.source, 'solana-keeper-referral-claim', 'The payout is not labeled as a referral claim.');

  result = {
    status: 'passed',
    verification: 'shared-dashboard-devnet-test-wallet-journey',
    cluster: 'devnet',
    mainnetEnabled: false,
    faucetRequested: false,
    privateKeysPersistedByScript: false,
    sharedLedger: 'postgresql',
    wallets: {
      creator: creator.publicKey.toBase58(),
      holder: holder.publicKey.toBase58(),
      referrer: referrer.publicKey.toBase58(),
    },
    coin: {
      mint: mint.toBase58(),
      name,
      symbol,
      router: launch.feeRouter.toBase58(),
      mintRouterSignature: launch.mintRouterSignature,
      launchSignature: launch.signature,
    },
    promotion: {
      tier: burnPolicy.tier,
      burnedFundedTokens: burnPolicy.amountTokens,
      burnSignature: launch.launchBurnReceipt.signature,
    },
    communityAirdrop: {
      allocationPercent: registeredLaunch.communityAirdrop.allocationPercent,
      reservedTokens: registeredLaunch.communityAirdrop.reservedTokens,
    },
    trades: {
      buySignature: buy.signature,
      sellSignature: sell.signature,
      tokenBaseUnitsAfterBuy: rawAfterBuy.toString(),
      tokenBaseUnitsAfterSell: rawAfterSell.toString(),
      volume24hSol: activity.volume24hSol,
      tradeCount24h: activity.tradeCount24h,
    },
    fees: {
      collectionSignature: collection.signature,
      collectedLamports: String(collection.collectedLamports),
      evidenceStatus: verifiedCollection.status,
      holderAllocationSol: settlement.creatorDestinations.holderAirdrop,
      automaticRewards: settlement.automaticRewards,
    },
    referral: {
      claimId: claim.id,
      payoutSignature: payout.signature,
      amountSol: claim.amount,
      finalizedBalanceDeltaLamports: String(referralAfter - referralBefore),
      evidenceStatus: verifiedPayout.status,
    },
    dashboardEvidence: {
      status: evidence.status,
      verifiedCollections: evidence.verifiedCollections.length,
      verifiedPayouts: evidence.verifiedPayouts.length,
    },
  };
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: 'failed',
    stage,
    error: String(error.message || error),
    serverOutput,
  }, null, 2));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
}
