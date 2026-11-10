import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMetadataUrl, isPrivateAddress, sanitizeOffchainMetadata, createOffchainMetadataReader } from '../server/token-offchain-metadata.mjs';
import { parseVerifiedTokenMetadata, TOKEN_METADATA_PROGRAM_ID } from '../server/token-metadata.mjs';
import { safeImageUrl, metadataLinks } from '../src/features/coin/token-metadata-client.js';
import { PublicKey } from '@solana/web3.js';

test('metadata URIs resolve to public HTTPS only', () => {
  assert.equal(resolveMetadataUrl('ipfs://bafyabc/meta.json'), 'https://ipfs.io/ipfs/bafyabc/meta.json');
  assert.equal(resolveMetadataUrl('ipfs://ipfs/bafyabc'), 'https://ipfs.io/ipfs/bafyabc');
  assert.equal(resolveMetadataUrl('ar://abc123'), 'https://arweave.net/abc123');
  assert.equal(resolveMetadataUrl('http://example.com/a.json'), null);
  assert.equal(resolveMetadataUrl('https://localhost/a.json'), null);
  assert.equal(resolveMetadataUrl('https://user:pw@example.com/a.json'), null);
  assert.equal(resolveMetadataUrl('https://example.com:8443/a.json'), null);
  assert.equal(resolveMetadataUrl('file:///etc/passwd'), null);
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(isPrivateAddress(address), true, address);
  assert.equal(isPrivateAddress('93.184.216.34'), false);
});

test('off-chain JSON is reduced to safe fields', () => {
  const result = sanitizeOffchainMetadata({
    name: 'Coin', symbol: 'CN', description: 'About', image: 'ipfs://bafyimg',
    twitter: '@coin_x', telegram: 'https://t.me/coin', website: 'javascript:alert(1)', extensions: { website: 'https://coin.example' },
  });
  assert.equal(result.image, 'https://ipfs.io/ipfs/bafyimg');
  assert.equal(result.twitter, 'https://x.com/coin_x');
  assert.equal(result.telegram, 'https://t.me/coin');
  assert.equal(result.website, 'https://coin.example/');
  assert.equal(sanitizeOffchainMetadata([]), null);
  assert.equal(sanitizeOffchainMetadata({ properties: { files: [{ type: 'image/png', uri: 'https://cdn.example/x.png' }] } }).image, 'https://cdn.example/x.png');
});

test('reader caches, rejects private IP hosts and reports failures', async () => {
  let calls = 0;
  const read = createOffchainMetadataReader({ getJson: async () => { calls++; return { image: 'https://cdn.example/a.png' }; } });
  assert.equal((await read('https://meta.example/a.json')).metadata.image, 'https://cdn.example/a.png');
  await read('https://meta.example/a.json');
  assert.equal(calls, 1);
  assert.equal((await read('https://10.0.0.5/a.json')).status, 'unavailable');
  assert.equal((await read(null)).status, 'missing');
  assert.equal((await read('http://plain.example')).status, 'unsupported-uri');
  const failing = createOffchainMetadataReader({ getJson: async () => { throw new Error('boom'); } });
  assert.equal((await failing('https://meta.example/b.json')).status, 'unavailable');
});

test('zero-padded empty Metaplex URI is treated as missing', () => {
  const mint = new PublicKey('4WXzLQtaVpa9gftRGQL1znMo66mJdURBP6nojrmWBLTn');
  const field = (text, size) => { const body = Buffer.alloc(size); body.write(text); const len = Buffer.alloc(4); len.writeUInt32LE(size); return Buffer.concat([len, body]); };
  const data = Buffer.concat([Buffer.from([4]), Buffer.alloc(32), mint.toBuffer(), field('External Fee QA', 32), field('EFQA', 10), field('', 200)]);
  assert.deepEqual(parseVerifiedTokenMetadata({ owner: TOKEN_METADATA_PROGRAM_ID, data }, mint), { name: 'External Fee QA', symbol: 'EFQA', uri: null });
});

test('client helpers only pass HTTPS URLs through', () => {
  assert.equal(safeImageUrl('javascript:alert(1)'), null);
  assert.equal(safeImageUrl('https://cdn.example/x.png'), 'https://cdn.example/x.png');
  assert.deepEqual(metadataLinks({ links: { website: 'https://a.example', twitter: 'http://x.com/a', telegram: null } }), [['Website', 'https://a.example/']]);
});
