import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { creatorVaultPda } from '@pump-fun/pump-sdk';
import { buildTradeTransaction, fetchBondingCurveSnapshot } from '../pump-trading.js';

const allowedMints = new Set([
  'EtMFvbnLJMmp4PWqDVSqYzWfkWhZy3FznJQTN35rYWPc',
  '2F6VAkmF6sXEwmY9No15EkthW7bwd2eocxM4yd8pWaRw',
]);
const mintAddress = process.argv.find(value => value.startsWith('--mint='))?.slice(7)
  || 'EtMFvbnLJMmp4PWqDVSqYzWfkWhZy3FznJQTN35rYWPc';
assert(allowedMints.has(mintAddress), 'Only reviewed V3 Devnet QA mints are allowed.');
const mint = new PublicKey(mintAddress);
const feeOwner = new PublicKey('CmhmRtKYExJC76R5nsPV9ovPYacoEQFEL7VhaKRZmLy2');
const rounds = Number(process.argv.find(value => value.startsWith('--rounds='))?.slice(9) || '1');
const buySol = Number(process.argv.find(value => value.startsWith('--buy-sol='))?.slice(10) || '0.5');
const holdSol = Number(process.argv.find(value => value.startsWith('--hold-sol='))?.slice(11) || '0');
const execute = process.argv.includes('--execute');
assert(Number.isInteger(rounds) && rounds >= 0 && rounds <= 10 && (rounds > 0 || holdSol > 0),
  'Use 1-10 QA rounds or a single final holder buy.');
assert(Number.isFinite(buySol) && buySol > 0 && buySol <= 0.5, 'Use at most 0.5 Devnet SOL per buy.');
assert(Number.isFinite(holdSol) && holdSol >= 0 && holdSol <= 0.2, 'Use at most 0.2 SOL for a final holder position.');
if (mintAddress === '2F6VAkmF6sXEwmY9No15EkthW7bwd2eocxM4yd8pWaRw')
  assert(buySol <= 0.3, 'The fresh QA curve permits at most 0.3 SOL per round-trip buy.');
const trader = Keypair.fromSecretKey(bs58.decode(readFileSync('.secrets/funded-router-authority-secret-key', 'utf8').trim()));
assert.equal(trader.publicKey.toBase58(), '7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const connection = new Connection(readFileSync('.secrets/solana-devnet-rpc-url', 'utf8').trim(), 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const launchResponse = await fetch('https://funded.vip/api/launches', { signal:AbortSignal.timeout(20_000) });
assert(launchResponse.ok, 'The public Devnet launch registry is unavailable.');
const launch = (await launchResponse.json()).find(row => row.mint === mint.toBase58());
assert(launch?.onchainVerified && launch.cluster === 'devnet' && launch.pumpFeeRoute?.scope === 'per-mint-v3');
assert.equal(launch.creatorWallet, '8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk');
const creatorVault = creatorVaultPda(new PublicKey(launch.pumpFeeRoute.router));
const tokenBalance = async () => (await connection.getParsedTokenAccountsByOwner(trader.publicKey, { mint }, 'finalized')).value
  .reduce((sum, row) => sum + BigInt(row.account.data.parsed.info.tokenAmount.amount), 0n);
const initialSol = await connection.getBalance(trader.publicKey, 'finalized');
const initialTokens = await tokenBalance();
const curve = await fetchBondingCurveSnapshot({ connection, mint });
assert(!curve.complete && curve.progressPercent < 90, 'The QA mint is no longer on its safe test curve.');
assert(initialSol >= Math.ceil((buySol + holdSol + 0.1) * 1e9), 'QA wallet cannot fund the bounded trade.');
console.log(JSON.stringify({ stage:'preflight', cluster:'devnet', mint:mint.toBase58(), trader:trader.publicKey.toBase58(),
  rounds, buySol, holdSol, initialSolLamports:initialSol, initialTokenBaseUnits:String(initialTokens), progressPercent:curve.progressPercent,
  execute }));
if (!execute) process.exit(0);

async function send(instructions) {
  const latest = await connection.getLatestBlockhash('finalized');
  const tx = new Transaction({ feePayer:trader.publicKey, recentBlockhash:latest.blockhash }).add(...instructions);
  tx.sign(trader);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight:false });
  const confirmed = await connection.confirmTransaction({ signature, ...latest }, 'finalized');
  assert.equal(confirmed.value.err, null, `QA trade failed: ${signature}`);
  return signature;
}
async function feeDeltas(signature, quotedAppFee) {
  const receipt = await connection.getTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
  assert.equal(receipt?.meta?.err, null, 'Finalized trade receipt is unavailable.');
  const keys = receipt.transaction.message.accountKeys;
  const delta = address => {
    const index = keys.findIndex(key => key.equals(address));
    assert(index >= 0, `Trade receipt omits ${address.toBase58()}.`);
    return receipt.meta.postBalances[index] - receipt.meta.preBalances[index];
  };
  assert.equal(delta(feeOwner), Number(quotedAppFee), 'App trading fee differs from the quote.');
  const creatorFee = delta(creatorVault);
  assert(creatorFee > 0, 'Pump did not accrue a positive mint-specific creator fee.');
  return creatorFee;
}

