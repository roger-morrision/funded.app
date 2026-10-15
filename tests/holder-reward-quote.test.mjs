import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { createHolderRewardQuoteReader } from '../server/holder-reward-quote.mjs';

const mint = '11111111111111111111111111111111';
const now = Date.now();
const curve = { quoteMint:NATIVE_MINT, complete:false,
  virtualTokenReserves:new BN('100000000'), virtualQuoteReserves:new BN('1000000000'),
  realTokenReserves:new BN('100000000'), realQuoteReserves:new BN('1000000000') };

test('holder price gate uses a finalized Pump curve and a fresh SOL quote', async () => {
  const reads = [];
  const connection = {
    getParsedAccountInfo:async (_key, commitment) => {
      reads.push(commitment);
      return { value:{ owner:TOKEN_PROGRAM_ID, data:{ parsed:{ info:{ decimals:6 } } } } };
    },
    getAccountInfo:async (_key, commitment) => {
      reads.push(commitment); return { owner:PUMP_PROGRAM_ID };
    },
  };
  const read = createHolderRewardQuoteReader({ connection, now:() => now,
    decodeCurve:() => curve, readSolUsd:async () => ({ priceUsd:200,
      fetchedAt:new Date(now).toISOString() }) });
  const quote = await read(mint);
  assert.equal(quote.decimals, 6);
  assert.equal(quote.tokenPriceUsd, 2);
  assert.deepEqual(reads, ['finalized','finalized']);
  assert.match(quote.source, /Pump-curve/);

  const nativeSol = createHolderRewardQuoteReader({ connection, now:() => now,
    decodeCurve:() => ({ ...curve, quoteMint:SystemProgram.programId }),
    readSolUsd:async () => ({ priceUsd:200, fetchedAt:new Date(now).toISOString() }) });
  assert.equal((await nativeSol(mint)).tokenPriceUsd, 2);

  const stale = createHolderRewardQuoteReader({ connection, now:() => now,
    decodeCurve:() => curve, readSolUsd:async () => ({ priceUsd:200,
      fetchedAt:new Date(now - 6 * 60_000).toISOString() }) });
  await assert.rejects(stale(mint), /fresh SOL and token price/);
  const wrongOwner = createHolderRewardQuoteReader({ connection:{ ...connection,
    getAccountInfo:async () => ({ owner:new PublicKey(mint) }) }, now:() => now,
    decodeCurve:() => curve, readSolUsd:async () => ({ priceUsd:200,
      fetchedAt:new Date(now).toISOString() }) });
  await assert.rejects(wrongOwner(mint), /finalized Pump bonding curve/);
});
