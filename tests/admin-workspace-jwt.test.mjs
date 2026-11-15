import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { createAdminRoutes } from '../server/routes/admin.mjs';
import { createAdminJwt, ADMIN_JWT_COOKIE } from '../server/admin-jwt.mjs';

const admin = Keypair.generate().publicKey.toBase58();
const env = { FUNDED_ADMIN_WALLETS: admin, FUNDED_API_TOKEN: 'test-api-token', PUBLIC_APP_URL: 'https://admin.test' };

function call(handler, cookie) {
  const sent = [];
  const res = { setHeader() {} };
  const req = { method: 'GET', headers: cookie ? { cookie } : {}, socket: { remoteAddress: '127.0.0.1' } };
  return handler(req, Object.assign(res, { sent }), new URL('https://admin.test/api/admin/session')).then(() => sent.at(-1));
}

test('admin page APIs accept only the admin JWT', async () => {
  const adminJwt = createAdminJwt({ env, cluster: 'devnet' });
  const responses = [];
  const handler = createAdminRoutes({ env, adminJwt, store: { read: async () => ({}) }, solanaCluster: 'devnet', solanaRpcUrl: 'http://unused.invalid',
    body: async () => ({}), respond: (res, status, value) => { res.sent.push({ status, value }); responses.push(status); } });
  assert.equal((await call(handler)).status, 401, 'no cookie');
  assert.equal((await call(handler, `funded_admin=${'a'.repeat(64)}`)).status, 401, 'retired session cookie');
  assert.equal((await call(handler, `${ADMIN_JWT_COOKIE}=forged.token.value`)).status, 401, 'forged token');
  const { token } = adminJwt.issue(admin);
  const ok = await call(handler, `${ADMIN_JWT_COOKIE}=${encodeURIComponent(token)}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.value.wallet, admin);
  adminJwt.revoke(token);
  assert.equal((await call(handler, `${ADMIN_JWT_COOKIE}=${encodeURIComponent(token)}`)).status, 401, 'revoked at logout');
});
