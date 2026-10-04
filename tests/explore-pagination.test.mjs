import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { explorePagination } from '../server/explore-pagination.mjs';
import { publicError } from '../server/http-policy.mjs';

// Exercise the actual API branches without starting a server or calling providers.
// Token normalization is irrelevant to pagination; fixture rows are already normalized.
const source = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
const start = source.indexOf("    if (req.method === 'GET' && url.pathname === '/api/birdeye/explore') {");
const end = source.indexOf('    const tokenChatSessionAction', start);
assert(start >= 0 && end > start, 'Explore route boundaries must exist.');
const route = new Function('context', `return (async () => {
  const { req, res, url, solanaCluster, store, fetchPump, fetchBirdeye, Connection, explorePagination } = context;
  let devnetVerificationActive = 0;
  const solanaRpcUrl = 'http://unused.invalid', birdeyeChain = 'solana';
  const normalizePumpToken = item => item, normalizeBirdeyeToken = item => item;
  const sortDevnetLaunches = items => items;
  const json = (_res, status, body) => ({ status, body });
  ${source.slice(start, end)}
})();`);
const cases = [
  ['/api/pump/explore', 'devnet'], ['/api/pump/explore', 'mainnet-beta'],
  ['/api/birdeye/explore', 'devnet'], ['/api/birdeye/explore', 'mainnet-beta'],
];

async function request(path, cluster, query = '') {
  const calls = { connections: 0, reads: 0, providers: [] };
  const rows = Array.from({ length: 6 }, (_, index) => ({ mint: `fixture-${index}`, chain: 'solana', cluster: 'devnet', onchainVerified: true }));
  const context = {
    req: { method: 'GET' }, res: {}, url: new URL(path + query, 'http://fixture.invalid'), solanaCluster: cluster, explorePagination,
    Connection: class { constructor() { calls.connections++; } },
    store: {
      readLaunches: async () => { calls.reads++; return rows; },
      read: async () => { calls.reads++; return { listings: {} }; },
    },
    fetchPump: async (endpoint, params) => { calls.providers.push({ endpoint, params }); return rows; },
    fetchBirdeye: async (endpoint, params) => { calls.providers.push({ endpoint, params }); return { configured: true, data: { items: rows } }; },
  };
  let response;
  try { response = await route(context); }
  catch (error) { response = publicError(error, 'pagination-fixture-request'); }
  return { ...response, calls };
}

test('Explore defaults remain 40 rows from offset zero and Devnet Birdeye remains unavailable', async () => {
  for (const [path, cluster] of cases) {
    const result = await request(path, cluster);
    const disabled = cluster === 'devnet' && path.includes('birdeye');
    assert.equal(result.status, disabled ? 503 : 200);
    if (disabled) assert.deepEqual(result.calls, { connections: 0, reads: 0, providers: [] });
    else if (cluster === 'devnet') assert.equal(result.body.items.length, 6);
    else assert.deepEqual([result.calls.providers[0].params.limit, result.calls.providers[0].params.offset], ['40', '0']);
  }
});

test('Valid Explore pagination selects the requested Devnet page and forwards canonical provider integers', async () => {
  for (const [path, cluster] of cases.filter(([path, cluster]) => cluster !== 'devnet' || path.includes('pump'))) {
    const result = await request(path, cluster, '?limit=002&offset=01');
    assert.equal(result.status, 200);
    if (cluster === 'devnet') assert.deepEqual(result.body.items.map(row => row.mint), ['fixture-1', 'fixture-2']);
    else assert.deepEqual([result.calls.providers[0].params.limit, result.calls.providers[0].params.offset], ['2', '1']);
  }
});

test('Explore preserves zero-limit clamping and caps valid safe integers', async () => {
  for (const path of ['/api/pump/explore', '/api/birdeye/explore']) {
    for (const [query, expected] of [
      ['?limit=0&offset=0', ['1', '0']],
      ['?limit=101&offset=10001', ['100', '10000']],
      ['?limit=9007199254740991&offset=9007199254740991', ['100', '10000']],
    ]) {
      const result = await request(path, 'mainnet-beta', query);
      assert.equal(result.status, 200);
      assert.deepEqual([result.calls.providers[0].params.limit, result.calls.providers[0].params.offset], expected);
    }
  }
  const result = await request('/api/pump/explore', 'devnet', '?limit=0');
  assert.equal(result.body.items.length, 1);
});

test('Malformed or ambiguous Explore pagination returns actionable 400 before storage, connection or provider work', async () => {
  const invalid = ['', 'garbage', 'NaN', 'Infinity', '-1', '+1', ' 1', '1 ', '1.5', '1e2', '0x10', '9007199254740992', '9'.repeat(400)];
  for (const [path, cluster] of cases) {
    for (const name of ['limit', 'offset']) {
      const queries = invalid.map(value => `?${new URLSearchParams({ [name]: value })}`);
      queries.push(`?${name}=1&${name}=2`, `?${name}=1&${name}=1`);
      for (const query of queries) {
        const result = await request(path, cluster, query);
        assert.equal(result.status, 400, `${path} (${cluster}) ${query}`);
        assert.match(result.body.error, new RegExp(`^${name} must be supplied once`));
        assert.equal(result.body.requestId, 'pagination-fixture-request');
        assert.deepEqual(result.calls, { connections: 0, reads: 0, providers: [] });
      }
    }
  }
});
