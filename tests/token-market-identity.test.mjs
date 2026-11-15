import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryRoutes } from '../server/routes/discovery.mjs';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

async function marketRow({ dex, birdeyeMeta, jup }) {
  let body;
  const handle = createDiscoveryRoutes({ store: {}, solanaCluster: 'mainnet-beta', solanaRpcUrl: 'https://x.invalid', birdeyeChain: 'solana',
    fetchPump: async () => null, clientKey: () => 'k', respond: (res, status, payload) => { body = payload; },
    fetchBirdeye: async path => path.includes('multi_price') ? { data: { [BONK]: { value: 0.0000023 } } } : { data: birdeyeMeta },
    freeMarketData: { jupPrices: async () => new Map([[BONK, { priceUsd: 0.0000023 }]]), dexTokens: async () => dex, jupToken: async () => jup } });
  await handle({ method: 'GET' }, {}, new URL(`https://app.test/api/tokens/market?mints=${BONK}`));
  return body.items[0];
}

test('a pasted mint keeps the free-source name when Birdeye metadata is missing', async () => {
  const row = await marketRow({ dex: new Map([[BONK, { mint: BONK, name: 'Bonk', symbol: 'Bonk', imageUri: null }]]), birdeyeMeta: {}, jup: null });
  assert.equal(row.symbol, 'Bonk');
  assert.equal(row.name, 'Bonk');
});

test('a pasted mint with no free or Birdeye identity falls back to Jupiter token search', async () => {
  const row = await marketRow({ dex: new Map(), birdeyeMeta: {}, jup: { id: BONK, name: 'Bonk', symbol: 'Bonk', icon: 'https://img.test/bonk.png' } });
  assert.equal(row.symbol, 'Bonk');
  assert.equal(row.logoUri, 'https://img.test/bonk.png');
  assert.equal(row.priceUsd, 0.0000023);
});
