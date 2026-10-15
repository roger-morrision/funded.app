import test from 'node:test';
import assert from 'node:assert/strict';
import { followingTokenSources } from '../following-token-model.js';

const wallet = '9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w';
const other = '7ngaVZdeipr6uZy2inh267PjZLLYFuAfsPoTRZixjJMk';
const heldMint = 'So11111111111111111111111111111111111111112';
const tradedMint = '9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
const unrelatedMint = 'HdGmAbwR1ng3VTQkQ6Gw3QYhJGebWNFf5voktjCKwhvL';
const trade = trader => ({ trader, side:'buy', signature:'5'.repeat(88), blockTime:1, solLamports:'1000000' });

test('Following combines current holdings and observed trades without using token favorites', () => {
  const records = [
    { address:heldMint, recentTrades:[] },
    { address:tradedMint, recentTrades:[trade(wallet)] },
    { address:unrelatedMint, recentTrades:[trade(other)] },
  ];
  const sources = followingTokenSources(records, [{ address:wallet }], new Map([
    [wallet, { mints:new Set([heldMint, 'unlisted-mint']) }],
  ]));
  assert.deepEqual([...sources.keys()], [heldMint, tradedMint]);
  assert.deepEqual([...sources.get(heldMint).heldBy], [wallet]);
  assert.deepEqual([...sources.get(tradedMint).tradedBy], [wallet]);
  assert.equal(sources.has(unrelatedMint), false);
});

test('A trade does not imply a current holding', () => {
  const sources = followingTokenSources([{ address:tradedMint, recentTrades:[trade(wallet)] }], [{ address:wallet }]);
  assert.equal(sources.get(tradedMint).heldBy.size, 0);
  assert.equal(sources.get(tradedMint).tradedBy.size, 1);
});

test('An unavailable balance check cannot present an old holding as current', () => {
  const sources = followingTokenSources([{ address:heldMint, recentTrades:[] }], [{ address:wallet }],
    new Map([[wallet, { status:'unavailable', mints:new Set([heldMint]) }]]));
  assert.equal(sources.has(heldMint), false);
});
