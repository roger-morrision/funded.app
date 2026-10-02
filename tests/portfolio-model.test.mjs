import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateTokenAccounts, matchedTradePnl } from '../portfolio-model.js';

test('aggregates multiple token accounts and excludes empty balances', () => {
  const row = (mint, amount, decimals = 2) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } });
  assert.deepEqual(aggregateTokenAccounts([row('mintA', '123'), row('mintA', '77'), row('mintB', '0')]).map(({ mint, raw, quantity }) => ({ mint, raw, quantity })), [
    { mint: 'mintA', raw: 200n, quantity: 2 },
  ]);
});

test('matches only observed buy lots and excludes unknown opening position', () => {
  const trades = [
    { mint: 'A', side: 'sell', blockTime: 1, tokenAmountRaw: '100', solAmount: 8 },
    { mint: 'A', side: 'buy', blockTime: 2, tokenAmountRaw: '200', solAmount: 2 },
    { mint: 'A', side: 'sell', blockTime: 3, tokenAmountRaw: '100', solAmount: 2 },
  ];
  assert.deepEqual(matchedTradePnl(trades, new Map([['A', 2]])), { pnlSol: 1, matchedSales: 1 });
});
