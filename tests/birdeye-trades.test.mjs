import test from 'node:test';
import assert from 'node:assert/strict';
import { birdeyeTradeRows, readBirdeyeTrades } from '../server/birdeye-trades.mjs';

const MINT = '85RhcSEMy15SNhFLmSArNm7udPKXVagVgsq4YmSopump';
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SIG = '2zN2zSkNoUYBdWFQNSnKEPTu8MvyVVtndVL2YbgxD1o6FXipjsNjhss6akftGYWzCFbmuM4jXtjsFfygLqhR275f';
const OWNER = '6mZECCkZXgJuneU16aSJtFvYDF3hf5S7zGij9WknGZv3';

const sellToUsdc = { tx_type: 'sell', tx_hash: SIG, block_unix_time: 1794794190, volume_usd: 2.67, owner: OWNER,
  from: { address: MINT, decimals: 6, amount: '15769340622' }, to: { address: USDC, decimals: 6, amount: '2671458' } };
const buyWithSol = { tx_type: 'buy', tx_hash: SIG.replace('2', '3'), block_unix_time: 1794794200, volume_usd: 20, owner: OWNER,
  from: { address: WSOL, decimals: 9, amount: '100000000' }, to: { address: MINT, decimals: 6, amount: '500000000' } };

test('Birdeye trades map to the token page trade rows', () => {
  const rows = birdeyeTradeRows([sellToUsdc, buyWithSol, { tx_type: 'buy' }], { mint: MINT, wsol: WSOL, solUsd: 200 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { signature: buyWithSol.tx_hash, blockTime: 1794794200, side: 'buy', trader: OWNER, solLamports: '100000000', tokenAmountRaw: '500000000', usd: 20 });
  assert.equal(rows[1].side, 'sell');
  assert.equal(rows[1].tokenAmountRaw, '15769340622');
  assert.equal(rows[1].solLamports, String(Math.round(2.67 / 200 * 1e9)), 'non-SOL pairs convert the USD value');
});

test('Birdeye fallback needs a configured key and returns decimals', async () => {
  assert.equal(await readBirdeyeTrades(async () => ({ configured: false }), { mint: MINT, wsol: WSOL, solUsd: 200 }), null);
  const result = await readBirdeyeTrades(async () => ({ configured: true, data: { items: [buyWithSol] } }), { mint: MINT, wsol: WSOL, solUsd: 200 });
  assert.equal(result.decimals, 6);
  assert.equal(result.trades.length, 1);
});
