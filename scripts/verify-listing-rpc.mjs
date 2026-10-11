import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LISTING_DEVNET_GENESIS_HASH } from '../listing-policy.js';

const directory = await mkdtemp(join(tmpdir(), 'funded-listing-rpc-'));
const providerMethods = [];
const provider = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  providerMethods.push(request.method);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: LISTING_DEVNET_GENESIS_HASH }));
});

let server;
try {
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const portProbe = createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), FUNDED_STORE_PATH: join(directory, 'store.json'),
      FUNDED_API_TOKEN: '', SOLANA_RPC_URL: `http://127.0.0.1:${provider.address().port}`, VITE_SOLANA_CLUSTER: 'devnet' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'Backend did not start.');
  const response = await fetch(`${base}/api/solana/rpc`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] }),
  });
  assert.equal(response.status, 200, 'Listing review must be allowed to verify the Devnet genesis hash.');
  assert.equal((await response.json()).result, LISTING_DEVNET_GENESIS_HASH);
  assert.deepEqual(providerMethods, ['getGenesisHash']);
  console.log('listing RPC checks passed');
} finally {
  server?.kill();
  if (provider.listening) await new Promise(resolve => provider.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
