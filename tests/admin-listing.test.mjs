import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { SOLANA_GENESIS } from '../solana-network.js';
import { createAdminListingRoutes } from '../server/routes/admin-listing.mjs';
import { createAdminJwt, ADMIN_JWT_COOKIE } from '../server/admin-jwt.mjs';

const admin = Keypair.generate(), stranger = Keypair.generate();
const mint = Keypair.generate().publicKey.toBase58();
const NOW = Date.parse('2026-11-12T00:00:00Z');
const env = { FUNDED_ADMIN_WALLETS: admin.publicKey.toBase58(), CORS_ORIGIN: 'https://richpad.fun', FUNDED_API_TOKEN: 'test-api-token' };

function harness() {
  let state = {};
  const store = { read: async () => state, update: async fn => fn(state), chargeRpcRate: async () => true,
    readLaunch: async () => null, readMetadata: async () => null };
  const sent = [];
  const adminJwt = createAdminJwt({ env, cluster: 'mainnet-beta', now: () => NOW });
  const handle = createAdminListingRoutes({
    body: async req => req.body, store, solanaCluster: 'mainnet-beta', solanaRpcUrl: 'http://rpc', clientKey: () => 'ip',
    respond: (res, status, body) => sent.push({ status, body }), now: () => NOW, env, adminJwt,
    connectionFactory: () => ({ getGenesisHash: async () => SOLANA_GENESIS['mainnet-beta'] }),
    readListingMint: async () => ({ name: 'Float', symbol: 'FLOAT', source: 'metaplex', address: 'meta', metadataStatus: 'verified', tokenProgram: 'spl-token', decimals: 6 }),
  });
  const cookie = token => (token ? { cookie: `${ADMIN_JWT_COOKIE}=${encodeURIComponent(token)}` } : {});
  const post = async (input, token) => {
    await handle({ method: 'POST', headers: { origin: 'https://richpad.fun', ...cookie(token) }, body: input }, { setHeader() {} }, new URL('https://richpad.fun/api/listings/admin'));
    return sent.at(-1);
  };
  return { post, state: () => state, handle, sent, adminJwt, cookie };
}

test('a signed-in admin (admin JWT) lists an external token without a fee', async () => {
  const h = harness();
  const { token } = h.adminJwt.issue(admin.publicKey.toBase58());
  const result = await h.post({ mint }, token);
  assert.equal(result.status, 201);
  assert.equal(result.body.adminListing, true);
  assert.equal(result.body.usd, 0);
  assert.equal(result.body.wallet, admin.publicKey.toBase58());
  assert.match(result.body.adminSignature, /^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  assert.equal(h.state().listings[mint].onchainVerified, true);
  assert.equal((await h.post({ mint }, token)).status, 409);
});

test('no token, a forged token, or an admin wallet named in the body is refused', async () => {
  const h = harness();
  assert.equal((await h.post({ mint, wallet: admin.publicKey.toBase58() })).status, 401);
  const { token } = h.adminJwt.issue(admin.publicKey.toBase58());
  const [header, payload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  claims.sub = stranger.publicKey.toBase58();
  const forged = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
  assert.equal((await h.post({ mint }, forged)).status, 401);
  assert.equal(h.adminJwt.issue(stranger.publicKey.toBase58()), null);
  assert.equal(h.state().listings, undefined);
});

test('admin status comes from the admin JWT, not the wallet in the query', async () => {
  const h = harness();
  const res = { setHeader() {} };
  await h.handle({ method: 'GET', headers: {} }, res, new URL(`https://richpad.fun/api/listings/admin-status?wallet=${admin.publicKey.toBase58()}`));
  assert.equal(h.sent.at(-1).body.admin, false);
  const { token } = h.adminJwt.issue(admin.publicKey.toBase58());
  await h.handle({ method: 'GET', headers: h.cookie(token) }, res, new URL('https://richpad.fun/api/listings/admin-status'));
  assert.deepEqual(h.sent.at(-1).body, { admin: true, wallet: admin.publicKey.toBase58() });
});
