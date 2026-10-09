import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPageDelivery } from '../server/page-delivery.mjs';

const mint = '11111111111111111111111111111111';
const template = '<html><head><title>App</title><meta name="description" content="App"></head><body>Fixture</body></html>';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'funded-pages-'));
  const staticRoot = join(root, 'dist');
  await mkdir(join(staticRoot, 'assets'), { recursive: true });
  await writeFile(join(staticRoot, 'index.html'), template);
  await writeFile(join(staticRoot, 'assets/app-12345678.js'), 'console.log("fixture")');
  await writeFile(join(root, 'outside.txt'), 'Must never be served');
  const records = { launch: null, metadata: null, image: null, creatorReads: [] };
  const delivery = createPageDelivery({ staticRoot, solanaCluster: 'devnet',
    feeRouterConfig: () => ({ address: { toBase58: () => 'router' } }),
    store: { readLaunch: async () => records.launch, readMetadata: async () => records.metadata,
      readMetadataImage: async () => records.image,
      readCreatorState: async (...args) => { records.creatorReads.push(args); return {}; } },
    respond: (res, status, data) => { res.writeHead(status, {}); res.end(JSON.stringify(data)); },
  });
  async function request(path, { method = 'GET', publicMetadata = false, metadataHost = false, rawPath = false } = {}) {
    const response = { status: null, headers: {}, content: null, endCount: 0,
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(content) { this.content = content; this.endCount++; } };
    const url = rawPath ? { pathname: path } : new URL(path, 'https://funded.vip');
    response.handled = await (publicMetadata ? delivery.handlePublicMetadata : delivery.handlePages)({ method }, response, url, metadataHost);
    return response;
  }
  try { await run({ request, records }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('page delivery preserves app fallbacks and immutable caching only for hashed assets', () => fixture(async ({ request }) => {
  for (const path of ['/', '/explore', `/wallet/${mint}`]) {
    const response = await request(path);
    assert.equal(response.handled, true);
    assert.equal(response.status, 200);
    assert.equal(String(response.content), template);
    assert.equal(response.headers['cache-control'], 'no-cache');
    assert.equal(response.endCount, 1);
  }
  const asset = await request('/assets/app-12345678.js');
  assert.equal(asset.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(asset.headers['x-content-type-options'], 'nosniff');
}));

test('missing files, directories and traversal do not expose files outside the static root', () => fixture(async ({ request }) => {
  for (const path of ['/missing.js', '/assets', '/../outside.txt', '/..\\outside.txt']) {
    const response = await request(path, { rawPath: true });
    assert.equal(response.status, 404, path);
    assert.equal(response.handled, true);
    assert.equal(response.endCount, 1);
    assert.doesNotMatch(String(response.content), /Must never be served/);
  }
}));

test('unmatched API paths and POST requests fall through without writing a response', () => fixture(async ({ request }) => {
  for (const options of [{}, { publicMetadata: true }]) {
    assert.equal((await request('/api/unknown', options)).handled, false);
    const response = await request(`/token/${mint}`, { ...options, method: 'POST' });
    assert.equal(response.handled, false);
    assert.equal(response.endCount, 0);
  }
}));

test('public metadata handles default artwork, images and metadata-host misses exactly once', () => fixture(async ({ request, records }) => {
  const artwork = await request('/default.svg', { publicMetadata: true });
  assert.equal(artwork.headers['content-security-policy'], "default-src 'none'");
  assert.equal(artwork.endCount, 1);
  assert.equal(artwork.handled, true);
  assert.equal((await request(`/devnet-images/${mint}`, { publicMetadata: true })).status, 404);
  records.image = { mime: 'image/png', bytes: Buffer.from('fixture') };
  const image = await request(`/devnet-images/${mint}`, { publicMetadata: true });
  assert.equal(image.content, records.image.bytes);
  assert.equal(image.headers['content-length'], records.image.bytes.length);
  assert.equal(image.headers['access-control-allow-origin'], '*');
  const missing = await request(`/devnet-metadata/${mint}`, { publicMetadata: true, metadataHost: true });
  assert.equal(missing.status, 404);
  assert.equal(missing.handled, true);
  assert.equal((await request(`/devnet-metadata/${mint}`, { publicMetadata: true })).handled, false);
}));

test('prepared metadata takes precedence and launch metadata fallback requires a verified router', () => fixture(async ({ request, records }) => {
  records.metadata = { mint, name: 'Prepared coin', symbol: 'PREP', metadataOrigin: 'https://metadata.funded.vip' };
  const prepared = await request(`/devnet-metadata/${mint}`, { publicMetadata: true });
  assert.equal(JSON.parse(prepared.content).name, 'Prepared coin');
  assert.equal(prepared.handled, true);
  assert.equal((await request(`/devnet-metadata/${mint}`)).status, 404);
  records.launch = { mint, name: 'Coin', symbol: 'COIN', cluster: 'devnet', creator: 'other', onchainVerified: true };
  assert.equal((await request(`/devnet-metadata/${mint}`)).status, 404);
  records.launch.creator = 'router';
  assert.equal((await request(`/devnet-metadata/${mint}`)).status, 200);
  records.launch.onchainVerified = false;
  assert.equal((await request(`/devnet-metadata/${mint}`)).status, 404);
}));

test('social pages retain verification labels, escaping, no-store headers and nonfinancial creator reads', () => fixture(async ({ request, records }) => {
  const unverified = await request(`/token/${mint}`);
  assert.match(unverified.content, /noindex/);
  assert.equal(unverified.headers['cache-control'], 'no-store');
  records.launch = { mint, name: '<Coin>', symbol: 'COIN', cluster: 'devnet', onchainVerified: true, policySignature: 'fixture' };
  const verified = await request(`/launch/coin/${mint}`);
  assert.match(verified.content, /&lt;Coin&gt;/);
  assert.doesNotMatch(verified.content, /<Coin>/);
  assert.equal(verified.handled, true);
  assert.equal(verified.endCount, 1);
  const creator = await request('/creator/x/123');
  assert.equal(creator.headers['cache-control'], 'no-store');
  assert.deepEqual(records.creatorReads, [['123', 'devnet', { financial: false }]]);
  assert.match(creator.content, /noindex/);
}));
