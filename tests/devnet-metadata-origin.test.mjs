import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeDevnetMetadataOrigin, devnetMetadataUri, devnetImageUri, devnetBannerUri, isDevnetImageUri, isDevnetBannerUri, metadataStatement } from '../devnet-metadata.js';
import { metadataRecordOrigin, publicMetadata } from '../server/devnet-metadata.mjs';
import { createStore } from '../server/store.mjs';

const mint = '11111111111111111111111111111111';
const origin = 'https://preview.onrender.com';
test('metadata origin accepts only HTTPS origins or explicit loopback HTTP', () => {
  for (const value of [origin, `${origin}/`, 'HTTPS://PREVIEW.ONRENDER.COM']) assert.equal(normalizeDevnetMetadataOrigin(value), origin);
  for (const value of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787']) assert.equal(normalizeDevnetMetadataOrigin(value), value);
  for (const value of ['', 'http://preview.onrender.com', '//preview.onrender.com', 'javascript:alert(1)', 'https://user:pass@preview.onrender.com', `${origin}/path`, `${origin}/../`, `${origin}?redirect=x`, `${origin}#fragment`, `${origin}\\evil`, 'data:text/html,test']) assert.throws(() => normalizeDevnetMetadataOrigin(value), /metadata origin/);
  assert.equal(devnetMetadataUri(mint, origin), `${origin}/devnet-metadata/${mint}`);
  assert.equal(devnetImageUri(mint, origin), `${origin}/devnet-images/${mint}`);
  assert.equal(isDevnetImageUri(`https://attacker.example/devnet-images/${mint}`, mint), false);
  assert.equal(devnetBannerUri(mint, origin), `${origin}/devnet-banners/${mint}`);
  assert.equal(isDevnetBannerUri(`https://attacker.example/devnet-banners/${mint}`, mint), false);
});
test('public metadata resolves new and legacy record origins independently of current config', () => {
  const record = { mint, name:'Token', symbol:'TKN', metadataOrigin:origin };
  assert.equal(publicMetadata(record).image, `${origin}/default.svg`);
  assert.equal(publicMetadata({ ...record, imageSha256:'hash' }).image, `${origin}/devnet-images/${mint}`);
  assert.equal(publicMetadata({ ...record, bannerSha256:'hash' }).banner, `${origin}/devnet-banners/${mint}`);
  assert.equal(metadataRecordOrigin({ mint }), 'https://metadata.funded.vip');
  assert.equal(publicMetadata({ mint }).image, 'https://metadata.funded.vip/default.svg');
  assert.equal(metadataStatement(record), metadataStatement({ ...record, metadataOrigin:'https://new.example' }), 'Origin is server-owned and must not change the wallet signature contract.');
  assert.match(metadataStatement({ ...record, bannerSha256:'hash' }), /metadata v2/);
});
test('file metadata preserves first origin through deployment changes and rejects changed signed data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'funded-origin-'));
  try {
    const store = createStore(join(directory, 'state.json'), '');
    const first = { mint, name:'Token', symbol:'TKN', metadataOrigin:origin };
    await store.writeMetadata(first, null, null);
    assert.deepEqual(await store.writeMetadata({ ...first, metadataOrigin:'https://replacement.example' }, null, null), first);
    await assert.rejects(store.writeMetadata({ ...first, name:'Changed' }, null, null), /Immutable/);
    assert.deepEqual(await store.readMetadata(mint), first);
  } finally { await rm(directory, { recursive:true, force:true }); }
});
test('browser build consumes configured metadata origin while allowing only current and historical image hosts', async () => {
  const { build } = await import('vite');
  const { fileURLToPath } = await import('node:url');
  const result = await build({ configFile:false, envFile:false, logLevel:'silent',
    define:{ 'import.meta.env.VITE_DEVNET_METADATA_ORIGIN':JSON.stringify(origin) },
    build:{ write:false, minify:false, lib:{ entry:fileURLToPath(new URL('../devnet-metadata.js', import.meta.url)), formats:['es'] } },
  });
  const output = result[0].output.find(item => item.type === 'chunk').code;
  const browser = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
  assert.equal(browser.devnetMetadataUri(mint), `${origin}/devnet-metadata/${mint}`);
  assert.equal(browser.isDevnetImageUri(`${origin}/devnet-images/${mint}`, mint), true);
  assert.equal(browser.isDevnetImageUri(`https://metadata.funded.vip/devnet-images/${mint}`, mint), true);
  assert.equal(browser.isDevnetImageUri(`https://attacker.example/devnet-images/${mint}`, mint), false);
  assert.equal(browser.isDevnetBannerUri(`${origin}/devnet-banners/${mint}`, mint), true);
  assert.equal(browser.isDevnetBannerUri(`https://attacker.example/devnet-banners/${mint}`, mint), false);
});
