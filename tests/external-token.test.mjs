import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDexPairs, createExternalTokenMarketReader } from '../server/external-token-market.mjs';
import { isExternalToken, formatUsd, tradeLinks, explainStatus } from '../src/features/coin/external-token.js';

const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const pair = (overrides = {}) => ({
  chainId: 'solana', dexId: 'raydium', url: 'https://dexscreener.com/solana/pool', pairAddress: 'pool',
  baseToken: { address: MINT, name: 'Coin', symbol: 'CN' }, quoteToken: { symbol: 'SOL' },
  priceUsd: '0.5', priceNative: '0.003', marketCap: 500000, liquidity: { usd: 1000 },
  volume: { h24: 200 }, txns: { h24: { buys: 3, sells: 2 } }, priceChange: { h24: -4.5 },
  info: { imageUrl: 'https://cdn.example/x.png', socials: [{ type: 'twitter', url: 'javascript:alert(1)' }, { type: 'telegram', url: 'https://t.me/x' }] },
  ...overrides,
});

test('summarizeDexPairs picks the deepest pool and sums 24h activity', () => {
  const result = summarizeDexPairs([pair(), pair({ dexId: 'meteora', liquidity: { usd: 9000 }, volume: { h24: 50 } }), pair({ baseToken: { address: 'other' } })], MINT);
  assert.equal(result.dex, 'meteora');
  assert.equal(result.volume24hUsd, 250);
  assert.equal(result.trades24h, 10);
  assert.equal(result.poolCount, 2);
  assert.deepEqual(result.socials, [{ type: 'telegram', url: 'https://t.me/x' }]);
  assert.equal(summarizeDexPairs([], MINT), null);
});

test('external market reader skips non-Mainnet clusters and caches Mainnet reads', async () => {
  let calls = 0;
  const fetch = async url => { calls++; assert.match(url, /^https:\/\/api\.dexscreener\.com\/tokens\/v1\/solana\//); return { ok: true, json: async () => [pair()] }; };
  const devnet = createExternalTokenMarketReader({ solanaCluster: 'devnet', fetch });
  assert.equal((await devnet(MINT)).status, 'unsupported-cluster');
  const mainnet = createExternalTokenMarketReader({ solanaCluster: 'mainnet-beta', fetch });
  assert.equal((await mainnet(MINT)).market.priceUsd, 0.5);
  await mainnet(MINT);
  assert.equal(calls, 1);
});

test('external token detection and display helpers', () => {
  assert.equal(isExternalToken({ mint: MINT, launch: null, market: { complete: null, migrated: false } }), true);
  assert.equal(isExternalToken({ mint: MINT, launch: { mint: MINT }, market: { complete: null } }), false);
  assert.equal(isExternalToken({ mint: MINT, launch: null, market: { complete: false } }), false);
  assert.equal(isExternalToken({ mint: MINT, richMint: MINT, launch: null, market: {} }), false);
  assert.equal(formatUsd(1_234_567), '$1.23M');
  assert.equal(formatUsd(0.000123), '$0.000123');
  assert.equal(formatUsd(null), '$—');
  assert.match(tradeLinks(MINT)[0][1], /^https:\/\/jup\.ag\/swap\/SOL-/);
  assert.match(explainStatus({ status: 'unsupported-cluster' }), /Mainnet/);
  assert.equal(explainStatus({ status: 'available' }), null);
});
