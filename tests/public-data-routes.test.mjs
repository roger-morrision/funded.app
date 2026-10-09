import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectoryRoutes } from '../server/routes/directory.mjs';
import { createPublicReportsRoutes } from '../server/routes/public-reports.mjs';
import { createQuoteAssetsRoutes } from '../server/routes/quote-assets.mjs';
import { createTokenMarketRoutes } from '../server/routes/token-market.mjs';

const mint = 'So11111111111111111111111111111111111111112';
const route = (path, method, pattern) => method === 'GET' ? pattern.exec(path)?.[1] : null;
function fixture(create, dependencies = {}) {
  const responses = [];
  const handle = create({ route, solanaCluster: 'devnet', ...dependencies,
    respond: (_res, status, data) => responses.push({ status, data }) });
  return { responses, async request(path, method = 'GET') {
    return handle({ method }, {}, new URL(path, 'https://funded.vip'));
  } };
}

test('public data routes leave other methods and paths to the shared router', async () => {
  for (const create of [createDirectoryRoutes, createPublicReportsRoutes, createQuoteAssetsRoutes, createTokenMarketRoutes]) {
    const f = fixture(create);
    for (const [path, method] of [['/api/health', 'GET'], ['/api/launches', 'POST'], ['/api/quote-assets', 'OPTIONS']]) {
      assert.equal(await f.request(path, method), false);
    }
    assert.deepEqual(f.responses, []);
  }
});

test('launch pagination keeps the unbounded default and rejects malformed limits before reading', async () => {
  const reads = [];
  const f = fixture(createDirectoryRoutes, { store: { readLaunches: async options => { reads.push(options); return [{ mint }]; } } });
  assert.equal(await f.request('/api/launches'), true);
  await f.request('/api/launches?limit=999&offset=100001');
  await f.request('/api/launches?limit=0&offset=0');
  for (const query of ['limit=-1', 'limit=1.2', 'offset=no', 'limit=']) await f.request(`/api/launches?${query}`);
  assert.deepEqual(reads, [{ limit: null, offset: 0 }, { limit: 100, offset: 100000 }, { limit: 0, offset: 0 }]);
  assert.deepEqual(f.responses.map(r => r.status), [200, 200, 200, 400, 400, 400, 400]);
});

test('public state uses sanitized buckets and payment history keeps coverage metadata', async () => {
  const buckets = { launches: {}, privateField: 'must not leave sanitizer' };
  const receipt = { payments: [{ signature: 'receipt' }], coverage: 'partial' };
  const f = fixture(createPublicReportsRoutes, {
    store: { readPublicBuckets: async () => buckets },
    publicState: value => { assert.equal(value, buckets); return { launches: value.launches }; },
    readPaymentHistory: async () => receipt,
  });
  await f.request('/api/state');
  await f.request('/api/evidence/payment-history');
  assert.deepEqual(f.responses[0], { status: 200, data: { launches: {} } });
  assert.equal(f.responses[1].data, receipt);
});

test('market routes retain invalid mint and RPC rate gates', async () => {
  let charges = 0;
  const f = fixture(createTokenMarketRoutes, { clientKey: () => 'test', store: {
    readMarketActivity: async () => null,
    chargeRpcRate: async () => { charges++; return false; },
  } });
  for (const resource of ['token-accounts', 'market-activity']) {
    await f.request(`/api/tokens/invalid/${resource}`);
    await f.request(`/api/tokens/${mint}/${resource}`);
  }
  assert.deepEqual(f.responses.map(r => r.status), [400, 429, 400, 429]);
  assert.equal(charges, 2);
});

test('market caches persist across requests but are isolated between router instances', async () => {
  let reads = 0;
  const data = { observedAt: new Date().toISOString(), poolHistoryCoverage: 'partial', observedCoverage: 'partial', tradeCount24h: null };
  const dependencies = { store: {
    readMarketActivity: async () => { reads++; return data; },
    chargeRpcRate: () => assert.fail('Fresh persisted evidence should not make another RPC request'),
  } };
  const f = fixture(createTokenMarketRoutes, dependencies);
  const path = `/api/tokens/${mint}/market-activity`;
  await f.request(path);
  await f.request(path);
  assert.equal(reads, 1);
  assert.equal(f.responses[0].data, data);
  assert.equal(f.responses[1].data, data);
  await fixture(createTokenMarketRoutes, dependencies).request(path);
  assert.equal(reads, 2);
});

test('incomplete persisted market data is not reused as a complete trade breakdown', async () => {
  let charges = 0;
  const f = fixture(createTokenMarketRoutes, { clientKey: () => 'test', store: {
    readMarketActivity: async () => ({ observedAt: new Date().toISOString(), tradeCount24h: 2 }),
    chargeRpcRate: async () => { charges++; return false; },
  } });
  await f.request(`/api/tokens/${mint}/market-activity`);
  assert.equal(charges, 1);
  assert.equal(f.responses[0].status, 429);
});
