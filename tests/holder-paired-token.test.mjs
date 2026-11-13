import test from 'node:test';
import assert from 'node:assert/strict';
import { holderPoolMinimumLamports } from '../server/reward-scheduler.mjs';
import { AUTOMATIC_REWARDS } from '../automatic-rewards.js';

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const paired = { asset: USDC, quoteMint: USDC, eligibilityPolicy: 'usd-20-hourly-v1' };
const usdcQuote = { quoteMint: USDC, quoteUsd: 1, quoteDecimals: 6, solUsd: null };

test('paired-token pool minimum is the dollar threshold in the token base units', () => {
  const expected = BigInt(Math.round((AUTOMATIC_REWARDS.minimumPoolUsd + 3 * AUTOMATIC_REWARDS.costReserveUsdPerHolder) * 1e6));
  assert.equal(holderPoolMinimumLamports(paired, usdcQuote, 3), expected);
});

test('QA paired-token pools use the QA pool minimum without a per-holder reserve', () => {
  const config = { ...paired, eligibilityPolicy: 'usd-qa-hourly-v1', qaMinimums: { minimumPoolUsd: 0.001 } };
  assert.equal(holderPoolMinimumLamports(config, usdcQuote, 5), 1000n);
});

test('non-stable paired tokens convert at their USD price', () => {
  const config = { ...paired, eligibilityPolicy: 'usd-qa-hourly-v1', qaMinimums: { minimumPoolUsd: 1 } };
  assert.equal(holderPoolMinimumLamports(config, { ...usdcQuote, quoteUsd: 250, quoteDecimals: 8 }, 0), 400000n);
});

test('a paired-token pool refuses a missing or mismatched quote', () => {
  assert.throws(() => holderPoolMinimumLamports(paired, { ...usdcQuote, quoteUsd: null }, 1), /paired-token USD quote/);
  assert.throws(() => holderPoolMinimumLamports(paired, { ...usdcQuote, quoteMint: 'So11111111111111111111111111111111111111112' }, 1), /paired-token USD quote/);
});

test('SOL pools still require a SOL/USD quote', () => {
  assert.throws(() => holderPoolMinimumLamports({ asset: 'SOL', eligibilityPolicy: 'usd-20-hourly-v1' }, { solUsd: null }, 1), /SOL\/USD/);
});
