import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { createStore } from '../server/store.mjs';
import { pgPoolConfig } from '../server/db-config.mjs';

const directory = await mkdtemp(join(tmpdir(), 'funded-hardening-'));
const storePath = join(directory, 'store.json');
const port = 18107;
let rpcCalls = 0;
const rpc = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  rpcCalls += 1;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: [] }));
});
await new Promise(resolve => rpc.listen(0, '127.0.0.1', resolve));
const rpcPort = rpc.address().port;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: 'test', PORT: String(port), FUNDED_STORE_PATH: storePath, FUNDED_API_TOKEN: '', SOLANA_RPC_URL: `http://127.0.0.1:${rpcPort}`, VITE_SOLANA_CLUSTER: 'devnet' },
  stdio: 'ignore',
});
const base = `http://127.0.0.1:${port}`;
async function post(path, payload, headers = {}) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  return { status: response.status, data: await response.json() };
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'Backend did not start.');
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(Object.hasOwn(health.external, 'pumpApiUrl'), false, 'Public health must not reveal provider URLs.');
  assert.equal((await post('/api/alerts', { wallet: 'a', mint: 'b' })).status, 401, 'Protected writes must fail closed without a token.');
  assert.equal((await post('/api/solana/rpc', { jsonrpc: '2.0', id: 1, method: 'requestAirdrop', params: [] })).status, 400);
  assert.equal((await post('/api/solana/rpc', { jsonrpc: '2.0', id: 2, method: 'getProgramAccounts', params: [] })).status, 400);
  assert.equal((await post('/api/solana/rpc', { jsonrpc: '2.0', id: 3, method: 'sendTransaction', params: ['x'.repeat(3001)] })).status, 400);
  assert.equal((await post('/api/solana/rpc', { jsonrpc: '2.0', id: 4, method: 'sendTransaction', params: ['x'.repeat(1_000_001)] })).status, 413);
  assert.equal(rpcCalls, 0, 'Rejected RPC requests must not reach the provider.');
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const result = await post('/api/solana/rpc', { jsonrpc: '2.0', id: attempt + 10, method: 'sendTransaction', params: ['AAAA'] });
    assert.equal(result.status, attempt < 10 ? 200 : 429, 'Transaction submission must have a tighter per-client budget.');
  }
  assert.equal(rpcCalls, 10);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await post('/api/solana/rpc', { jsonrpc: '2.0', id: 30 + attempt, method: 'getAccountInfo', params: [`account-${attempt}`] })).status, 200);
  }
  assert.equal((await post('/api/solana/rpc', { jsonrpc: '2.0', id: 40, method: 'getAccountInfo', params: ['ordinary-exhausted'] })).status, 429);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    assert.equal((await post('/api/solana/rpc?purpose=trade-preview', { jsonrpc: '2.0', id: 50 + attempt, method: 'getAccountInfo', params: ['preview-account'] })).status, 200);
  }
  assert.equal((await post('/api/solana/rpc?purpose=trade-preview', { jsonrpc: '2.0', id: 90, method: 'getAccountInfo', params: ['preview-exhausted'] })).status, 429);
  assert.equal((await post('/api/solana/rpc?purpose=trade-preview', { jsonrpc: '2.0', id: 91, method: 'getSlot', params: [] })).status, 429, 'Preview purpose must not bypass the ordinary budget for unrelated methods.');
  rpcCalls = 0;

  const mint = Keypair.generate().publicKey.toBase58();
  const [one, two] = await Promise.all([fetch(`${base}/api/tokens/${mint}/market-activity`), fetch(`${base}/api/tokens/${mint}/market-activity`)]);
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.equal(rpcCalls, 1, 'Concurrent requests for one mint should share one scan.');
  const saved = JSON.parse(await readFile(storePath, 'utf8'));
  assert.equal(saved.marketActivity[`devnet:${mint}`].coverage, 'unavailable');

  const isolated = createStore(join(directory, 'counter.json'), '');
  await Promise.all(Array.from({ length: 20 }, () => isolated.update(state => { state.count = (state.count || 0) + 1; })));
  assert.equal((await isolated.read()).count, 20, 'File-store updates must serialize in one process.');

  const previousSsl = process.env.DATABASE_SSL;
  try {
    process.env.DATABASE_SSL = 'true';
    const config = pgPoolConfig('postgresql://user:pass@localhost:5432/test?sslmode=require');
    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.equal(config.connectionString.includes('sslmode='), false);
  } finally {
    if (previousSsl == null) delete process.env.DATABASE_SSL;
    else process.env.DATABASE_SSL = previousSsl;
  }

  const production = spawnSync(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', FUNDED_STORE_PATH: storePath, FUNDED_API_TOKEN: '' },
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.notEqual(production.status, 0, 'Production must reject file-store fallback.');
  assert.match(production.stderr, /DATABASE_URL is required in production/);
  const missingToken = spawnSync(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', FUNDED_STORE_PATH: '', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', FUNDED_API_TOKEN: '' },
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.notEqual(missingToken.status, 0, 'Production must reject an unset API token.');
  assert.match(missingToken.stderr, /FUNDED_API_TOKEN is required in production/);
  console.log('backend hardening checks passed');
} finally {
  server.kill();
  await new Promise(resolve => rpc.close(resolve));
  const absolute = resolve(directory);
  if (absolute.startsWith(`${resolve(tmpdir())}${sep}`) && basename(absolute).startsWith('funded-hardening-')) {
    await rm(absolute, { recursive: true, force: true });
  }
}
