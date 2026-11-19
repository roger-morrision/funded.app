import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_MINT } from '@solana/spl-token';
import { Keypair } from '@solana/web3.js';
import { tradeInSolTerms } from '../server/coin-market.mjs';

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const base = { tokenAmountRaw:1000n, isBuy:true, trader:'t' };

test('SOL-quoted and legacy trades pass through unchanged', () => {
  const sol = { ...base, solLamports:5n, quoteMint:NATIVE_MINT.toBase58(), priceRatio:2 };
  assert.equal(tradeInSolTerms(sol, null), sol);
  const legacy = { ...base, solLamports:5n, quoteMint:null, priceRatio:2 };
  assert.equal(tradeInSolTerms(legacy, null), legacy);
});

test('USDC-quoted trades convert volume and price to SOL terms at the SOL/USD price', () => {
  // 0.5 USDC at $100/SOL = 0.005 SOL.
  const t = tradeInSolTerms({ ...base, solLamports:500000n, quoteMint:USDC, priceRatio:0.001 }, { priceUsd:100 });
  assert.equal(t.solLamports, 5_000_000n); assert.equal(t.quoteUnits, 500000n);
  assert.ok(Math.abs(t.priceRatio - 0.01) < 1e-12); assert.equal(t.solTerms, 'usdc-converted');
  // Real USDC curve events carry the amount in quoteAmount with solAmount zero.
  const real = tradeInSolTerms({ ...base, solLamports:0n, quoteAmountRaw:500000n, quoteMint:USDC, priceRatio:0.001 }, { priceUsd:100 });
  assert.equal(real.solLamports, 5_000_000n); assert.equal(real.quoteUnits, 500000n);
});

test('USDC trades are dropped without a usable price; unknown quotes are dropped', () => {
  const usdc = { ...base, solLamports:500000n, quoteMint:USDC, priceRatio:1 };
  for (const price of [null, { priceUsd:0 }, { priceUsd:'x' }]) assert.equal(tradeInSolTerms(usdc, price), null);
  assert.equal(tradeInSolTerms({ ...usdc, quoteMint:Keypair.generate().publicKey.toBase58() }, { priceUsd:100 }), null);
});
