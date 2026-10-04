import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { createStore } from '../server/store.mjs';
import { pgPoolConfig } from '../server/db-config.mjs';

const dockerIgnore = await readFile(resolve('.dockerignore'), 'utf8');
assert.match(dockerIgnore, /^\.secrets\/?$/m, 'Docker builds must exclude local secret files before COPY . .');
const dockerfile = await readFile(resolve('Dockerfile'), 'utf8');
assert.match(dockerfile, /\[ -z "\$VITE_API_BASE_URL" \]/, 'Devnet browser builds must reject an empty API base.');

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
  const result = body.method === 'getAccountInfo' ? { context: { slot: 1 }, value: null } : [];
  res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
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
  const body = JSON.stringify(payload);
  try {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    return { status: response.status, data: await response.json() };
  } catch (cause) {
    throw new Error(`POST ${path} (${Buffer.byteLength(body)} bytes) failed before a complete JSON response.`, { cause });
  }
}
function oversizedHeaders() {
  // A server may reject Content-Length before receiving the upload. Sending a
  // megabyte through fetch races that valid early close against Undici's writes
  // (EPIPE on Node 24). Send the headers first and require the actual HTTP error;
  // streamed overflow without Content-Length is covered by request-body tests.
  return new Promise((resolve, reject) => {
    const req = request(`${base}/api/solana/rpc`, { method:'POST', headers:{ 'content-type':'application/json', 'content-length':'1000001' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('error', reject);
      res.once('end', () => {
        try { resolve({ status:res.statusCode, headers:res.headers, data:JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    req.once('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Oversized headers did not receive an early HTTP response.')));
    req.flushHeaders();
  });
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
  const oversized = await oversizedHeaders();
  assert.equal(oversized.status, 413);
  assert.equal(oversized.data.error, 'Request body too large.');
  assert.match(oversized.data.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(oversized.headers['x-request-id'], oversized.data.requestId);
  assert.equal(oversized.headers.connection, 'close');
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
  assert.equal(rpcCalls, 2, 'Concurrent requests for one mint should share one pool lookup and one curve scan.');
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
