import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { createAdminJwt, ADMIN_JWT_SECONDS } from '../server/admin-jwt.mjs';

const admin = Keypair.generate().publicKey.toBase58();
const env = { FUNDED_ADMIN_WALLETS: admin, FUNDED_API_TOKEN: 'test-api-token' };

test('admin JWTs verify only for the issuing network and key, before expiry, while the wallet is an admin', () => {
  let clock = Date.parse('2026-11-15T00:00:00Z');
  const jwt = createAdminJwt({ env, cluster: 'mainnet-beta', now: () => clock });
  const issued = jwt.issue(admin);
  assert.equal(jwt.verify(issued.token).wallet, admin);
  assert.equal(createAdminJwt({ env, cluster: 'devnet', now: () => clock }).verify(issued.token), null);
  assert.equal(createAdminJwt({ env: { ...env, FUNDED_API_TOKEN: 'other' }, cluster: 'mainnet-beta', now: () => clock }).verify(issued.token), null);
  assert.equal(createAdminJwt({ env: { ...env, FUNDED_ADMIN_WALLETS: '' }, cluster: 'mainnet-beta', now: () => clock }).verify(issued.token), null);
  const [header, payload, signature] = issued.token.split('.');
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.equal(jwt.verify(`${none}.${payload}.`), null);
  assert.equal(jwt.verify(`${header}.${payload}.${signature.slice(0, -2)}xx`), null);
  clock += ADMIN_JWT_SECONDS * 1000;
  assert.equal(jwt.verify(issued.token), null);
});

test('logout revokes the token on the server', () => {
  const jwt = createAdminJwt({ env, cluster: 'mainnet-beta' });
  const { token } = jwt.issue(admin);
  jwt.revoke(token);
  assert.equal(jwt.verify(token), null);
});

test('a signed-out token stays revoked after a restart, and nothing is accepted before revocations load', async () => {
  let state = {};
  const store = { read: async () => structuredClone(state), update: async fn => { const next = structuredClone(state); const out = fn(next); state = next; return out; } };
  const first = createAdminJwt({ env, cluster: 'mainnet-beta', store });
  await first.ready;
  const kept = first.issue(admin).token, signedOut = first.issue(admin).token;
  await first.revoke(signedOut);
  assert.ok(Object.keys(state.adminJwtRevocations).length === 1);

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const slowStore = { ...store, read: async () => { await gate; return structuredClone(state); } };
  const restarted = createAdminJwt({ env, cluster: 'mainnet-beta', store: slowStore });
  assert.equal(restarted.verify(kept), null, 'refused until revocations load');
  release(); await restarted.ready;
  assert.equal(restarted.verify(kept).wallet, admin);
  assert.equal(restarted.verify(signedOut), null);
});
