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
