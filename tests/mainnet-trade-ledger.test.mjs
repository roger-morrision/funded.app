import test from 'node:test';
import assert from 'node:assert/strict';
import { feeTradeFromTransaction, rankLedgerTraders } from '../server/mainnet-trade-ledger.mjs';

const FEE = 'FeeWa11et1111111111111111111111111111111111';
const TRADER = 'Trader11111111111111111111111111111111111111';
const MINT = 'Mint111111111111111111111111111111111111111';
const tx = ({ fee = 1_000_000, source = TRADER, tokenBefore = '0', tokenAfter = '500', err = null } = {}) => ({
  blockTime: 1_800_000_000, slot: 5,
  transaction: { message: { accountKeys: [{ pubkey: TRADER }, { pubkey: FEE }], instructions: [
    { program: 'system', parsed: { type: 'transfer', info: { source, destination: FEE, lamports: fee } } }] } },
  meta: { err, innerInstructions: [],
    preTokenBalances: [{ owner: TRADER, mint: MINT, uiTokenAmount: { amount: tokenBefore } }],
    postTokenBalances: [{ owner: TRADER, mint: MINT, uiTokenAmount: { amount: tokenAfter } }] },
});

test('an app trade is read from the fee transfer and the trader token change', () => {
  const buy = feeTradeFromTransaction(tx(), { feeOwner: FEE, signature: 'sig1' });
  assert.equal(buy.side, 'buy'); assert.equal(buy.wallet, TRADER); assert.equal(buy.mint, MINT);
  assert.equal(buy.volumeLamports, '100000000');
  const sell = feeTradeFromTransaction(tx({ tokenBefore: '500', tokenAfter: '0', fee: 408_284 }), { feeOwner: FEE, signature: 'sig2' });
  assert.equal(sell.side, 'sell'); assert.equal(sell.volumeLamports, '40828400');
});

test('payments without a swap, failed transactions and third-party fee transfers are not trades', () => {
  assert.equal(feeTradeFromTransaction(tx({ tokenBefore: '0', tokenAfter: '0' }), { feeOwner: FEE, signature: 's' }), null);
  assert.equal(feeTradeFromTransaction(tx({ err: { InstructionError: [0, 'x'] } }), { feeOwner: FEE, signature: 's' }), null);
  assert.equal(feeTradeFromTransaction(tx({ source: 'Someone1111111111111111111111111111111111111' }), { feeOwner: FEE, signature: 's' }), null);
});

test('traders rank by SOL volume within the window', () => {
  const rows = [
    { signature: 'a', wallet: 'W1', mint: 'M1', side: 'buy', volumeLamports: '100000000', blockTime: 100 },
    { signature: 'b', wallet: 'W2', mint: 'M1', side: 'buy', volumeLamports: '300000000', blockTime: 100 },
    { signature: 'c', wallet: 'W1', mint: 'M2', side: 'sell', volumeLamports: '50000000', blockTime: 50 },
  ];
  const board = rankLedgerTraders(rows, { sinceSeconds: 60 });
  assert.deepEqual(board.traders.map(row => row.wallet), ['W2', 'W1']);
  assert.equal(board.traders[1].tradeCount, 1);
  assert.equal(board.tokenCount, 1);
});
