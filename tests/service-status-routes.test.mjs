import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceStatusRoutes } from '../server/routes/service-status.mjs';
import { GENESIS_HASHES } from '../server/service-status.mjs';

function fixture(overrides = {}) {
  const handlers = createServiceStatusRoutes({
    solanaCluster: 'devnet', solanaRpcUrl: 'https://rpc.example.invalid',
    store: {}, automaticRewardStore: { read: async () => ({}) },
    launchPolicyConfig: () => ({}), keeperKeypair: () => null, v3RouterConfig: () => null,
    birdeyeApiKey: '', pumpApiUrl: '', xOAuthConfigured: () => false,
    readSolUsdQuote: async () => null,
    requireAuthorized: (_req, res) => { res.status = 401; res.responses++; return false; },
    ...overrides,
    respond: (res, status, data) => { res.status = status; res.data = data; res.responses++; },
  });
  return async (handler, path, method = 'GET') => {
    const res = { responses: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; } };
    res.handled = await handlers[handler]({ method }, res, new URL(path, 'https://funded.vip'));
    return res;
  };
}

test('status handlers fall through without writing for unrelated methods and paths', async () => {
  const request = fixture();
  for (const handler of ['handleServiceStatus', 'handleOperationsStatus', 'handleKeeperStatus']) {
    for (const [path, method] of [['/api/unknown', 'GET'], ['/api/status', 'POST'], ['/api/ops/receipt-worker', 'POST']]) {
      const result = await request(handler, path, method);
      assert.equal(result.handled, false);
      assert.equal(result.responses, 0);
    }
  }
});

test('receipt monitoring stops dispatch on denied access and rejects unsupported clusters before reading', async () => {
  let reads = 0;
  const store = { readReceiptBackfillStatus: async () => { reads++; return null; } };
  const denied = await fixture({ store })('handleOperationsStatus', '/api/ops/receipt-worker');
  assert.equal(denied.status, 401);
  assert.equal(denied.handled, true);
  assert.equal(denied.responses, 1);
  assert.equal(denied.headers['cache-control'], 'no-store');
  const unsupported = await fixture({ store, solanaCluster: 'mainnet-beta', requireAuthorized: () => true })(
    'handleOperationsStatus', '/api/ops/receipt-worker');
  assert.equal(unsupported.status, 503);
  assert.equal(reads, 0);
  const allowed = await fixture({ store, requireAuthorized: () => true })('handleOperationsStatus', '/api/ops/receipt-worker');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.responses, 1);
  assert.equal(reads, 1);
});

test('SOL quote routes distinguish unavailable data from an available quote', async () => {
  const unavailable = await fixture()('handleServiceStatus', '/api/market/sol-usd');
  assert.equal(unavailable.status, 503);
  const quote = { usd: 150, provider: 'fixture', observedAt: '2026-10-09T00:00:00Z' };
  const available = await fixture({ readSolUsdQuote: async () => quote })('handleServiceStatus', '/api/market/sol-usd');
  assert.equal(available.status, 200);
  assert.deepEqual(available.data, quote);
  assert.equal(available.responses, 1);
});

test('keeper status advertises a V3 program without a misleading shared router address', async () => {
  const programId = '11111111111111111111111111111111';
  const response = await fixture({ v3RouterConfig: () => ({ programId: { toBase58: () => programId } }) })(
    'handleKeeperStatus', '/api/keeper/status');
  assert.equal(response.status, 200);
  assert.equal(response.data.routerScope, 'per-mint-v3');
  assert.equal(response.data.routerProgramId, programId);
  assert.equal(response.data.routerAddress, null);
  assert.equal(response.data.status, 'waiting-for-deployment-config');
});

test('service-status cache belongs to each server instance and retains network verification', async t => {
  let rpcReads = 0, databaseReads = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    rpcReads++;
    assert.equal(JSON.parse(options.body).method, 'getGenesisHash');
    return { ok: true, json: async () => ({ result: GENESIS_HASHES.devnet }) };
  });
  const store = { health: async () => { databaseReads++; return true; } };
  const first = fixture({ store });
  const second = fixture({ store });
  const report = await first('handleServiceStatus', '/api/status');
  assert.equal(report.data.status, 'operational');
  assert.equal(report.data.settlementVerified, false);
  assert.equal(report.data.mainnetActivationAuthorized, false);
  await first('handleServiceStatus', '/api/status');
  assert.equal(rpcReads, 1);
  await second('handleServiceStatus', '/api/status');
  assert.equal(rpcReads, 2);
  assert.equal(databaseReads, 2);
});
test('status route exposes verified V3 settlement evidence after a finalized proof', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok:true,
    json:async () => ({ result:GENESIS_HASHES.devnet }) }));
  const collections = {one:{scope:'per-mint-v3',cluster:'devnet'},two:{scope:'per-mint-v3',cluster:'devnet'}};
  const report = await fixture({ store:{ health:async () => true,read:async () => ({collections}) },
    env:{FUNDED_V3_SETTLEMENT_ENABLED:'true'},
    readSettlementEvidence:async () => ({ verified:true,
      scope:'all-recorded-v3-collections', recorded:2, checked:2 }) })(
    'handleServiceStatus', '/api/status');
  assert.equal(report.status, 200);
  assert.equal(report.data.settlementVerified, true);
  assert.equal(report.data.settlementEvidence.checked, 2);
  assert.equal(report.data.settlementEvidence.status, 'verified');
  assert.equal(report.data.settlementEvidence.cached, false);
  assert.equal(report.data.mainnetActivationAuthorized, false);
});

