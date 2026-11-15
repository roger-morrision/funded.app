import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { createAdminBoostRoute } from '../server/routes/admin-boost.mjs';
import { createAdminJwt, ADMIN_JWT_COOKIE } from '../server/admin-jwt.mjs';
import { activeBoosts } from '../boost-offer.js';

const now = Date.parse('2026-11-15T12:00:00Z');
const mint = Keypair.generate().publicKey.toBase58();
const admin = Keypair.generate(), stranger = Keypair.generate();
const env = { FUNDED_ADMIN_WALLETS: admin.publicKey.toBase58(), CORS_ORIGIN: 'https://richpad.fun', FUNDED_API_TOKEN: 'test-api-token' };

function setup() {
  let state = {};
  const store = { chargeRpcRate: async () => true, read: async () => state,
    update: async fn => { const next = structuredClone(state); const out = fn(next); state = next; return out; } };
  const sent = [];
  const adminJwt = createAdminJwt({ env, cluster: 'mainnet-beta', now: () => now });
  const route = createAdminBoostRoute({ body: async req => req.body, store, solanaCluster: 'mainnet-beta', clientKey: () => 'k',
    respond: (res, status, data) => sent.push({ status, data }), env, mintVerified: async () => true, now: () => now, adminJwt });
  return { route, sent, state: () => state, adminJwt };
}
const url = new URL('https://richpad.fun/api/boosts/admin');
const request = (body, token) => ({ method: 'POST', headers: { origin: 'https://richpad.fun', ...(token ? { cookie: `${ADMIN_JWT_COOKIE}=${token}` } : {}) }, body });

test('a signed-in admin (admin JWT) records a free boost that is active on its network', async () => {
  const { route, sent, state, adminJwt } = setup();
  const { token } = adminJwt.issue(admin.publicKey.toBase58());
  assert.equal(await route(request({ mint, packageId: '10x' }, token), {}, url), true);
  assert.equal(sent[0].status, 201);
  assert.equal(sent[0].data.usd, 0);
  assert.equal(sent[0].data.adminBoost, true);
  assert.equal(sent[0].data.payer, admin.publicKey.toBase58());
  assert.equal(activeBoosts(state().boostReceipts, now + 1000, 'mainnet-beta')[mint].multiplier, 10);
});

test('requests without a valid admin JWT are refused', async () => {
  const { route, sent, adminJwt, state } = setup();
  await route(request({ mint, packageId: '10x', wallet: admin.publicKey.toBase58() }), {}, url);
  assert.equal(sent.at(-1).status, 401);
  await route(request({ mint, packageId: '10x' }, 'not.a.jwt'), {}, url);
  assert.equal(sent.at(-1).status, 401);
  assert.equal(adminJwt.issue(stranger.publicKey.toBase58()), null);
  assert.equal(state().boostReceipts, undefined);
});
