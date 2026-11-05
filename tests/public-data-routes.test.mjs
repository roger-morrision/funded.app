import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
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

test('launch pagination filters retired launches before paging and rejects malformed limits', async () => {
  const reads = [];
  const f = fixture(createDirectoryRoutes, { store: { readLaunches: async options => {
    reads.push(options); return [{ mint:'legacy', pumpFeeRoute:{scope:'per-mint-v2'} },
      { mint, pumpFeeRoute:{scope:'per-mint-v3'} }]; } } });
  assert.equal(await f.request('/api/launches'), true);
  await f.request('/api/launches?limit=999&offset=100001');
  await f.request('/api/launches?limit=0&offset=0');
  for (const query of ['limit=-1', 'limit=1.2', 'offset=no', 'limit=']) await f.request(`/api/launches?${query}`);
  assert.deepEqual(reads, [undefined, undefined, undefined]);
  assert.deepEqual(f.responses.map(r => r.status), [200, 200, 200, 400, 400, 400, 400]);
  assert.deepEqual(f.responses[0].data.map(row => row.mint), [mint]);
  assert.deepEqual(f.responses[1].data, []);
  assert.deepEqual(f.responses[2].data, []);
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

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++)
    await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'Expected queued market scan to advance');
}

test('five uncached catalog mints queue behind four active market scans', async () => {
  const releases = [];
  let active = 0, peak = 0, started = 0;
  const f = fixture(createTokenMarketRoutes, {
    solanaRpcUrl:'https://api.devnet.solana.com', clientKey:() => 'catalog',
    store:{ readMarketActivity:async () => null, chargeRpcRate:async () => true,
      writeMarketActivity:async () => {} },
    readMarketActivity:() => new Promise(resolve => {
      started++; active++; peak = Math.max(peak, active);
      releases.push(() => { active--; resolve({ poolHistoryCoverage:'complete',
        observedCoverage:'complete', tradeCount24h:null }); });
    }),
  });
  const requests = Array.from({ length:5 }, () => f.request(
    `/api/tokens/${Keypair.generate().publicKey.toBase58()}/market-activity`));
  await waitFor(() => started === 4);
  assert.equal(peak, 4);
  releases.shift()();
  await waitFor(() => started === 5);
  for (const release of releases) release();
  await Promise.all(requests);
  assert.equal(peak, 4);
  assert.deepEqual(f.responses.map(response => response.status), [200, 200, 200, 200, 200]);
});

test('concurrent requests for one mint share one scan and one rate charge', async () => {
  let started = 0, charges = 0, release;
  const f = fixture(createTokenMarketRoutes, {
    solanaRpcUrl:'https://api.devnet.solana.com', clientKey:() => 'catalog',
    store:{ readMarketActivity:async () => null,
      chargeRpcRate:async () => { charges++; return true; },
      writeMarketActivity:async () => {} },
    readMarketActivity:() => new Promise(resolve => {
      started++; release = () => resolve({ poolHistoryCoverage:'complete',
        observedCoverage:'complete', tradeCount24h:null });
    }),
  });
  const path = `/api/tokens/${Keypair.generate().publicKey.toBase58()}/market-activity`;
  const requests = Array.from({ length:5 }, () => f.request(path));
  await waitFor(() => started === 1);
  release();
  await Promise.all(requests);
  assert.equal(started, 1);
  assert.equal(charges, 1);
  assert.deepEqual(f.responses.map(response => response.status), [200, 200, 200, 200, 200]);
});

test('a recent market result is served at once while a background scan replaces it', async () => {
  let started = 0, release;
  const stale = { observedAt:new Date(Date.now() - 3 * 60_000).toISOString(), poolHistoryCoverage:'complete',
    observedCoverage:'complete', tradeCount24h:null };
  const old = { ...stale, observedAt:new Date(Date.now() - 10 * 60_000).toISOString() };
  let persisted = stale;
  const f = fixture(createTokenMarketRoutes, {
    solanaRpcUrl:'https://api.devnet.solana.com', clientKey:() => 'catalog',
    store:{ readMarketActivity:async () => persisted, chargeRpcRate:async () => true, writeMarketActivity:async () => {} },
    readMarketActivity:() => new Promise(resolve => {
      started++; release = () => resolve({ poolHistoryCoverage:'complete', observedCoverage:'complete', tradeCount24h:null });
    }),
  });
  const path = `/api/tokens/${Keypair.generate().publicKey.toBase58()}/market-activity`;
  await f.request(path);
  assert.equal(f.responses[0].data, stale);
  await waitFor(() => started === 1);
  await f.request(path);
  assert.equal(started, 1, 'a second request reuses the running background scan');
  release();
  await waitFor(() => f.responses.length === 2);
  await new Promise(resolve => setImmediate(resolve));
  await f.request(path);
  assert.notEqual(f.responses[2].data, stale);
  assert.equal(f.responses[2].data.source, 'confirmed-pump-trade-events');

  persisted = old;
  const g = fixture(createTokenMarketRoutes, {
    solanaRpcUrl:'https://api.devnet.solana.com', clientKey:() => 'catalog',
    store:{ readMarketActivity:async () => persisted, chargeRpcRate:async () => true, writeMarketActivity:async () => {} },
    readMarketActivity:async () => ({ poolHistoryCoverage:'complete', observedCoverage:'complete', tradeCount24h:null }),
  });
  await g.request(path);
  assert.equal(g.responses[0].data.source, 'confirmed-pump-trade-events', 'results over five minutes old wait for a new scan');
});

test('explore warmer scans at most two uncovered mints under its own client key', async () => {
  const keys = [], scanned = [];
  const handle = createTokenMarketRoutes({ route, solanaCluster:'devnet', solanaRpcUrl:'http://127.0.0.1:1',
    respond: () => {}, clientKey: req => req.socket.remoteAddress,
    readMarketActivity: async ({ mint: key }) => { scanned.push(key.toBase58()); return { tradeCount24h:null }; },
    store: { chargeRpcRate: async key => { keys.push(key); return true; }, writeMarketActivity: async () => {} } });
  const mints = [mint, Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58(), 'not-a-mint'];
  assert.equal(handle.warmMarketActivity(mints), 2);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(keys, ['market:server-warmer', 'market:server-warmer']);
  assert.deepEqual(scanned, mints.slice(0, 2));
  // Recently scanned mints are skipped on the next feed request.
  assert.equal(handle.warmMarketActivity(mints.slice(0, 2)), 0);
});

test('failed background scans preserve a recent successful snapshot without refreshing its timestamp',async()=>{
 const stale={observedAt:new Date(Date.now()-180000).toISOString(),coverage:'complete',poolHistoryCoverage:'complete',observedCoverage:'complete',tradeCount24h:null,volume24hSol:1};
 let scans=0,writes=0;
 const f=fixture(createTokenMarketRoutes,{solanaRpcUrl:'https://api.devnet.solana.com',clientKey:()=> 'cache-test',
  store:{readMarketActivity:async()=>stale,chargeRpcRate:async()=>true,writeMarketActivity:async()=>{writes++;}},
  readMarketActivity:async()=>{scans++;return {coverage:'unavailable',poolHistoryCoverage:'unavailable',observedCoverage:'unavailable',tradeCount24h:null,volume24hSol:null};}});
 const path=`/api/tokens/${Keypair.generate().publicKey.toBase58()}/market-activity`;
 await f.request(path);await waitFor(()=>scans===1);await new Promise(resolve=>setImmediate(resolve));
 await f.request(path);assert.equal(f.responses[1].data,stale);assert.equal(writes,0);
 assert.equal(f.responses[1].data.observedAt,stale.observedAt);
});
