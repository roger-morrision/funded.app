import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { createCloseAccountInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import { buildTradeTransaction, fetchBondingCurveSnapshot } from '../pump-trading.js';

const mintArg = process.argv.find(arg => arg.startsWith('--mint='))?.slice(7);
const rounds = Number(process.argv.find(arg => arg.startsWith('--rounds='))?.slice(9) || '5');
const buySol = Number(process.argv.find(arg => arg.startsWith('--buy-sol='))?.slice(10) || '0.5');
assert(mintArg && Number.isInteger(rounds) && rounds >= 1 && rounds <= 10 && buySol > 0 && buySol <= 0.5, 'Bounded Devnet mint, rounds, and buy amount are required.');
assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet');
const mint = new PublicKey(mintArg);
const trader = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CLAIMANT_SECRET_KEY || ''));
const owner = new PublicKey(process.env.VITE_FUNDED_TRADE_FEE_OWNER);
const qaWallets = JSON.parse(readFileSync('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
const appRoles = JSON.parse(readFileSync('.secrets/devnet-app-roles-20260930/public.json', 'utf8'));
assert.equal(trader.publicKey.toBase58(), qaWallets.find(item => item.role === 'claimant' && item.cluster === 'devnet')?.address,
  'Trade signer differs from the rotated Devnet QA manifest.');
assert.equal(owner.toBase58(), appRoles.find(item => item.role === 'trading_fee_treasury' && item.cluster === 'devnet')?.address,
  'Trade fee destination differs from the Devnet app-role manifest.');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), await new Connection(clusterApiUrl('devnet')).getGenesisHash(), 'Configured RPC is not Devnet.');
const launches = await (await fetch('http://127.0.0.1:8788/api/launches')).json();
assert(launches.some(row => row.mint === mint.toBase58() && row.onchainVerified), 'Use an on-chain verified app launch.');
const mintInfo = await connection.getParsedAccountInfo(mint, 'finalized');
const tokenProgram = mintInfo.value?.owner;
assert(tokenProgram?.equals(TOKEN_PROGRAM_ID) || tokenProgram?.equals(TOKEN_2022_PROGRAM_ID));
const decimals = Number(mintInfo.value?.data?.parsed?.info?.decimals);
const ata = getAssociatedTokenAddressSync(mint, trader.publicKey, false, tokenProgram);
const tokens = async () => BigInt((await connection.getTokenAccountBalance(ata, 'finalized').catch(() => ({ value:{ amount:'0' } }))).value.amount);
const initialTokens = await tokens();
assert.equal(initialTokens, 0n, 'Volume wallet has an existing position; use a clean test role.');
const initialSol = await connection.getBalance(trader.publicKey, 'finalized');
assert(initialSol >= Math.ceil((buySol + 0.05) * 1e9), 'Volume wallet has insufficient Devnet SOL.');
const curveBefore = await fetchBondingCurveSnapshot({ connection, mint });
assert.equal(curveBefore.complete, false, 'Use the bonding-curve route before migration.');
console.log(JSON.stringify({ stage:'preflight', execute:process.argv.includes('--execute'), mint:mint.toBase58(), trader:trader.publicKey.toBase58(), feeOwner:owner.toBase58(), signerManifestVerified:true, rounds, buySol, maxGrossBuySol:rounds*buySol, startingSol:initialSol/1e9, curveProgress:curveBefore.progressPercent }));
if (!process.argv.includes('--execute')) process.exit(0);

async function send(instructions) {
  const latest = await connection.getLatestBlockhash('finalized');
  const transaction = new Transaction({ feePayer:trader.publicKey, recentBlockhash:latest.blockhash }).add(...instructions);
  transaction.sign(trader);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight:false });
  const confirmation = await connection.confirmTransaction({ signature, blockhash:latest.blockhash, lastValidBlockHeight:latest.lastValidBlockHeight }, 'finalized');
  assert.equal(confirmation.value.err, null, `Trade failed: ${signature}`);
  return signature;
}
async function ownerDelta(signature, expected) {
  const receipt = await connection.getTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
  assert.equal(receipt?.meta?.err, null);
  const index = receipt.transaction.message.accountKeys.findIndex(key => key.equals(owner));
  assert(index >= 0, 'App-owner fee recipient missing from trade.');
  const delta = receipt.meta.postBalances[index] - receipt.meta.preBalances[index];
  assert.equal(delta, expected, 'App-owner fee differs from reviewed trade quote.');
  return delta;
}

let totalFee = 0;
for (let round = 1; round <= rounds; round += 1) {
  const buy = await buildTradeTransaction({ connection, side:'buy', mint, user:trader.publicKey, amount:buySol, slippagePercent:3, feeOwner:owner });
  const buySignature = await send(buy.instructions);
  const buyOwnerDelta = await ownerDelta(buySignature, buy.feeLamports);
  const bought = await tokens();
  assert(bought > 0n, 'Buy produced no tokens.');
  const sell = await buildTradeTransaction({ connection, side:'sell', mint, user:trader.publicKey, amount:Number(bought)/10**decimals, slippagePercent:3, feeOwner:owner });
  const sellSignature = await send(sell.instructions);
  const sellOwnerDelta = await ownerDelta(sellSignature, sell.feeLamports);
  assert.equal(await tokens(), 0n, 'Round trip left tokens in the volume wallet.');
  totalFee += buyOwnerDelta + sellOwnerDelta;
  console.log(JSON.stringify({ round, buySignature, sellSignature, boughtBaseUnits:bought.toString(), appOwnerFeeLamports:buyOwnerDelta+sellOwnerDelta }));
}
const closeSignature = await send([createCloseAccountInstruction(ata, trader.publicKey, trader.publicKey, [], tokenProgram)]);
const finalSol = await connection.getBalance(trader.publicKey, 'finalized');
const curveAfter = await fetchBondingCurveSnapshot({ connection, mint });
console.log(JSON.stringify({ stage:'volume-complete', mint:mint.toBase58(), rounds, grossBuySol:rounds*buySol, appOwnerFeeLamports:totalFee, traderSolDeltaLamports:finalSol-initialSol, closeSignature, curveBefore:curveBefore.progressPercent, curveAfter:curveAfter.progressPercent }));
