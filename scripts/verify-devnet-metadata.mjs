import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { metadataStatement, devnetMetadataUri } from '../devnet-metadata.js';
import { parseSignedMetadata, publicMetadata } from '../server/devnet-metadata.mjs';
import { createStore } from '../server/store.mjs';

const creator = Keypair.generate();
const mint = Keypair.generate().publicKey.toBase58();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lY4AAAAASUVORK5CYII=', 'base64');
const record = {
  mint, creatorWallet: creator.publicKey.toBase58(), name: 'Metadata Test', symbol: 'META',
  description: 'Signed description', tagline: 'One line', roadmap: 'Devnet first',
  website: 'https://example.com/', x: 'https://x.com/example', telegram: '', discord: '',
  imageSha256: createHash('sha256').update(png).digest('hex'),
};
const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(metadataStatement(record)), creator.secretKey));
const input = { ...record, imageBase64: png.toString('base64'), imageType: 'image/png', signature };
function hostedRequest(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: { Host: 'metadata.funded.vip', Connection: 'close' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.once('error', reject);
    req.end();
  });
}
const prepared = parseSignedMetadata(input);
assert.equal(prepared.record.description, 'Signed description');
assert.equal(prepared.imageType, 'image/png');
assert.equal(publicMetadata(prepared.record).image, `https://metadata.funded.vip/devnet-images/${mint}`);
assert.equal(publicMetadata(prepared.record).twitter, 'https://x.com/example');
assert.equal(devnetMetadataUri(mint), `https://metadata.funded.vip/devnet-metadata/${mint}`);
assert.throws(() => parseSignedMetadata({ ...input, description: 'Tampered' }), /signature/);
assert.throws(() => parseSignedMetadata({ ...input, imageBase64: Buffer.from('not an image').toString('base64') }), /Image bytes/);
assert.throws(() => parseSignedMetadata({ ...input, x: 'javascript:alert(1)' }), /HTTPS/);
assert.throws(() => parseSignedMetadata({ ...input, website: 'https://user:pass@example.com' }), /HTTPS/);

const directory = await mkdtemp(join(tmpdir(), 'funded-devnet-metadata-'));
try {
  const path = join(directory, 'state.json');
  const store = createStore(path, '');
  await store.writeMetadata(prepared.record, prepared.image, prepared.imageType);
  await store.writeMetadata(prepared.record, prepared.image, prepared.imageType);
  const reopened = createStore(path, '');
  assert.deepEqual(await reopened.readMetadata(mint), prepared.record);
  assert.deepEqual((await reopened.readMetadataImage(mint)).bytes, png);
  await assert.rejects(reopened.writeMetadata({ ...prepared.record, description: 'Changed' }, prepared.image, prepared.imageType), /Immutable/);
  const port = await new Promise((resolve, reject) => { const socket = createServer(); socket.once('error', reject); socket.listen(0, '127.0.0.1', () => { const chosen = socket.address().port; socket.close(() => resolve(chosen)); }); });
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, FUNDED_STORE_PATH: path, DATABASE_URL: '', HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'test', VITE_SOLANA_CLUSTER: 'devnet' }, stdio: 'ignore' });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Metadata test API did not start.');
    const metadataResponse = await hostedRequest(port, `/devnet-metadata/${mint}`);
    assert.equal(metadataResponse.status, 200);
    assert.equal(JSON.parse(metadataResponse.body).description, record.description);
    const imageResponse = await hostedRequest(port, `/devnet-images/${mint}`);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers['content-type'], 'image/png');
    assert.deepEqual(imageResponse.body, png);
    assert.equal((await hostedRequest(port, '/api/health')).status, 404);
    assert.equal((await hostedRequest(port, '/')).status, 404);
    assert.equal((await hostedRequest(port, '/api/devnet-metadata', 'POST')).status, 404);
  } finally { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
} finally {
  if (directory.startsWith(`${tmpdir()}\\funded-devnet-metadata-`) || directory.startsWith(`${tmpdir()}/funded-devnet-metadata-`)) await rm(directory, { recursive: true, force: true });
}
console.log('Devnet metadata signature, validation, image, and storage checks passed');