test('actual route returns cold pending promptly and invalidates warm proof while basic probes stay cached',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let rpcReads=0,proofReads=0,release;
  t.mock.method(globalThis,'fetch',async()=>{rpcReads++;return{ok:true,json:async()=>({result:GENESIS_HASHES.devnet})};});
  const state={collections:{one:{scope:'per-mint-v3',cluster:'devnet',mint:'mint',signature:'one'}}};
  const slow=new Promise(resolve=>release=resolve);
  const request=fixture({env:{FUNDED_V3_SETTLEMENT_ENABLED:'true',FUNDED_BUILD_ID:'route-build'},
    store:{health:async()=>true,read:async()=>state},
    readSettlementEvidence:async()=>{proofReads++;return slow;}});
  try {
    let settled=false;
    const reports=Promise.all(Array.from({length:20},()=>request('handleServiceStatus','/api/status'))).then(rows=>{settled=true;return rows;});
    await new Promise(resolve=>setImmediate(resolve));
    t.mock.timers.tick(249);await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
    t.mock.timers.tick(1);const responses=await reports;
    assert.equal(proofReads,1);assert.equal(rpcReads,1);
    for(const response of responses){
      assert.equal(response.data.status,'operational');assert.equal(response.data.build,'route-build');
      assert.equal(response.data.settlementVerified,false);assert.equal(response.data.settlementEvidence.status,'pending');
      assert.equal(response.data.settlementEvidence.recorded,1);assert.equal(response.data.settlementEvidence.checked,0);
    }
    release({verified:true,scope:'all-recorded-v3-collections',recorded:1,checked:1});
    await new Promise(resolve=>setImmediate(resolve));
    const verified=await request('handleServiceStatus','/api/status');assert.equal(verified.data.settlementVerified,true);
    state.collections.one.collectedLamports=101;
    const changed=await request('handleServiceStatus','/api/status');
    assert.equal(changed.data.settlementEvidence.cached,false);assert.equal(proofReads,2);assert.equal(rpcReads,1);
  } finally {release({verified:true,scope:'all-recorded-v3-collections',recorded:1,checked:1});}
});

test('actual route completes at 6000ms when storage, RPC and inventory reads stall',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const never=()=>new Promise(()=>{});
  t.mock.method(globalThis,'fetch',never);
  const request=fixture({env:{FUNDED_V3_SETTLEMENT_ENABLED:'true'},
    store:{health:never,read:never}});
  let settled=false;
  const pending=request('handleServiceStatus','/api/status').then(value=>{settled=true;return value;});
  await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(5999);await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  t.mock.timers.tick(1);const response=await pending;
  assert.equal(response.data.status,'degraded');assert(response.data.checks.every(row=>row.status==='unavailable'));
  assert.equal(response.data.settlementVerified,false);assert.equal(response.data.settlementEvidence.recorded,null);
});

test('a wrong network or failed storage probe cannot certify a completed settlement proof',async t=>{
  let genesis;
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({result:genesis})}));
  for(const broken of ['network','storage']){
    genesis=GENESIS_HASHES[broken==='network'?'mainnet-beta':'devnet'];
    const response=await fixture({env:{FUNDED_V3_SETTLEMENT_ENABLED:'true'},
      store:{health:async()=>broken!=='storage',read:async()=>({collections:{a:{scope:'per-mint-v3',cluster:'devnet'}}})},
      readSettlementEvidence:async()=>({verified:true,scope:'all-recorded-v3-collections',recorded:1,checked:1})})(
      'handleServiceStatus','/api/status');
    assert.equal(response.data.status,'degraded');
    assert.equal(response.data.checks[broken==='network'?1:0].status,broken==='network'?'wrong-network':'unavailable');
    assert.equal(response.data.settlementVerified,false);assert.equal(response.data.settlementEvidence.reason,'dependencies-unavailable');
  }
});
