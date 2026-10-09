import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceStatusRoutes } from '../server/routes/service-status.mjs';
import { GENESIS_HASHES } from '../server/service-status.mjs';

function fixture(overrides = {}) {
  const handlers = createServiceStatusRoutes({
    solanaCluster: 'devnet', solanaRpcUrl: 'https://rpc.example.invalid',
    store: {}, automaticRewardStore: { read: async () => ({}) },
    launchPolicyConfig: () => ({}), keeperKeypair: () => null, feeRouterConfig: () => null,
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
