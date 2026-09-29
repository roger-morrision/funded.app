import { assertPositiveQuoteAmount, assertTradeConfirmed, buildTradeFeePolicy, buildTradeTransaction, describeTradeQuote, estimateBuyTokenAmountFromSnapshot, formatBondingCurveSnapshot, formatGraduatedPoolSnapshot, submitTrade } from '../pump-trading.js';
import BN from 'bn.js';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

const fee = buildTradeFeePolicy({ feeOwner: '11111111111111111111111111111111', feeBps: 50 });
if (!fee.enabled || fee.percent !== 0.5) throw new Error('Expected 50 bps trade fee policy.');
if (buildTradeFeePolicy({ feeBps: 50 }).enabled) throw new Error('Missing owner must disable trading.');

const snapshot = formatBondingCurveSnapshot({
  mint: '11111111111111111111111111111111',
  bondingCurve: {
    complete: false,
    virtualTokenReserves: new BN('1000000'),
    virtualQuoteReserves: new BN('1000000000'),
    realTokenReserves: new BN('250000'),
    realQuoteReserves: new BN('500000000'),
    creator: 'creator',
    quoteMint: 'quote',
  },
});
if (snapshot.progressPercent !== 75 || snapshot.complete) throw new Error('Bonding-curve snapshot calculation is invalid.');
const poolKey = new PublicKey('11111111111111111111111111111111');
const poolSnapshot = formatGraduatedPoolSnapshot({
  mint: poolKey,
  poolKey,
  tokenDecimals: 6,
  state: {
    poolBaseAmount: new BN('200000000'),
    poolQuoteAmount: new BN('3000000000'),
    pool: {
      virtualQuoteReserves: new BN('1000000000'),
      poolBaseTokenAccount: poolKey,
      poolQuoteTokenAccount: poolKey,
      creator: poolKey,
      coinCreator: poolKey,
    },
  },
});
if (poolSnapshot.baseTokenReserves !== 200 || poolSnapshot.quoteReservesSol !== 3 || poolSnapshot.effectiveQuoteReservesSol !== 4 || poolSnapshot.spotPriceSol !== 0.02) throw new Error('Graduated PumpSwap snapshot calculation is invalid.');
const curveEstimate = estimateBuyTokenAmountFromSnapshot({ amountSol: 1, curveSnapshot: snapshot });
if (curveEstimate.route !== 'curve' || curveEstimate.expectedTokens !== 0.5) throw new Error('Live Pump curve buy estimate is invalid.');
const poolEstimate = estimateBuyTokenAmountFromSnapshot({ amountSol: 1, curveSnapshot: snapshot, graduatedPoolSnapshot: poolSnapshot });
if (poolEstimate.route !== 'graduated-pool' || poolEstimate.expectedTokens !== 40) throw new Error('Live PumpSwap buy estimate is invalid.');
const quote = describeTradeQuote({ side: 'buy', outputAmount: new BN('12345678'), tokenDecimals: 6, feeLamports: 500000 }, 1);
if (quote.expected !== 12.345678 || quote.minimum >= quote.expected || quote.appFeeSol !== 0.0005) throw new Error('Trade preview is invalid.');
const sellQuote = describeTradeQuote({ side:'sell', outputAmount:new BN('11733814'), feeLamports:58670 }, 1);
if (sellQuote.expected !== 0.011733814 || sellQuote.expectedNetSol !== 0.011675144 || sellQuote.minimumNetSol >= sellQuote.expectedNetSol) throw new Error('Sell preview must show wallet SOL after the app fee.');
const poolQuote = describeTradeQuote({ route: 'graduated-pool', side: 'buy', outputAmount: new BN('12345678'), minimumOutputAmount: new BN('12345678'), maximumInputAmount: new BN('10100000'), tokenDecimals: 6, feeLamports: 50000 }, 1);
if (poolQuote.maximumSpendSol !== 0.0101 || poolQuote.expected !== poolQuote.minimum) throw new Error('Graduated-pool maximum spend is missing from the review quote.');
assertPositiveQuoteAmount(new BN(1), 'SOL');
let zeroOutputRejected = false;
try { assertPositiveQuoteAmount(new BN(0), 'SOL'); } catch (error) { zeroOutputRejected = error.message.includes('no SOL output'); }
if (!zeroOutputRejected) throw new Error('A zero-output trade quote was accepted.');
assertTradeConfirmed({ value: { err: null } });
let failedConfirmationRejected = false;
try { assertTradeConfirmed({ value: { err: { InstructionError: [0, 'Custom'] } } }); } catch { failedConfirmationRejected = true; }
if (!failedConfirmationRejected) throw new Error('Failed on-chain confirmation was accepted.');
const user = new PublicKey('11111111111111111111111111111111');
for (const slippagePercent of [0, 0.09, 10.01]) {
  let invalidSlippageRejected = false;
  try { await buildTradeTransaction({ connection: {}, side: 'buy', mint: user, user, amount: 1, slippagePercent, feeOwner: user, feeBps: 50 }); }
  catch (error) { invalidSlippageRejected = error.message.includes('between 0.1% and 10%'); }
  if (!invalidSlippageRejected) throw new Error(`Invalid slippage ${slippagePercent} was accepted.`);
}
let staleQuoteRejected = false;
try {
  await submitTrade({
    connection: { getLatestBlockhash: () => { throw new Error('Stale quote reached signing.'); } },
    provider: { signTransaction: () => { throw new Error('Stale quote reached signing.'); } },
    side: 'buy', mint: user, user, amount: 2, slippagePercent: 1,
    preparedTrade: { side: 'buy', mint: user, user, inputAmount: 1, slippagePercent: 1, instructions: [] },
  });
} catch (error) { staleQuoteRejected = error.message.includes('no longer matches'); }
if (!staleQuoteRejected) throw new Error('Changed quote was accepted for signing.');
let failedSubmitRejected = false;
try {
  await submitTrade({
    connection: {
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }),
      sendRawTransaction: async () => 'failed-signature',
      confirmTransaction: async () => ({ value: { err: { InstructionError: [0, 'Custom'] } } }),
    },
    provider: { signTransaction: async () => ({ serialize: () => Buffer.from([1]) }) },
    side: 'buy', mint: user, user, amount: 1, slippagePercent: 1,
    preparedTrade: { side: 'buy', mint: user, user, inputAmount: 1, slippagePercent: 1, outputAmount: new BN(1), instructions: [SystemProgram.transfer({ fromPubkey: user, toPubkey: user, lamports: 1 })] },
  });
} catch (error) { failedSubmitRejected = error.message.includes('did not confirm successfully'); }
if (!failedSubmitRejected) throw new Error('Failed submitted transaction was reported as confirmed.');
const mobilePayer = Keypair.generate();
const originalBlockhash = Keypair.generate().publicKey.toBase58();
const refreshedBlockhash = Keypair.generate().publicKey.toBase58();
const mobileTrade = { side:'buy', mint:user, user:mobilePayer.publicKey, inputAmount:0.01, slippagePercent:1, outputAmount:new BN(1), instructions:[SystemProgram.transfer({ fromPubkey:mobilePayer.publicKey, toPubkey:user, lamports:1 })] };
let broadcastOptions, confirmationStrategy;
const mobileConnection = {
  getLatestBlockhash:async () => ({ blockhash:originalBlockhash, lastValidBlockHeight:100 }),
  getBlockHeight:async () => 50,
  sendRawTransaction:async (bytes, options) => { broadcastOptions=options; if (Transaction.from(bytes).recentBlockhash !== refreshedBlockhash) throw new Error('The signed blockhash was not refreshed.'); return 'mobile-signature'; },
  confirmTransaction:async strategy => { confirmationStrategy=strategy; return { value:{ err:null } }; },
};
const mobileProvider = { remoteMobile:true, signTransaction:async unsigned => { unsigned.recentBlockhash=refreshedBlockhash; unsigned.sign(mobilePayer); unsigned.fundedLastValidBlockHeight=100; return unsigned; } };
const mobileResult = await submitTrade({ connection:mobileConnection, provider:mobileProvider, side:'buy', mint:user, user:mobilePayer.publicKey, amount:0.01, slippagePercent:1, preparedTrade:mobileTrade });
if (mobileResult.signature !== 'mobile-signature' || broadcastOptions.preflightCommitment !== 'confirmed' || confirmationStrategy.blockhash !== refreshedBlockhash) throw new Error('Refreshed mobile trade was not broadcast and confirmed with the signed blockhash.');
let expiredMobileRejected = false;
try { await submitTrade({ connection:{ ...mobileConnection, getBlockHeight:async () => 95, sendRawTransaction:async () => { throw new Error('Expired trade was broadcast.'); } }, provider:mobileProvider, side:'buy', mint:user, user:mobilePayer.publicKey, amount:0.01, slippagePercent:1, preparedTrade:mobileTrade }); }
catch (error) { expiredMobileRejected=error.message.includes('expired during phone approval'); }
if (!expiredMobileRejected) throw new Error('Expired mobile trade was not stopped before broadcast.');
console.log('pump trading checks passed');
