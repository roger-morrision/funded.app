import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

// Admin authentication for every network. A wallet that signs in through the
// normal wallet sign-in and is listed in FUNDED_ADMIN_WALLETS also receives an
// HttpOnly cookie holding a signed JWT (HS256). Admin APIs trust only this
// token, checked on the server: signature, expiry, issuer, network, role, and
// that the wallet is still configured as an administrator.
export const ADMIN_JWT_COOKIE = 'richpad_admin';
export const ADMIN_JWT_SECONDS = 60 * 60; // matches the wallet sign-in session
const ISSUER = 'richpad.fun';

const b64url = value => Buffer.from(value).toString('base64url');
const fromB64url = value => Buffer.from(String(value), 'base64url');
const validWallet = value => { try { return new PublicKey(String(value)).toBase58(); } catch { return null; } };

// Signing key: FUNDED_ADMIN_JWT_SECRET when set (at least 32 characters), else
// derived from the server's existing FUNDED_API_TOKEN so production needs no
// extra secret. Local development without either uses a per-process key.
export function adminJwtKey(env = process.env) {
  const dedicated = String(env.FUNDED_ADMIN_JWT_SECRET || '').trim();
  if (dedicated.length >= 32) return Buffer.from(dedicated);
  const apiToken = String(env.FUNDED_API_TOKEN || '').trim();
  if (apiToken) return createHmac('sha256', apiToken).update('richpad-admin-jwt-v1').digest();
  return null;
}

export function createAdminJwt({ env = process.env, cluster, now = Date.now } = {}) {
  const fallbackKey = randomBytes(32);
  const key = () => adminJwtKey(env) || fallbackKey;
  const revoked = new Map();
  const admins = () => new Set(String(env.FUNDED_ADMIN_WALLETS || '').split(',').map(value => validWallet(value.trim())).filter(Boolean));
  const sign = (header, payload) => {
    const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    return `${body}.${createHmac('sha256', key()).update(body).digest('base64url')}`;
  };
  function isAdmin(wallet) { return Boolean(validWallet(wallet) && admins().has(validWallet(wallet))); }
  function issue(wallet) {
    const sub = validWallet(wallet);
    if (!sub || !admins().has(sub)) return null;
    const iat = Math.floor(now() / 1000), exp = iat + ADMIN_JWT_SECONDS;
    const jti = randomBytes(16).toString('hex');
    return { token: sign({ alg: 'HS256', typ: 'JWT' }, { iss: ISSUER, aud: cluster, sub, role: 'admin', iat, exp, jti }), wallet: sub, expiresAt: exp * 1000, jti };
  }
  function verify(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    try {
      const header = JSON.parse(fromB64url(parts[0]).toString('utf8'));
      if (header?.alg !== 'HS256' || header?.typ !== 'JWT') return null;
      const expected = createHmac('sha256', key()).update(`${parts[0]}.${parts[1]}`).digest();
      const actual = fromB64url(parts[2]);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      const claims = JSON.parse(fromB64url(parts[1]).toString('utf8'));
      const seconds = Math.floor(now() / 1000);
      if (claims?.iss !== ISSUER || claims?.aud !== cluster || claims?.role !== 'admin') return null;
      if (!Number.isSafeInteger(claims.exp) || claims.exp <= seconds || !Number.isSafeInteger(claims.iat) || claims.iat > seconds + 60) return null;
      if (!/^[a-f0-9]{32}$/.test(String(claims.jti || '')) || revoked.has(claims.jti)) return null;
      if (!admins().has(validWallet(claims.sub))) return null;
      return { wallet: claims.sub, jti: claims.jti, expiresAt: claims.exp * 1000 };
    } catch { return null; }
  }
  const cookieValue = req => String(req.headers?.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(`${ADMIN_JWT_COOKIE}=`))?.slice(ADMIN_JWT_COOKIE.length + 1) || '';
  // The verified admin behind a request, or null.
  function read(req) { return verify(decodeURIComponent(cookieValue(req))); }
  function revoke(token) {
    const claims = verify(token);
    if (!claims) return;
    revoked.set(claims.jti, claims.expiresAt);
    for (const [jti, until] of revoked) if (until <= now()) revoked.delete(jti);
  }
  function revokeRequest(req) { revoke(decodeURIComponent(cookieValue(req))); }
  // Path=/api so every admin API receives it; SameSite=Strict blocks cross-site use.
  function cookie(value, seconds, secure) {
    return `${ADMIN_JWT_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
  }
  return { issue, verify, read, revoke, revokeRequest, cookie, isAdmin };
}