for (let round = 1; round <= rounds; round += 1) {
  const beforeTokens = await tokenBalance();
  const beforeSol = await connection.getBalance(trader.publicKey, 'finalized');
  const currentCurve = await fetchBondingCurveSnapshot({ connection, mint });
  assert(!currentCurve.complete && currentCurve.progressPercent < 90, 'QA curve progressed beyond the safe bound.');
  const buy = await buildTradeTransaction({ connection, side:'buy', mint, user:trader.publicKey,
    amount:buySol, slippagePercent:3, feeOwner });
  assert.equal(buy.route, 'curve');
  assert(Number(buy.outputAmount) / 1e6 < currentCurve.realTokenReserves * 0.75,
    'QA buy quote would approach migration; stop before sending.');
  const buySignature = await send(buy.instructions);
  const buyCreatorFee = await feeDeltas(buySignature, buy.feeLamports);
  const afterBuyTokens = await tokenBalance();
  const bought = afterBuyTokens - beforeTokens;
  assert(bought > 0n, 'Finalized buy did not increase token balance.');
  const sell = await buildTradeTransaction({ connection, side:'sell', mint, user:trader.publicKey,
    amount:Number(bought) / 1e6, slippagePercent:3, feeOwner });
  assert.equal(sell.route, 'curve');
  const sellSignature = await send(sell.instructions);
  const sellCreatorFee = await feeDeltas(sellSignature, sell.feeLamports);
  assert.equal(await tokenBalance(), beforeTokens, 'Round trip did not restore the initial token position.');
  const afterSol = await connection.getBalance(trader.publicKey, 'finalized');
  assert(beforeSol - afterSol < 40_000_000, 'A QA round exceeded the 0.04 SOL loss bound.');
  console.log(JSON.stringify({ stage:'round-finalized', round, buySignature, sellSignature,
    boughtBaseUnits:String(bought), quotedAppFeesLamports:String(BigInt(buy.feeLamports) + BigInt(sell.feeLamports)),
    creatorFeeLamports:buyCreatorFee + sellCreatorFee,
    traderSolDeltaLamports:afterSol-beforeSol }));
}
if (holdSol > 0) {
  const before = await tokenBalance();
  const currentCurve = await fetchBondingCurveSnapshot({ connection, mint });
  assert(!currentCurve.complete && currentCurve.progressPercent < 90,
    'QA curve progressed beyond the safe bound.');
  const hold = await buildTradeTransaction({ connection, side:'buy', mint, user:trader.publicKey,
    amount:holdSol, slippagePercent:3, feeOwner });
  assert.equal(hold.route, 'curve');
  assert(Number(hold.outputAmount) / 1e6 < currentCurve.realTokenReserves * 0.75,
    'Final holder buy quote would approach migration; stop before sending.');
  const signature = await send(hold.instructions);
  const creatorFeeLamports = await feeDeltas(signature, hold.feeLamports);
  const after = await tokenBalance();
  assert(after > before, 'Final holder buy did not create a positive position.');
  console.log(JSON.stringify({ stage:'holder-position-finalized', signature,
    tokenDeltaBaseUnits:String(after - before), creatorFeeLamports }));
}
console.log(JSON.stringify({ stage:'complete', rounds, finalSolLamports:await connection.getBalance(trader.publicKey, 'finalized'),
  finalTokenBaseUnits:String(await tokenBalance()) }));
process.exit(0);
