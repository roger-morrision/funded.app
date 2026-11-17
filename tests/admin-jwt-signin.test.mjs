import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { createReferralIdentityRoutes } from '../server/routes/referral-identity.mjs';
import { createAdminJwt, ADMIN_JWT_COOKIE } from '../server/admin-jwt.mjs';

const admin = Keypair.generate().publicKey.toBase58(), user = Keypair.generate().publicKey.toBase58();
const env = { FUNDED_ADMIN_WALLETS: admin, FUNDED_API_TOKEN: 'test-api-token' };

function signIn(wallet) {
  const adminJwt = createAdminJwt({ env, cluster: 'mainnet-beta' });
  const headers = {}, sent = [];
  const routes = createReferralIdentityRoutes({
    body: async () => ({ challengeId: 'c', wallet, signature: 's' }), adminJwt,
    referralAuth: { verify: async () => ({ token: 'session-token', wallet, expiresAt: Date.now() + 3_600_000 }) },
    requestCookieUrl: () => 'https://richpad.fun/', respond: (res, status, body) => sent.push({ status, body }),
  });
  return routes({ method: 'POST', headers: { origin: 'https://richpad.fun' } }, { setHeader: (name, value) => { headers[name] = value; } },
    new URL('https://richpad.fun/api/referrals/session/verify')).then(() => ({ cookies: [].concat(headers['set-cookie']), body: sent.at(-1).body, adminJwt }));
}

test('wallet sign-in sets a verifiable admin JWT cookie only for admin wallets', async () => {
  const signedAdmin = await signIn(admin);
  assert.equal(signedAdmin.body.admin, true);
  const cookie = signedAdmin.cookies.find(value => value.startsWith(`${ADMIN_JWT_COOKIE}=`));
  assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\/api; Max-Age=\d+; Secure/);
  const token = decodeURIComponent(cookie.slice(ADMIN_JWT_COOKIE.length + 1).split(';')[0]);
  assert.equal(signedAdmin.adminJwt.verify(token).wallet, admin);

  const signedUser = await signIn(user);
  assert.equal(signedUser.body.admin, false);
  assert.match(signedUser.cookies.find(value => value.startsWith(`${ADMIN_JWT_COOKIE}=`)), /Max-Age=0/);
});

async function adminStatus(wallet, session) {
  const adminJwt = createAdminJwt({ env, cluster: 'mainnet-beta' });
  const headers = {}, sent = [];
  const routes = createReferralIdentityRoutes({ adminJwt, referralSession: async () => session && { wallet, ...session },
    requestCookieUrl: () => 'https://richpad.fun/', respond: (res, status, body) => sent.push({ status, body }) });
  await routes({ method: 'GET', headers: {} }, { setHeader: (name, value) => { headers[name] = value; } }, new URL('https://richpad.fun/api/auth/admin'));
  return { ...sent.at(-1), cookies: [].concat(headers['set-cookie'] || []), adminJwt };
}

test('a signed-in admin wallet without an admin cookie gets it back, capped to the wallet session', async () => {
  const ends = Date.now() + 600_000;
  const restored = await adminStatus(admin, { expiresAt: ends });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.admin, true);
  assert.equal(restored.body.expiresAt, ends);
  const cookie = restored.cookies.find(value => value.startsWith(`${ADMIN_JWT_COOKIE}=`));
  const maxAge = Number(cookie.match(/Max-Age=(\d+)/)[1]);
  assert.ok(maxAge <= 600 && maxAge > 590);
  assert.equal((await adminStatus(user, { expiresAt: ends })).status, 401, 'other wallets stay non-admin');
  assert.equal((await adminStatus(admin, null)).status, 401, 'no wallet session, no admin cookie');
  assert.equal((await adminStatus(admin, { expiresAt: Date.now() - 1 })).status, 401, 'expired wallet session');
});
