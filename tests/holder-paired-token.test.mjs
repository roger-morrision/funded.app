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

import { PublicKey, Keypair } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { createHolderRewardQuoteReader } from '../server/holder-reward-quote.mjs';

function pairedReader({ complete, pool }) {
  const quoteMint = new PublicKey(USDC);
  const connection = {
    getParsedAccountInfo: async key => key.equals(quoteMint)
      ? { value: { data: { parsed: { info: { decimals: 6 } } } } }
      : { value: { owner: TOKEN_2022_PROGRAM_ID, data: { parsed: { info: { decimals: 6, supply: '1000000000000000' } } } } },
    getAccountInfo: async () => ({ owner: PUMP_PROGRAM_ID }),
  };
  return createHolderRewardQuoteReader({ connection, env: {}, readSolUsd: async () => ({}), now: () => Date.parse('2026-11-13T00:00:00Z'),
    decodeCurve: () => ({ complete, quoteMint, virtualTokenReserves: 1_000_000_000_000_000n, virtualQuoteReserves: 5_000_000_000n }),
    readPairedPool: async () => pool });
}

test('a USDC-paired curve is priced in USDC at $1', async () => {
  const quote = await pairedReader({ complete: false })(Keypair.generate().publicKey.toBase58());
  assert.equal(quote.tokenPriceUsd, 5_000 / 1_000_000_000);
  assert.equal(quote.quoteDecimals, 6);
  assert.equal(quote.source, 'finalized-Pump-curve-in-stablecoin');
});

test('a migrated USDC-paired coin is priced from its canonical pool', async () => {
  const quote = await pairedReader({ complete: true, pool: { baseAmount: 200_000_000_000_000n, quoteAmount: 40_000_000_000n } })(Keypair.generate().publicKey.toBase58());
  assert.equal(quote.tokenPriceUsd, 40_000 / 200_000_000);
  assert.equal(quote.source, 'finalized-PumpSwap-pool-in-stablecoin');
});

test('migrated paired coins exclude their paired-token pool and off-curve owners from holder payouts', async () => {
  const { excludedHolderWallets, payableHolder } = await import('../server/reward-scheduler.mjs');
  const { canonicalPumpPoolPda } = await import('@pump-fun/pump-swap-sdk');
  const { PublicKey, Keypair } = await import('@solana/web3.js');
  const mint = 'G4thnUUDeqrfPvLLLxeGcTTXzjut5qneCquqk1Bc5BMQ', usdc = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const pool = canonicalPumpPoolPda(new PublicKey(mint), new PublicKey(usdc)).toBase58();
  assert.equal(pool, '2wgVgeLEmyQZ1mLxpk6djkbVgzZQrK3Q9VcUEhvzWQ98');
  assert.ok(excludedHolderWallets(mint, [], usdc).includes(pool));
  assert.ok(!excludedHolderWallets(mint, []).includes(pool));
  assert.equal(payableHolder(pool), false);
  assert.equal(payableHolder(Keypair.generate().publicKey.toBase58()), true);
});
