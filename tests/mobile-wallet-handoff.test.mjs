import test from 'node:test';
import assert from 'node:assert/strict';
import { createMobileWalletRelay } from '../server/mobile-wallet-relay.mjs';

const origin = 'https://richpad.fun';
const hex = (char, length) => char.repeat(length);
const wallet = '11111111111111111111111111111111';

function call(relay, method, path, { body, headers = {} } = {}) {
  const res = { status: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name] = value; }, writeHead(status, extra = {}) { this.status = status; Object.assign(this.headers, extra); }, end(chunk = '') { this.body = String(chunk); } };
  const req = { method, headers: { origin, ...headers } };
  return relay.handle(req, res, new URL(origin + path), async () => body).then(() => ({ ...res, json: () => JSON.parse(res.body) }));
}

test('a connect approval hands its first sign-in to the phone page, no second scan', async () => {
  const relay = createMobileWalletRelay({ appOrigin: origin });
  const connect = hex('a', 48), connectToken = hex('1', 64), sign = hex('b', 48), signToken = hex('2', 64);
  assert.equal((await call(relay, 'POST', '/api/mobile-wallet/relay', { body: { id: connect, pollToken: connectToken } })).status, 201);
  // Before Phantom approves, nothing can be handed off and the phone page waits.
  assert.equal((await call(relay, 'GET', `/api/mobile-wallet/next/${connect}`)).json().status, 'pending');
  const approved = await call(relay, 'GET', `/api/mobile-wallet/callback/${connect}?data=abc&nonce=def&phantom_encryption_public_key=ghi`);
  assert.equal(approved.status, 200);
  assert.match(approved.body, /Wallet connected/);
  assert.match(approved.headers['content-security-policy'], /script-src 'nonce-/);
  assert.equal((await call(relay, 'POST', '/api/mobile-wallet/relay', { body: { id: sign, pollToken: signToken, signRequest: { message: 'richpad.fun sign-in', publicKey: wallet } } })).status, 201);
  // The hand-off needs the connect flow's poll token and the app origin.
  assert.equal((await call(relay, 'POST', `/api/mobile-wallet/next/${connect}`, { body: { next: sign }, headers: { 'x-mobile-wallet-token': signToken } })).status, 404);
  assert.equal((await call(relay, 'POST', `/api/mobile-wallet/next/${connect}`, { body: { next: sign }, headers: { origin: 'https://evil.example', 'x-mobile-wallet-token': connectToken } })).status, 404);
  assert.equal((await call(relay, 'POST', `/api/mobile-wallet/next/${connect}`, { body: { next: hex('c', 48) }, headers: { 'x-mobile-wallet-token': connectToken } })).status, 400);
  assert.equal((await call(relay, 'POST', `/api/mobile-wallet/next/${connect}`, { body: { next: sign }, headers: { 'x-mobile-wallet-token': connectToken } })).status, 200);
  // Only once.
  assert.equal((await call(relay, 'POST', `/api/mobile-wallet/next/${connect}`, { body: { next: sign }, headers: { 'x-mobile-wallet-token': connectToken } })).status, 404);
  const ready = (await call(relay, 'GET', `/api/mobile-wallet/next/${connect}`)).json();
  assert.equal(ready.status, 'ready');
  assert.equal(ready.openUrl, `https://phantom.app/ul/browse/${encodeURIComponent(`${origin}/api/mobile-wallet/sign/${sign}`)}?ref=${encodeURIComponent(origin)}`);
});

test('sign and transaction flows never expose a hand-off', async () => {
  const relay = createMobileWalletRelay({ appOrigin: origin });
  const sign = hex('d', 48);
  await call(relay, 'POST', '/api/mobile-wallet/relay', { body: { id: sign, pollToken: hex('3', 64), signRequest: { message: 'm', publicKey: wallet } } });
  assert.equal((await call(relay, 'GET', `/api/mobile-wallet/next/${sign}`)).status, 404);
  assert.equal((await call(relay, 'POST', `/api/mobile-wallet/next/${sign}`, { body: { next: sign }, headers: { 'x-mobile-wallet-token': hex('3', 64) } })).status, 404);
});
