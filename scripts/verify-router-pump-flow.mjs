import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import { OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { buildTradeTransaction } from '../pump-trading.js';
import { buildMintRouterInitializeInstruction } from '../mint-router-launch.js';
import { deriveFeeRouter, verifyMintFeeRouterAccount } from '../fee-router.js';
import { createAutomaticRewardChain } from '../server/automatic-reward-chain.mjs';

const cluster = String(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER || 'devnet').trim();
assert.equal(cluster, 'devnet', 'verify:router-pump-flow is restricted to Devnet.');
const devnetRpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
const connection = new Connection(devnetRpcUrl, 'confirmed');
const configuredSecret = process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY;
const payer = configuredSecret ? Keypair.fromSecretKey(bs58.decode(configuredSecret)) : Keypair.generate();
const [rpcGenesis, devnetGenesis] = await Promise.all([
  connection.getGenesisHash(),
  new Connection(clusterApiUrl('devnet'), 'confirmed').getGenesisHash(),
]);
assert.equal(rpcGenesis, devnetGenesis, 'The configured RPC endpoint is not Solana Devnet.');

async function requestAirdropOnce(publicKey, lamports) {
  const response = await fetch(devnetRpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'requestAirdrop', params: [publicKey.toBase58(), lamports] }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || `Devnet faucet request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload.result;
}

let payerReady = Boolean(configuredSecret);
if (configuredSecret) {
  assert(await connection.getBalance(payer.publicKey, 'confirmed') >= 30_000_000, 'Configured Devnet test wallet needs at least 0.03 SOL for this live verifier.');
} else {
  try {
    const airdropSignature = await requestAirdropOnce(payer.publicKey, 1_000_000_000);
    await connection.confirmTransaction(airdropSignature, 'confirmed');
    payerReady = true;
  } catch (error) {
    const message = String(error?.message || error);
    if (error?.status === 429 || /airdrop limit|faucet has run dry|internal error|service unavailable/i.test(message)) {
      console.error('Devnet faucet is unavailable. The temporary in-memory payer was not funded; no launch or trade transaction was submitted. Configure SOLANA_DEVNET_CREATOR_SECRET_KEY for a funded Devnet test wallet.');
      process.exitCode = 2;
    } else {
      throw error;
    }
  }
}
if (!payerReady) {
  // Leave the process naturally so Node can close fetch handles on Windows.
  // The nonzero exit code marks this as an infrastructure blocker, not a pass.
} else {
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID || '2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik');
const sharedRouter = deriveFeeRouter(programId).address;
const tradeFeeOwner = new PublicKey(process.env.VITE_FUNDED_TRADE_FEE_OWNER || sharedRouter.toBase58());
assert(!tradeFeeOwner.equals(payer.publicKey), 'Trade fee owner must differ from the test payer to verify its balance delta.');
const tradeAmountSol = Number(process.env.TEST_TRADE_SOL || 0.01);
const tradeRounds = Math.max(1, Math.floor(Number(process.env.TEST_TRADE_ROUNDS || 1)));
assert(Number.isFinite(tradeAmountSol) && tradeAmountSol > 0 && tradeAmountSol <= 1, 'TEST_TRADE_SOL must be between 0 and 1.');
const mint = Keypair.generate();
const mintRouter = buildMintRouterInitializeInstruction({ programId, mint:mint.publicKey, payer:payer.publicKey });
let latest = await connection.getLatestBlockhash('confirmed');
const initializeRouter = new Transaction({ recentBlockhash:latest.blockhash, feePayer:payer.publicKey }).add(mintRouter.instruction);
initializeRouter.sign(payer, mint);
const mintRouterSignature = await connection.sendRawTransaction(initializeRouter.serialize(), { skipPreflight:false });
await connection.confirmTransaction({ signature:mintRouterSignature, blockhash:latest.blockhash, lastValidBlockHeight:latest.lastValidBlockHeight }, 'finalized');
const checkedRouter = await verifyMintFeeRouterAccount({ connection, programId, mint:mint.publicKey, expectedAuthority:payer.publicKey });
assert(checkedRouter.verified, `Mint router verification failed: ${checkedRouter.reason}`);
const router = checkedRouter.address;
const routerBefore = await connection.getBalance(router, 'finalized');
const tradeFeeOwnerBefore = tradeFeeOwner.equals(router) ? routerBefore : await connection.getBalance(tradeFeeOwner, 'finalized');
const name = `Funded Routed ${Date.now().toString(36).slice(-7)}`;
const instruction = await PUMP_SDK.createV2Instruction({
  mint: mint.publicKey,
  name,
  symbol: 'FDRT',
    uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`,
  creator: router,
  user: payer.publicKey,
  mayhemMode: false,
  holderReward: false,
});
const launch = new Transaction().add(instruction);
latest = await connection.getLatestBlockhash('confirmed');
launch.recentBlockhash = latest.blockhash;
launch.feePayer = payer.publicKey;
launch.partialSign(mint, payer);
const launchSignature = await connection.sendRawTransaction(launch.serialize(), { skipPreflight: false });
await connection.confirmTransaction({ signature: launchSignature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
const sdk = new OnlinePumpSdk(connection);
const curve = await sdk.fetchBondingCurve(mint.publicKey);
assert.equal(curve.creator.toBase58(), router.toBase58(), 'Pump curve creator is not the funded mint router PDA');

const buySignatures = [];
let expectedFeeLamports = 0;
for (let round = 0; round < tradeRounds; round += 1) {
  const trade = await buildTradeTransaction({ connection, side: 'buy', mint: mint.publicKey, user: payer.publicKey, amount: tradeAmountSol, slippagePercent: 2, feeOwner: tradeFeeOwner });
  expectedFeeLamports += trade.feeLamports;
  latest = await connection.getLatestBlockhash('confirmed');
  const buy = new Transaction({ recentBlockhash: latest.blockhash, feePayer: payer.publicKey }).add(...trade.instructions);
  buy.sign(payer);
  const buySignature = await connection.sendRawTransaction(buy.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature: buySignature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'finalized');
  buySignatures.push(buySignature);
}
const tradeFeeOwnerAfter = tradeFeeOwner.equals(router) ? await connection.getBalance(router, 'finalized') : await connection.getBalance(tradeFeeOwner, 'finalized');
assert(tradeFeeOwnerAfter - tradeFeeOwnerBefore >= expectedFeeLamports, 'The configured app trade-fee owner did not receive the test trade fees.');
const collectionInstructions = await sdk.collectCoinCreatorFeeV2Instructions(router, NATIVE_MINT, TOKEN_PROGRAM_ID, payer.publicKey);
assert(collectionInstructions.length > 0, 'Pump returned no mint-specific creator-fee collection instruction after verified buys.');
latest = await connection.getLatestBlockhash('confirmed');
const collection = new Transaction({ recentBlockhash:latest.blockhash, feePayer:payer.publicKey }).add(...collectionInstructions);
collection.sign(payer);
const collectionSignature = await connection.sendRawTransaction(collection.serialize(), { skipPreflight:false });
await connection.confirmTransaction({ signature:collectionSignature, blockhash:latest.blockhash, lastValidBlockHeight:latest.lastValidBlockHeight }, 'finalized');
const routerAfterCollection = await connection.getBalance(router, 'finalized');
const collectedLamports = routerAfterCollection - routerBefore;
assert(collectedLamports > 0, 'Mint-specific Pump creator-fee collection produced no finalized router balance delta.');
const chain = createAutomaticRewardChain({ connection, programId, authority:payer, expectedProgramDataSha256:process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256 });
const readiness = await chain.readiness();
assert(readiness.constrainedPayouts, `Reward chain unavailable: ${readiness.reasons.join(', ')}`);
const routerRent = await connection.getMinimumBalanceForRentExemption(106, 'finalized');
const spendableCollectedLamports = routerAfterCollection - routerRent;
assert(spendableCollectedLamports > 0, 'Mint-specific router has no creator fees above its rent reserve.');
const rewardFundingAmount = String(Math.min(spendableCollectedLamports, 1_000_000));
const rewardFunding = await chain.fundSolVaultFromMintRouter({ mint:mint.publicKey.toBase58(), amount:rewardFundingAmount, fundingId:`pump-flow:${launchSignature}` });
assert(rewardFunding.balanceDeltaVerified, 'Collected creator fees did not produce an exact finalized reward-vault delta.');
const routerAfterFunding = await connection.getBalance(router, 'finalized');
console.log(JSON.stringify({ payer:payer.publicKey.toBase58(), payerSource:configuredSecret?'configured-devnet-test-wallet':'ephemeral-faucet-wallet', programId:programId.toBase58(), sharedRouter:sharedRouter.toBase58(), router:router.toBase58(), mintRouterSignature, tradeFeeOwner:tradeFeeOwner.toBase58(), mint:mint.publicKey.toBase58(), launchSignature, buySignatures, collectionSignature, rewardFundingSignature:rewardFunding.signature, rewardFundingClaim:rewardFunding.claim, rewardVault:rewardFunding.vault, rewardFundingAmount, creator:curve.creator.toBase58(), tradeAmountSol, tradeRounds, totalTradeVolumeSol:tradeAmountSol*tradeRounds, expectedFeeLamports, routerBefore, routerAfterCollection, routerAfterFunding, routerRent, collectedLamports, spendableCollectedLamports, appTradeFeeDeltaLamports:tradeFeeOwnerAfter-tradeFeeOwnerBefore, finalizedRewardVaultDelta:rewardFunding.balanceDeltaVerified }));
}
