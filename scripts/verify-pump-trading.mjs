import { assertTradeConfirmed, buildTradeFeePolicy, describeTradeQuote, formatBondingCurveSnapshot, submitTrade } from '../pump-trading.js';
import BN from 'bn.js';
import { PublicKey, SystemProgram } from '@solana/web3.js';

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
const quote = describeTradeQuote({ side: 'buy', outputAmount: new BN('12345678'), tokenDecimals: 6, feeLamports: 500000 }, 1);
if (quote.expected !== 12.345678 || quote.minimum >= quote.expected || quote.appFeeSol !== 0.0005) throw new Error('Trade preview is invalid.');
assertTradeConfirmed({ value: { err: null } });
let failedConfirmationRejected = false;
try { assertTradeConfirmed({ value: { err: { InstructionError: [0, 'Custom'] } } }); } catch { failedConfirmationRejected = true; }
if (!failedConfirmationRejected) throw new Error('Failed on-chain confirmation was accepted.');
const user = new PublicKey('11111111111111111111111111111111');
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
    preparedTrade: { side: 'buy', mint: user, user, inputAmount: 1, slippagePercent: 1, instructions: [SystemProgram.transfer({ fromPubkey: user, toPubkey: user, lamports: 1 })] },
  });
} catch (error) { failedSubmitRejected = error.message.includes('did not confirm successfully'); }
if (!failedSubmitRejected) throw new Error('Failed submitted transaction was reported as confirmed.');
console.log('pump trading checks passed');
