import test from 'node:test';
import assert from 'node:assert/strict';
import { buyRequiredLamports, hasBuyBalance, TRADE_COST_ALLOWANCE_LAMPORTS } from '../trade-spend-guard.js';

test('Buy guard includes maximum slippage, app fee, and account cost allowance', () => {
  const input = { amountSol:0.999, slippagePercent:1, feeBps:50 };
  assert.equal(hasBuyBalance(1_000_000_000n, input), false);
  assert.equal(buyRequiredLamports(input), 1_018_985_000n);
  assert.equal(hasBuyBalance(1_018_985_000n, input), true);
  assert.equal(hasBuyBalance(null, input), false);
});

test('Buy guard uses the prepared pool maximum and exact app fee', () => {
  const input = { amountSol:0.25, slippagePercent:1, feeBps:50,
    trade:{ maximumInputAmount:{ toString:() => '260000000' }, feeLamports:1_250_000 } };
  const required = 261_250_000n + TRADE_COST_ALLOWANCE_LAMPORTS;
  assert.equal(buyRequiredLamports(input), required);
  assert.equal(hasBuyBalance(required - 1n, input), false);
  assert.equal(hasBuyBalance(required, input), true);
});
