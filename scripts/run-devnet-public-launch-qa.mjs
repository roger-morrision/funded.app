import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import BN from 'bn.js';
import { OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import { Connection, Keypair, PublicKey, VersionedTransaction, clusterApiUrl } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { buildLaunchBurnPolicy, createLaunchBurnTiers } from '../launch-burn-policy.js';
import { deriveFeeRouter, verifyFeeRouterAccount, verifyMintFeeRouterAccount } from '../fee-router.js';
import { launchPolicyStatement } from '../launch-policy-auth.js';
import { getInitialBuyQuote, prepareFundedLaunchBurn, submitPumpDevnetLaunch } from '../launch-flow.js';
import { buildMintRouterInitializeInstruction, buildPumpLaunchPlan } from '../mint-router-launch.js';
import { devnetMetadataUri, metadataStatement } from '../devnet-metadata.js';
import { quoteAtomicReserveBuy, launchReserveInstructions } from '../launch-community-reserve.js';

const execute = process.argv.includes('--execute');
const boost = process.argv.includes('--boost');
const recoveryMint = process.argv.find(arg => arg.startsWith('--recover-mint='))?.split('=')[1] || null;
const recoverySignature = process.argv.find(arg => arg.startsWith('--launch-signature='))?.split('=')[1] || null;
if (recoveryMint || recoverySignature) assert(recoveryMint && recoverySignature, 'Recovery requires both mint and launch signature.');
assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet', 'Devnet configuration required.');
assert.notEqual(process.env.VITE_ALLOW_MAINNET, 'true', 'Mainnet must remain disabled.');
const creator = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY || ''));
const referrer = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_REFERRER_SECRET_KEY || ''));
const claimant = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CLAIMANT_SECRET_KEY || ''));
const qaWallets = JSON.parse(readFileSync('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
for (const [role, wallet] of [['creator', creator], ['referrer', referrer], ['claimant', claimant]]) {
  const expected = qaWallets.find(item => item.role === role && item.cluster === 'devnet')?.address;
  assert.equal(wallet.publicKey.toBase58(), expected, `${role} signer differs from the rotated Devnet QA manifest.`);
}
const creatorShare = Number(process.argv.find(arg => arg.startsWith('--creator-share='))?.split('=')[1] || '70');
const holderShare = Number(process.argv.find(arg => arg.startsWith('--holder-share='))?.split('=')[1] || '10');
const initialBuySol = Number(process.argv.find(arg => arg.startsWith('--initial-buy-sol='))?.split('=')[1] || '0');
assert(Number.isFinite(initialBuySol) && initialBuySol >= 0 && initialBuySol <= 0.05, 'Initial Devnet buy must be between 0 and 0.05 SOL.');
const imagePath = process.argv.find(arg => arg.startsWith('--image='))?.split('=')[1] || null;
const image = imagePath ? readFileSync(imagePath) : null;
const suffix = Date.now().toString(36).slice(-6);
const name = `Funded Clean QA ${suffix}`;
const symbol = 'FCQA';
if (image) {
  assert(image.length > 0 && image.length <= 600_000, 'QA token image must be under 600 KB.');
  assert(image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'QA token image must be PNG.');
}
assert(Number.isInteger(creatorShare) && Number.isInteger(holderShare) && creatorShare >= 0 && holderShare >= 0 && creatorShare + holderShare === 80,
  'Creator and holder shares must be nonnegative integers totaling 80%.');
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID);
const rpcUrl = process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
const connection = new Connection(rpcUrl, 'finalized');
const official = new Connection(clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), await official.getGenesisHash(), 'Configured RPC is not Solana Devnet.');
const router = await verifyFeeRouterAccount({ connection, programId });
assert.equal(router.verified, true, `Shared fee router is not verified: ${router.reason}`);
assert.equal(router.address.toBase58(), deriveFeeRouter(programId).address.toBase58());
const base = 'http://127.0.0.1:8788';
const healthResponse = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000) });
assert.equal(healthResponse.status, 200, 'Public Devnet app origin is unavailable.');
const health = await healthResponse.json();
assert.equal(health.ok, true);
const launchesBefore = await (await fetch(`${base}/api/launches`)).json();
assert(Array.isArray(launchesBefore), 'The launch registry response must be an array.');
const creatorBalance = await connection.getBalance(creator.publicKey, 'finalized');
assert(creatorBalance > 50_000_000, 'Creator needs at least 0.05 Devnet SOL for launch.');
const fundedMint = boost ? new PublicKey(process.env.VITE_FUNDED_TOKEN_MINT) : null;
const burnTiers = createLaunchBurnTiers({
  boostAmount:Number(process.env.VITE_FUNDED_BOOST_BURN_AMOUNT || 25_000),
  proAmount:Number(process.env.VITE_FUNDED_PRO_BURN_AMOUNT || 100_000),
  premierAmount:Number(process.env.VITE_FUNDED_PREMIER_BURN_AMOUNT || 250_000),
});
const burnPolicy = boost ? buildLaunchBurnPolicy({ tierId:'boost', fundedMint:fundedMint.toBase58(), tiers:burnTiers }) : null;
if (boost && !recoveryMint) {
  assert.equal(health.launchPolicy?.cluster, 'devnet', 'Public API launch policy is unavailable or is not Devnet; no launch signed.');
  assert.equal(health.launchPolicy?.feeRouterProgramId, programId.toBase58(), 'Public API fee router program differs from the QA profile; no launch signed.');
  assert.equal(health.launchPolicy?.fundedMint, fundedMint.toBase58(), 'Public API $FUNDED mint differs from the QA profile; no launch signed.');
  assert.equal(health.launchPolicy?.burnAmounts?.boost, burnPolicy.amountTokens, 'Public API Boost burn policy differs from the QA profile; no launch signed.');
}
const fundedAccount = boost ? getAssociatedTokenAddressSync(fundedMint, creator.publicKey) : null;
const fundedBefore = boost ? await getMint(connection, fundedMint, 'finalized', TOKEN_PROGRAM_ID) : null;
const fundedWalletBefore = boost ? await getAccount(connection, fundedAccount, 'finalized', TOKEN_PROGRAM_ID) : null;
const burnUnits = boost ? BigInt(burnPolicy.amountTokens) * 10n ** BigInt(fundedBefore.decimals) : 0n;
if (boost && !recoveryMint) assert(fundedWalletBefore.amount >= burnUnits, 'Creator lacks the $FUNDED required for Boost.');
const buyQuote = await getInitialBuyQuote({ connection, input:{ name:'Funded QA', symbol:'FQA', supply:1_000_000_000, decimals:6, initialBuySol } });
const reserveConfigResponse = await fetch(`${base}/api/launch-reserve-config`, { signal:AbortSignal.timeout(10_000) });
assert.equal(reserveConfigResponse.status, 200, 'Atomic community reserve configuration is unavailable.');
const reserveConfig = await reserveConfigResponse.json();
assert.equal(reserveConfig.authority, process.env.FUNDED_REWARD_AUTHORITY);
assert.equal(reserveConfig.programId, programId.toBase58());
const reserveTable = (await connection.getAddressLookupTable(new PublicKey(reserveConfig.lookupTable), { commitment:'finalized' })).value;
assert(reserveTable?.isActive(), 'Atomic reserve lookup table is unavailable.');
const atomicQuote = await quoteAtomicReserveBuy({ connection, supply:1_000_000_000, decimals:6, reserveTokens:30_000_000,
  developerBaseUnits:buyQuote.amountBaseUnits });
