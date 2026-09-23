import { createHash, randomBytes } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const SESSION_SECONDS = 86400;
export const OAUTH_SECONDS = 600;

export function cookieValue(req, name) {
  const matches = String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (matches.length !== 1) return '';
  try { return decodeURIComponent(matches[0].slice(name.length + 1)); } catch { return ''; }
}
export function authCookie(name, value, seconds, callbackUrl) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${new URL(callbackUrl).protocol === 'https:' ? '; Secure' : ''}`;
}
export function allowedAuthOrigin(req, configuredOrigin) {
  const origin = String(req.headers.origin || '');
  if (!origin || origin === 'null') return false;
  if (configuredOrigin && configuredOrigin !== '*') return origin === configuredOrigin;
  return origin === `${req.socket?.encrypted ? 'https' : 'http'}://${req.headers.host}`;
}
export function callbackUrlFor(req, configured, production = false) {
  const url = new URL(configured || `http://${req.headers.host || '127.0.0.1:8787'}/api/x/oauth/callback`);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/api/x/oauth/callback'
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && !production))
    || (!configured && (!local || production))) throw new Error('Configure an exact HTTPS X_CALLBACK_URL before sign-in.');
  return url.href;
}

export function createXAuth(store) {
  return {
    async start(callbackUrl) {
      const state = opaque(), binding = opaque(), verifier = randomBytes(48).toString('base64url');
      await store.authPut('oauth', digest(`${state}:${binding}`), { verifier, callbackUrl }, Date.now() + OAUTH_SECONDS * 1000);
      return { state, binding, challenge: createHash('sha256').update(verifier).digest('base64url') };
    },
    async consume(state, binding) {
      if (!validToken(state) || !validToken(binding)) return null;
      return store.authTake('oauth', digest(`${state}:${binding}`));
    },
    async issue(user) {
      if (!/^\d{1,24}$/.test(String(user?.id || '')) || !/^[A-Za-z0-9_]{1,15}$/.test(user?.username || '')) throw new Error('Invalid verified X identity.');
      const token = opaque();
      const session = { user: { id: String(user.id), username: user.username, name: String(user.name || user.username).slice(0,80) },
        creatorCsrf: randomBytes(24).toString('hex'), createdAt: Date.now() };
      await store.authPut('session', digest(token), session, Date.now() + SESSION_SECONDS * 1000);
      return token;
    },
    async session(token) { return validToken(token) ? store.authRead('session', digest(token)) : null; },
    async revoke(token) { if (validToken(token)) await store.authDelete('session', digest(token)); },
  };
}
