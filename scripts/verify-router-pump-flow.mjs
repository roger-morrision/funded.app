import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import { OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import { buildTradeTransaction } from '../pump-trading.js';

const cluster = String(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER || 'devnet').trim();
assert.equal(cluster, 'devnet', 'verify:router-pump-flow is restricted to Devnet.');
const devnetRpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
const connection = new Connection(devnetRpcUrl, 'confirmed');
// This is deliberately generated per run. The verifier must never accept a
// production signer through stdin or persist a Devnet private key to disk.
const payer = Keypair.generate();

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

let airdropSignature;
try {
  airdropSignature = await requestAirdropOnce(payer.publicKey, 1_000_000_000);
  await connection.confirmTransaction(airdropSignature, 'confirmed');
} catch (error) {
  const message = String(error?.message || error);
  if (error?.status === 429 || /airdrop limit|faucet has run dry/i.test(message)) {
    console.error('Devnet faucet quota is exhausted. The temporary in-memory payer was not funded; no launch or trade transaction was submitted.');
    process.exitCode = 2;
  } else {
    throw error;
  }
}
if (!airdropSignature) {
  // Leave the process naturally so Node can close fetch handles on Windows.
  // The nonzero exit code marks this as an infrastructure blocker, not a pass.
} else {
const programId = new PublicKey(process.env.FUNDED_ROUTER_PROGRAM_ID || 'C92L1A3ZkS9Nnau5JLAMwMUYxPSYVUTdeosHyc6WMA8W');
const [router] = PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')], programId);
const tradeAmountSol = Number(process.env.TEST_TRADE_SOL || 0.05);
const tradeRounds = Math.max(1, Math.floor(Number(process.env.TEST_TRADE_ROUNDS || 2)));
assert(Number.isFinite(tradeAmountSol) && tradeAmountSol > 0 && tradeAmountSol <= 1, 'TEST_TRADE_SOL must be between 0 and 1.');
const routerBefore = await connection.getBalance(router, 'confirmed');
const mint = Keypair.generate();
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
let latest = await connection.getLatestBlockhash('confirmed');
launch.recentBlockhash = latest.blockhash;
launch.feePayer = payer.publicKey;
launch.partialSign(mint, payer);
const launchSignature = await connection.sendRawTransaction(launch.serialize(), { skipPreflight: false });
await connection.confirmTransaction({ signature: launchSignature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
const sdk = new OnlinePumpSdk(connection);
const curve = await sdk.fetchBondingCurve(mint.publicKey);
assert.equal(curve.creator.toBase58(), router.toBase58(), 'Pump curve creator is not the funded router PDA');

const buySignatures = [];
let expectedFeeLamports = 0;
for (let round = 0; round < tradeRounds; round += 1) {
  const trade = await buildTradeTransaction({ connection, side: 'buy', mint: mint.publicKey, user: payer.publicKey, amount: tradeAmountSol, slippagePercent: 2, feeOwner: process.env.VITE_FUNDED_TRADE_FEE_OWNER || router.toBase58() });
  expectedFeeLamports += trade.feeLamports;
  latest = await connection.getLatestBlockhash('confirmed');
  const buy = new Transaction({ recentBlockhash: latest.blockhash, feePayer: payer.publicKey }).add(...trade.instructions);
  buy.sign(payer);
  const buySignature = await connection.sendRawTransaction(buy.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature: buySignature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
  buySignatures.push(buySignature);
}
const routerAfter = await connection.getBalance(router, 'confirmed');
assert(routerAfter - routerBefore >= expectedFeeLamports, 'Router did not receive the configured test trade fees.');
console.log(JSON.stringify({ payer: payer.publicKey.toBase58(), programId: programId.toBase58(), router: router.toBase58(), mint: mint.publicKey.toBase58(), launchSignature, buySignatures, creator: curve.creator.toBase58(), tradeAmountSol, tradeRounds, totalTradeVolumeSol: tradeAmountSol * tradeRounds, expectedFeeLamports, routerBefore, routerAfter, routerFeeDeltaLamports: routerAfter - routerBefore }));
}
