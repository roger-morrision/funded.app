import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Run the actual proxy function with local fakes, without opening sockets or
// contacting Solana. Keep one proxy instance to test its real cache behavior.
const source = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function proxySolanaRpc(req, res) {');
const end = source.indexOf('\nfunction publicState(', start);
assert(start >= 0 && end > start, 'The RPC proxy function must exist.');
const makeProxy = new Function('context', `
  const { fetch, store } = context;
  const body = async req => structuredClone(req.body);
  const rpcMethods = new Set(['getSignaturesForAddress', 'getSlot']);
  const authorized = () => false, clientKey = () => 'fixture', solanaRpcUrl = 'http://unused.invalid';
  const rpcCache = new Map(); let rpcInflight = 0;
  const json = (_res, status, body) => ({ status, body });
  ${source.slice(start, end)}
  return proxySolanaRpc;
`);
const address = '11111111111111111111111111111111';

function fixture() {
  const forwarded = [], charges = [];
  const proxy = makeProxy({
    store: { chargeRpcRate: async (...args) => { charges.push(args); return true; } },
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body);
      forwarded.push(request);
      const limit = request.params[1]?.limit ?? 1000;
      return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: request.id,
        result: request.method === 'getSlot' ? 123 : Array.from({ length: limit }, (_, i) => ({ signature: `fixture-${i}` })) }) };
    },
  });
  return { forwarded, charges, request: (params, id = 1, method = 'getSignaturesForAddress') => proxy({
    url: '/api/solana/rpc', headers: {}, body: { jsonrpc: '2.0', id, method, params },
  }, {}) };
}

test('Omitted signature configuration and limit are explicitly capped at 100 upstream', async () => {
  for (const params of [[address], [address, {}], [address, { commitment: 'finalized' }]]) {
    const api = fixture();
    const response = await api.request(params);
    assert.equal(response.status, 200);
    assert.equal(response.body.result.length, 100);
    assert.equal(api.forwarded[0].params[1].limit, 100);
    assert.equal(api.charges.length, 1);
  }
});

test('Valid signature bounds and navigation/finality options are preserved', async () => {
  for (const limit of [1, 50, 100]) {
    const api = fixture();
    const config = { limit, before: 'before-fixture', until: 'until-fixture', commitment: 'finalized', minContextSlot: 123 };
    const params = [address, config], original = structuredClone(params);
    const response = await api.request(params);
    assert.equal(response.status, 200);
    assert.equal(response.body.result.length, limit);
    assert.deepEqual(api.forwarded[0].params, original);
    assert.deepEqual(params, original);
  }
});

test('Malformed signature limits and configuration are rejected before cache, rate or upstream work', async () => {
  const invalidLimits = [0, -1, 101, 1000, 1.5, Number.MAX_SAFE_INTEGER, null, false, true, '100', 'abc', [], {}];
  const invalidParams = [[], [address, null], [address, []], [address, 100], [address, 'finalized'], [address, {}, {}],
    ...invalidLimits.map(limit => [address, { limit }])];
  for (const params of invalidParams) {
    const api = fixture();
    // Populate a valid cached entry: invalid input must never reuse it.
    await api.request([address]);
    const response = await api.request(params, 2);
    assert.equal(response.status, 400, JSON.stringify(params));
    assert.match(response.body.error, /Signature lookup/);
    assert.equal(api.forwarded.length, 1);
    assert.equal(api.charges.length, 1);
  }
});

test('Default and explicit 100 share cache entries while each caller retains its own JSON-RPC ID', async () => {
  for (const config of [{}, { commitment: 'finalized', before: 'before-fixture', minContextSlot: 123 }]) {
    const api = fixture();
    const first = await api.request([address, config], 'first');
    const second = await api.request([address, { limit: 100, ...config }], 'second');
    assert.equal(api.forwarded.length, 1);
    assert.equal(first.body.id, 'first');
    assert.equal(second.body.id, 'second');
    assert.deepEqual(second.body.result, first.body.result);
    assert.deepEqual(api.charges.map(args => args[1]), [3, 1]);
  }
  const api = fixture();
  await api.request([address], 1);
  const response = await api.request([address, { limit: 100 }], 2);
  assert.equal(api.forwarded.length, 1);
  assert.equal(response.body.id, 2);
});

test('Other RPC methods retain their existing parameter forwarding', async () => {
  const api = fixture();
  const params = [{ commitment: 'finalized' }];
  const response = await api.request(params, 42, 'getSlot');
  assert.equal(response.status, 200);
  assert.equal(response.body.result, 123);
  assert.deepEqual(api.forwarded[0].params, params);
});