let launchPlanBytes = null;
if (!recoveryMint) {
  const trialMint = Keypair.generate();
  const mintRouter = buildMintRouterInitializeInstruction({ programId, mint:trialMint.publicKey, payer:creator.publicKey });
  const uri = devnetMetadataUri(trialMint.publicKey.toBase58());
  const common = { mint:trialMint.publicKey, name, symbol, uri, creator:mintRouter.router.address, user:creator.publicKey, mayhemMode:false, holderReward:false };
  const launchInstructions = await PUMP_SDK.createV2AndBuyInstructions({ ...common, global:atomicQuote.global,
    amount:new BN(atomicQuote.amountBaseUnits.toString()), solAmount:new BN(atomicQuote.solAmountLamports.toString()), cashback:false });
  const reserve = launchReserveInstructions({ mint:trialMint.publicKey, payer:creator.publicKey, programId,
    authority:reserveConfig.authority, reserveTokens:30_000_000, decimals:6 });
  const burnInstruction = boost ? (await prepareFundedLaunchBurn({ connection, payer:creator.publicKey, fundedMint:fundedMint.toBase58(), amountTokens:burnPolicy.amountTokens })).instruction : null;
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  try {
    const plan = buildPumpLaunchPlan({ payer:creator.publicKey, mint:trialMint, blockhash, launchInstructions,
      burnInstruction, mintRouterInstruction:mintRouter.instruction, reserveInstructions:reserve.instructions, lookupTable:reserveTable });
    launchPlanBytes = plan.steps.map(step => step.bytes);
  } catch (error) {
    if (!/size limit/.test(String(error.message))) throw error;
    console.log(JSON.stringify({ stage:'preflight-blocked', tier:boost?'boost':'standard', initialBuySol, reason:'Solana transaction size limit', signed:false, metadataPublished:false }));
    process.exit(2);
  }
}
console.log(JSON.stringify({ stage:'preflight', execute, tier:boost?'boost':'standard', creator:creator.publicKey.toBase58(), referrer:referrer.publicKey.toBase58(), claimant:claimant.publicKey.toBase58(), creatorBalanceSol:creatorBalance / 1e9, fundedBalanceTokens:boost?Number(fundedWalletBefore.amount)/10**fundedBefore.decimals:null, router:router.address.toBase58(), launchesBefore:launchesBefore.length, creatorShare, holderShare, initialBuySol, reserveTokens:30_000_000, totalBuyMaxSol:Number(atomicQuote.maxSolAmountLamports) / 1e9, launchPlanBytes, imageBytes:image?.length || 0, signerManifestVerified:true }));
if (!execute) process.exit(0);

