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
import { metadataStatement, devnetMetadataUri, devnetBannerUri } from '../devnet-metadata.js';
import { canonicalLaunchSocialUrl, normalizeXProfileInput } from '../launch-social-url.js';
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
assert.equal(normalizeXProfileInput('http://x.com/example'), 'https://x.com/example');
assert.equal(normalizeXProfileInput('x.com/example'), 'https://x.com/example');
assert.equal(normalizeXProfileInput('@example'), 'https://x.com/example');
assert.equal(canonicalLaunchSocialUrl(normalizeXProfileInput('http://x.com/example'), 'x'), record.x);
assert.throws(() => canonicalLaunchSocialUrl('http://x.com/example', 'x'), /X link must be a valid HTTPS URL/);
assert.throws(() => canonicalLaunchSocialUrl('https://elsewhere.example/example', 'x'), /X link must be a valid HTTPS URL/);
assert.throws(() => canonicalLaunchSocialUrl('https://user:pass@x.com/example', 'x'), /X link must be a valid HTTPS URL/);
assert.throws(() => canonicalLaunchSocialUrl('http://example.com', 'website'), /Website must be a valid HTTPS URL/);
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
assert.throws(() => parseSignedMetadata({ ...input, x: 'https://elsewhere.example/example' }), /HTTPS/);
assert.throws(() => parseSignedMetadata({ ...input, website: 'https://user:pass@example.com' }), /HTTPS/);
const bannerRecord = { ...record, mint: Keypair.generate().publicKey.toBase58(), bannerSha256: createHash('sha256').update(png).digest('hex') };
const bannerInput = { ...bannerRecord, imageBase64: png.toString('base64'), imageType: 'image/png', bannerBase64: png.toString('base64'), bannerType: 'image/png', signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(metadataStatement(bannerRecord)), creator.secretKey)) };
const preparedBanner = parseSignedMetadata(bannerInput);
assert.equal(preparedBanner.record.bannerSha256, bannerRecord.bannerSha256);
assert.equal(publicMetadata(preparedBanner.record).banner, devnetBannerUri(bannerRecord.mint));
assert.throws(() => parseSignedMetadata({ ...bannerInput, bannerSha256: '0'.repeat(64) }), /Banner checksum/);
assert.throws(() => parseSignedMetadata({ ...bannerInput, bannerBase64: Buffer.from('invalid').toString('base64') }), /Image bytes/);
assert.throws(() => parseSignedMetadata({ ...bannerInput, bannerBase64: '' }), /Banner checksum/);

const directory = await mkdtemp(join(tmpdir(), 'funded-devnet-metadata-'));
try {
  const path = join(directory, 'state.json');
  const store = createStore(path, '');
  await store.writeMetadata(prepared.record, prepared.image, prepared.imageType);
  await store.writeMetadata(preparedBanner.record, preparedBanner.image, preparedBanner.imageType, preparedBanner.banner, preparedBanner.bannerType);
  await store.writeMetadata(prepared.record, prepared.image, prepared.imageType);
  const reopened = createStore(path, '');
  assert.deepEqual(await reopened.readMetadata(mint), prepared.record);
  assert.deepEqual((await reopened.readMetadataImage(mint)).bytes, png);
  assert.deepEqual((await reopened.readMetadataBanner(bannerRecord.mint)).bytes, png);
  assert.equal(await reopened.readMetadataBanner(mint), null);
  await assert.rejects(reopened.writeMetadata({ ...prepared.record, description: 'Changed' }, prepared.image, prepared.imageType), /Immutable/);
  const port = await new Promise((resolve, reject) => { const socket = createServer(); socket.once('error', reject); socket.listen(0, '127.0.0.1', () => { const chosen = socket.address().port; socket.close(() => resolve(chosen)); }); });
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, FUNDED_STORE_PATH: path, DATABASE_URL: '', HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'test', VITE_SOLANA_CLUSTER: 'devnet', FUNDED_SKIP_LOCAL_ENV: 'true', DEVNET_METADATA_ORIGIN: 'https://funded-preview.onrender.com', SOLANA_RPC_URL: 'http://127.0.0.1:9' }, stdio: 'ignore' });
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
    assert.equal(JSON.parse(metadataResponse.body).image, `https://metadata.funded.vip/devnet-images/${mint}`, 'Legacy metadata image origin must remain immutable.');
    const imageResponse = await hostedRequest(port, `/devnet-images/${mint}`);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers['content-type'], 'image/png');
    assert.deepEqual(imageResponse.body, png);
    const bannerResponse = await hostedRequest(port, `/devnet-banners/${bannerRecord.mint}`);
    assert.equal(bannerResponse.status, 200);
    assert.equal(bannerResponse.headers['content-type'], 'image/png');
    assert.deepEqual(bannerResponse.body, png);
    assert.equal((await hostedRequest(port, `/devnet-banners/${mint}`)).status, 404);
    const postMetadata = async data => {
      const response = await fetch(`http://127.0.0.1:${port}/api/devnet-metadata`, { method:'POST', headers:{'content-type':'application/json', Host:'untrusted.example'}, body:JSON.stringify(data) });
      assert.equal(response.status, 201, await response.clone().text());
      return response.json();
    };
    assert.equal((await postMetadata(input)).uri, devnetMetadataUri(mint), 'Legacy repeat uploads must retain the original origin.');
    for (const withImage of [false, true]) {
      const freshRecord = { ...record, mint:Keypair.generate().publicKey.toBase58(), imageSha256:withImage ? record.imageSha256 : '' };
      const freshInput = { ...freshRecord, metadataOrigin:'https://attacker.example', imageBase64:withImage ? input.imageBase64 : '', imageType:withImage ? 'image/png' : '', signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(metadataStatement(freshRecord)), creator.secretKey)) };
      const saved = await postMetadata(freshInput);
      assert.equal(saved.uri, devnetMetadataUri(freshRecord.mint, 'https://funded-preview.onrender.com'));
      assert.equal(saved.image, withImage ? `https://funded-preview.onrender.com/devnet-images/${freshRecord.mint}` : 'https://funded-preview.onrender.com/default.svg');
      assert.deepEqual(await postMetadata(freshInput), saved, 'Idempotent uploads must retain origin and signed data.');
      const publicResponse = await fetch(`http://127.0.0.1:${port}/devnet-metadata/${freshRecord.mint}`);
      assert.equal(publicResponse.status, 200);
      assert.equal((await publicResponse.json()).image, saved.image);
      assert.equal((await reopened.readMetadata(freshRecord.mint)).metadataOrigin, 'https://funded-preview.onrender.com');
    }
    const fallback = await fetch(`http://127.0.0.1:${port}/default.svg`);
    assert.equal(fallback.status, 200, 'Default image must exist on the app host.');
    assert.equal(fallback.headers.get('content-type'), 'image/svg+xml');
    assert.match(await fallback.text(), /^<svg/);
    assert.equal((await hostedRequest(port, '/api/health')).status, 404);
    assert.equal((await hostedRequest(port, '/')).status, 404);
    assert.equal((await hostedRequest(port, '/api/devnet-metadata', 'POST')).status, 404);
  } finally { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
} finally {
  if (directory.startsWith(`${tmpdir()}\\funded-devnet-metadata-`) || directory.startsWith(`${tmpdir()}/funded-devnet-metadata-`)) await rm(directory, { recursive: true, force: true });
}
console.log('Devnet metadata signature, validation, image, and storage checks passed');
