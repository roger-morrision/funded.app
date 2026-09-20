import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import pg from 'pg';
import { Keypair } from '@solana/web3.js';
import { metadataStatement, devnetMetadataUri } from '../devnet-metadata.js';

assert.equal(process.env.NODE_ENV, 'production', 'Run this smoke test inside the private Devnet app container.');
assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.ok(process.env.DATABASE_URL?.includes('/funded_app'), 'Refusing to write outside the preview database.');
const mint = Keypair.generate().publicKey.toBase58();
const creator = Keypair.generate();
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lY4AAAAASUVORK5CYII=', 'base64');
const record = { mint, creatorWallet: creator.publicKey.toBase58(), name: 'Metadata smoke test', symbol: 'SMOKE', description: 'Disposable Devnet metadata fixture', tagline: '', roadmap: '', website: '', x: '', telegram: '', discord: '', imageSha256: createHash('sha256').update(image).digest('hex') };
const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(metadataStatement(record)), creator.secretKey));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const upload = await fetch('http://127.0.0.1:8787/api/devnet-metadata', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...record, imageBase64: image.toString('base64'), imageType: 'image/png', signature }) });
  assert.equal(upload.status, 201, `Metadata upload failed: ${upload.status}`);
  assert.equal((await upload.json()).uri, devnetMetadataUri(mint));
  const metadata = await fetch(devnetMetadataUri(mint));
  assert.equal(metadata.status, 200, `Public metadata failed: ${metadata.status}`);
  const published = await metadata.json();
  assert.equal(published.description, record.description);
  const picture = await fetch(published.image);
  assert.equal(picture.status, 200, `Public image failed: ${picture.status}`);
  assert.deepEqual(Buffer.from(await picture.arrayBuffer()), image);
  console.log('Signed upload, PostgreSQL persistence, public metadata, and public image checks passed.');
} finally {
  await pool.query("DELETE FROM devnet_metadata WHERE mint = $1 AND payload->>'name' = 'Metadata smoke test'", [mint]);
  await pool.end();
}
