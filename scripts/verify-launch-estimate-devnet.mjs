import assert from 'node:assert/strict';
import BN from 'bn.js';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import { normalizeLaunchInput } from '../launch-core.js';
import { getInitialBuyQuote } from '../launch-flow.js';
import { buildMintRouterInitializeInstruction, buildPumpLaunchPlan } from '../mint-router-launch.js';

const payerValue = String(process.argv[2] || '').trim();
assert(payerValue, 'Pass a funded Devnet payer public key. This check never signs or submits a transaction.');

const rpcUrl = String(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com').trim();
const programValue = String(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID || '').trim();
assert(programValue, 'FUNDED_FEE_ROUTER_PROGRAM_ID is required.');

const connection = new Connection(rpcUrl, 'confirmed');
const payer = new PublicKey(payerValue);
const programId = new PublicKey(programValue);
const balance = await connection.getBalance(payer, 'confirmed');
assert(balance > 0, 'The supplied Devnet payer has no SOL, so the launch cost cannot be simulated.');

const input = normalizeLaunchInput({ name: 'COIN 1 TEST', symbol: 'COIN1', supply: 1_000_000_000, decimals: 6 });
const initialBuy = await getInitialBuyQuote({ connection, input: { ...input, initialBuySol: 0.2 } });
const mint = Keypair.generate();
const mintRouter = buildMintRouterInitializeInstruction({ programId, mint: mint.publicKey, payer });
const launchInstructions = await PUMP_SDK.createV2AndBuyInstructions({
  global: await new OnlinePumpSdk(connection).fetchGlobal(),
  mint: mint.publicKey,
  name: input.name,
  symbol: input.symbol,
  uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`,
  creator: mintRouter.router.address,
  user: payer,
  amount: new BN(initialBuy.amountBaseUnits.toString()),
  solAmount: new BN(initialBuy.solAmountLamports.toString()),
  mayhemMode: false,
  cashback: false,
  holderReward: false,
});

let plan;
let estimates;
for (let attempt = 0; attempt < 2; attempt += 1) {
  if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 1100));
  const latest = await connection.getLatestBlockhash('finalized');
  plan = buildPumpLaunchPlan({
    payer,
    mint,
    blockhash: latest.blockhash,
    launchInstructions,
    mintRouterInstruction: mintRouter.instruction,
  });
  try {
    estimates = await Promise.all(plan.steps.map(async ({ transaction }) => {
      const fee = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
      assert(Number.isSafeInteger(fee.value), 'Network fee quote is unavailable.');
      const simulation = await connection.simulateTransaction(transaction, undefined, [payer]);
      if (simulation.value.err) throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
      const simulatedBalance = simulation.value.accounts?.[0]?.lamports;
      assert(Number.isSafeInteger(simulatedBalance), 'Simulation did not return the payer balance.');
      return { fee: fee.value, spend: balance - simulatedBalance };
    }));
    break;
  } catch (error) {
    if (!/BlockhashNotFound|blockhash not found/i.test(String(error?.message || error)) || attempt > 0) throw error;
  }
}

assert(plan && estimates, 'A fresh finalized blockhash could not be simulated.');
const simulatedSpendLamports = estimates.reduce((total, estimate) => total + estimate.spend, 0);
assert(Number.isSafeInteger(simulatedSpendLamports) && simulatedSpendLamports > 0, 'The simulated launch cost is invalid.');
const buyLamports = Number(initialBuy.solAmountLamports);
const allowanceLamports = Number(initialBuy.maxSolAmountLamports - initialBuy.solAmountLamports);
const networkAndAccountsLamports = simulatedSpendLamports - buyLamports;
const totalLamports = simulatedSpendLamports + allowanceLamports;

console.log(JSON.stringify({
  verification: 'read-only Devnet launch estimate',
  transactionCount: plan.steps.length,
  payerBalanceSol: balance / 1_000_000_000,
  networkAndAccountReserveSol: networkAndAccountsLamports / 1_000_000_000,
  developerBuySol: buyLamports / 1_000_000_000,
  purchaseAllowanceSol: allowanceLamports / 1_000_000_000,
  estimatedTokens: Number(initialBuy.amountTokens),
  totalSol: totalLamports / 1_000_000_000,
}, null, 2));