const token = readFileSync('.secrets/funded-api-token', 'utf8').trim();
assert(token.length > 10, 'Local API token is missing.');
const journalPath = join('audit-records', `devnet-clean-launch-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
mkdirSync('audit-records', { recursive:true });
function journal(event) { appendFileSync(journalPath, `${JSON.stringify({ at:new Date().toISOString(), ...event })}\n`); console.log(JSON.stringify(event)); }
async function post(path, input, authorized = false) {
  const response = await fetch(`${base}${path}`, { method:'POST', headers:{ 'content-type':'application/json', origin:'https://funded.vip', ...(authorized ? { authorization:`Bearer ${token}` } : {}) }, body:JSON.stringify(input), signal:AbortSignal.timeout(45_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${data.error || ''}`);
  return data;
}
function sign(statement, signer) { return bs58.encode(nacl.sign.detached(new TextEncoder().encode(statement), signer.secretKey)); }

let stage = 'register-referrer';
try {
  if (!recoveryMint) {
    const registration = await post('/api/referrals/registration/prepare', { wallet:referrer.publicKey.toBase58() });
    const registered = await post('/api/referrals/registration/verify', { challengeId:registration.challengeId, wallet:referrer.publicKey.toBase58(), signature:sign(registration.statement, referrer) });
    const attribution = await post('/api/referrals/attribution/prepare', { wallet:creator.publicKey.toBase58(), code:registered.code });
    const attributed = await post('/api/referrals/attribution/verify', { challengeId:attribution.challengeId, wallet:creator.publicKey.toBase58(), signature:sign(attribution.statement, creator) });
    assert.equal(attributed.inviterWallet, referrer.publicKey.toBase58());
    journal({ stage:'referrer-registered', wallet:referrer.publicKey.toBase58(), creator:creator.publicKey.toBase58() });
  }

  stage = 'launch';
  const launch = recoveryMint ? await (async () => {
    const mint = new PublicKey(recoveryMint);
    const status = await connection.getSignatureStatus(recoverySignature, { searchTransactionHistory:true });
    assert.equal(status.value?.confirmationStatus, 'finalized', 'Recovery launch is not finalized.');
    assert.equal(status.value?.err, null, 'Recovery launch transaction failed.');
    const checked = await verifyMintFeeRouterAccount({ connection, programId, mint, expectedAuthority:router.authority });
    assert.equal(checked.verified, true, `Recovery mint router is not verified: ${checked.reason}`);
    const curve = await new OnlinePumpSdk(connection).fetchBondingCurve(mint);
    assert(curve?.creator?.equals(checked.address), 'Recovery coin has a different creator-fee router.');
    const metadata = await fetch(devnetMetadataUri(mint.toBase58()), { signal:AbortSignal.timeout(15_000) });
    assert.equal(metadata.status, 200, 'Recovery metadata is unavailable.');
    assert.equal((await metadata.json()).description, 'Fresh Devnet end-to-end QA coin. No monetary value.', 'Recovery metadata does not match this retest coin.');
    journal({ stage:'recovered-finalized-launch', mint:mint.toBase58(), signature:recoverySignature, router:checked.address.toBase58() });
    return { mint, signature:recoverySignature, mintRouterSignature:null, feeRouter:checked.address };
  })() : await submitPumpDevnetLaunch({
    connection,
    provider:{ signTransaction:async transaction => { if (transaction instanceof VersionedTransaction) transaction.sign([creator]); else transaction.partialSign(creator); return transaction; } },
    payer:creator.publicKey,
    input:{ name, symbol, supply:1_000_000_000, decimals:6, initialBuyPercent:0, initialBuySol,
      reserveTokens:30_000_000, maxInitialBuyLamports:atomicQuote.maxSolAmountLamports },
    feeRouterAddress:router.address.toBase58(),
    feeRouterProgramId:programId,
    useMintRouter:true,
    launchBurn:burnPolicy,
    reserveConfig,
    prepareMetadata:async ({ mint }) => {
      const record = { mint, creatorWallet:creator.publicKey.toBase58(), name, symbol,
        description:'Fresh Devnet end-to-end QA coin. No monetary value.', tagline:'Clean Devnet retest', roadmap:'', website:'', x:'', telegram:'', discord:'', imageSha256:image ? createHash('sha256').update(image).digest('hex') : '' };
      const saved = await post('/api/devnet-metadata', { ...record, imageBase64:image?.toString('base64') || '', imageType:image ? 'image/png' : '', signature:sign(metadataStatement(record), creator) });
      assert.equal(saved.uri, devnetMetadataUri(mint));
      const published = await fetch(saved.uri, { signal:AbortSignal.timeout(15_000) });
      assert.equal(published.status, 200, 'Published metadata is not reachable through the public metadata origin.');
      const publishedRecord = await published.json();
      assert.equal(publishedRecord.description, record.description);
      if (image) {
        const publishedImage = await fetch(publishedRecord.image, { signal:AbortSignal.timeout(15_000) });
        assert.equal(publishedImage.status, 200, 'Published QA token image is unavailable.');
        assert.deepEqual(Buffer.from(await publishedImage.arrayBuffer()), image, 'Published QA token image differs from upload.');
      }
      journal({ stage:'metadata-published', mint, uri:saved.uri });
      return saved.uri;
    },
    onJournal:event => journal({ stage:'launch-transaction', ...event }),
    onStatus:message => journal({ stage:'launch-status', message }),
  });
  const mint = (launch.mint.publicKey || launch.mint).toBase58();
  assert(!launchesBefore.some(item => item.mint === mint) || Boolean(recoveryMint), 'Fresh mint already exists in the public registry.');
  journal({ stage:'launch-confirmed', mint, signature:launch.signature, mintRouterSignature:launch.mintRouterSignature || null, router:launch.feeRouter.toBase58() });
  if (!recoveryMint) {
    const mintedCoin = new PublicKey(mint);
    const mintAccount = await connection.getAccountInfo(mintedCoin, 'finalized');
    assert(mintAccount, 'Initial-buy coin mint is missing.');
    const buyerAccount = getAssociatedTokenAddressSync(mintedCoin, creator.publicKey, false, mintAccount.owner);
    const buyerBalance = (await getAccount(connection, buyerAccount, 'finalized', mintAccount.owner)).amount;
    assert.equal(buyerBalance, launch.initialBuy.developerBaseUnits, 'Creator token balance does not match the optional developer buy after reserve funding.');
    journal({ stage:'initial-buy-verified', mint, signature:launch.signature, buyerAccount:buyerAccount.toBase58(), boughtBaseUnits:buyerBalance.toString() });
  }
  if (boost && !recoveryMint) {
    const [mintAfter, walletAfter] = await Promise.all([
      getMint(connection, fundedMint, 'finalized', TOKEN_PROGRAM_ID),
      getAccount(connection, fundedAccount, 'finalized', TOKEN_PROGRAM_ID),
    ]);
    assert.equal(fundedBefore.supply - mintAfter.supply, burnUnits, 'Boost did not reduce $FUNDED supply by the configured amount.');
    assert.equal(fundedWalletBefore.amount - walletAfter.amount, burnUnits, 'Boost did not debit the creator $FUNDED account by the configured amount.');
    assert.equal(launch.launchBurnReceipt?.signature, launch.signature, 'Boost burn was not atomic with launch.');
    journal({ stage:'boost-burn-verified', mint, signature:launch.signature, amountTokens:burnPolicy.amountTokens, supplyBefore:fundedBefore.supply.toString(), supplyAfter:mintAfter.supply.toString(), creatorBalanceAfter:walletAfter.amount.toString() });
  }

  stage = 'register-launch';
  if (recoveryMint && launchesBefore.some(item => item.mint === mint)) {
    assert.equal(launchesBefore.find(item => item.mint === mint).onchainVerified, true, 'Existing recovery launch lacks on-chain verification.');
    journal({ stage:'already-registered', mint, launchSignature:launch.signature, journalPath });
    process.exit(0);
  }
  const feeDistribution = buildFeeDistributionPolicy({ creatorWalletPercent:creatorShare, holderAirdropPercent:holderShare, solClaimPercent:0, feeRouterAddress:launch.feeRouter.toBase58() });
  const record = { mint, chain:'solana', cluster:'devnet', signature:launch.signature, creatorWallet:creator.publicKey.toBase58(), communityAllocation:3,
    feeDistribution, pumpFeeRoute:{ router:launch.feeRouter.toBase58(), scope:'per-mint-v2', transaction:launch.signature },
    ...(boost ? { creatorLaunchBurn:burnPolicy } : {}) };
  record.policySignature = sign(launchPolicyStatement(record), creator);
  const saved = await post('/api/launches', record);
  assert.equal(saved.onchainVerified, true, 'Launch registration lacks on-chain verification.');
  assert.equal(saved.communityReserve?.verified, true, 'Launch registration lacks the exact funded community vault receipt.');
  assert.equal(saved.communityReserve?.fundedTokens, '30000000', 'Community vault did not receive exactly 30 million tokens.');
  if (boost) {
    assert.equal(saved.creatorLaunchBurn?.status, 'verified', 'Boost promotion was not verified during registration.');
    assert.equal(saved.creatorLaunchBurn.receipt?.signature, launch.signature, 'Registered Boost burn receipt differs from launch.');
  }
  assert.equal(saved.automaticRewards?.status, 'registered', 'Holder reward registration failed.');
  const launchesAfter = await (await fetch(`${base}/api/launches`)).json();
  assert.equal(launchesAfter.length, launchesBefore.length + 1, 'Public registry did not add exactly one new launch.');
  assert.equal(launchesAfter.filter(item => item.mint === mint).length, 1, 'Public registry must contain the new mint exactly once.');
  journal({ stage:'registered', mint, launchSignature:launch.signature, automaticRewards:saved.automaticRewards.status, launchesAfter:launchesAfter.length, journalPath });
} catch (error) {
  journal({ stage:'failed', atStage:stage, error:String(error.message || error) });
  process.exitCode = 1;
}
