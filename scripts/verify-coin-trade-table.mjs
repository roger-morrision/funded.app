import assert from 'node:assert/strict';
import { filterAndSortRecentTrades } from '../coin-detail-model.js';

const day = date => new Date(`${date}T12:00:00`).getTime() / 1000;
const trades = [
  { blockTime: day('2026-09-29'), side: 'buy', solLamports: '2000000000', tokenAmountRaw: '1000000000000', trader: 'walletAlpha', signature: 'signatureOne' },
  { blockTime: day('2026-09-30'), side: 'sell', solLamports: '1000000000', tokenAmountRaw: '200000000000', trader: 'walletBeta', signature: 'signatureTwo' },
  { blockTime: day('2026-09-28'), side: 'buy', solLamports: '500000000', tokenAmountRaw: '500000000000', trader: 'walletGamma', signature: 'signatureThree' },
];
const select = options => filterAndSortRecentTrades(trades, { decimals: 6, solUsd: 100, ...options }).map(item => item.signature);

assert.deepEqual(select({}), ['signatureTwo', 'signatureOne', 'signatureThree']);
assert.deepEqual(select({ dateFrom: '2026-09-29', dateTo: '2026-09-29' }), ['signatureOne']);
assert.deepEqual(select({ side: 'sell' }), ['signatureTwo']);
assert.deepEqual(select({ minUsd: 150, maxUsd: 250 }), ['signatureOne']);
assert.deepEqual(select({ minToken: 400_000, maxToken: 600_000 }), ['signatureThree']);
assert.deepEqual(select({ minSol: 0.75, maxSol: 1.5 }), ['signatureTwo']);
assert.deepEqual(select({ minPrice: 0.0004, maxPrice: 0.0006 }), ['signatureTwo']);
assert.deepEqual(select({ wallet: 'ALPHA' }), ['signatureOne']);
assert.deepEqual(select({ signature: 'THREE' }), ['signatureThree']);
assert.deepEqual(select({ sortKey: 'usd', sortDirection: 'asc' }), ['signatureThree', 'signatureTwo', 'signatureOne']);
assert.deepEqual(select({ sortKey: 'date', sortDirection: 'asc' }), ['signatureThree', 'signatureOne', 'signatureTwo']);
assert.deepEqual(select({ sortKey: 'type', sortDirection: 'asc' }), ['signatureOne', 'signatureThree', 'signatureTwo']);
assert.deepEqual(select({ sortKey: 'token', sortDirection: 'asc' }), ['signatureTwo', 'signatureThree', 'signatureOne']);
assert.deepEqual(select({ sortKey: 'sol', sortDirection: 'desc' }), ['signatureOne', 'signatureTwo', 'signatureThree']);
assert.deepEqual(select({ sortKey: 'price', sortDirection: 'desc' }), ['signatureTwo', 'signatureOne', 'signatureThree']);
assert.deepEqual(select({ sortKey: 'trader', sortDirection: 'desc' }), ['signatureThree', 'signatureTwo', 'signatureOne']);
assert.deepEqual(select({ sortKey: 'txn', sortDirection: 'asc' }), ['signatureOne', 'signatureThree', 'signatureTwo']);
assert.deepEqual(select({ minUsd: 1, solUsd: null }), []);
assert.deepEqual(select({ sortKey: 'price', sortDirection: 'desc', solUsd: null }), ['signatureOne', 'signatureTwo', 'signatureThree']);
assert.deepEqual(trades.map(item => item.signature), ['signatureOne', 'signatureTwo', 'signatureThree'], 'sorting must not mutate the feed');
console.log('Coin trade column filtering and sorting verified.');
