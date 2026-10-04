// Actual HTTP and PostgreSQL acceptance against explicitly selected disposable
// loopback containers. This script signs authentication messages, never Solana
// transactions. It writes then deletes one chat message under a random mint.
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

function localOrigin(value) {
  assert.ok(value, 'Set FUNDED_CONTAINER_BASE to a disposable local container origin.');
  const url = new URL(value);
  assert.ok(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
  'Container acceptance may only target an explicit loopback origin without credentials.');
  return url.origin;
}
const base = localOrigin(process.env.FUNDED_CONTAINER_BASE);
const replica = localOrigin(process.env.FUNDED_CONTAINER_REPLICA || base);
const expectedBuild = process.env.FUNDED_EXPECT_BUILD || 'local-container-verification';
const checks = [];
async function request(path, { at = base, body, headers = {}, method = body === undefined ? 'GET' : 'POST' } = {}) {
  const response = await fetch(new URL(path, at), { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, headers: response.headers, data };
}
const capabilities = await request('/api/capabilities');
assert.equal(capabilities.status, 200); assert.equal(capabilities.data.cluster, 'devnet');
assert.equal(capabilities.data.build, expectedBuild);
assert.equal(capabilities.data.sessions.storage, 'postgresql');
assert.equal(capabilities.data.creatorDirectory.storage, 'postgresql-projection');
checks.push('production API identifies Devnet, expected build and PostgreSQL storage');
const health = await request('/api/health'); assert.equal(health.status, 200); assert.equal(health.data.ok, true);
assert.equal(health.data.external.solanaKeeper, false, 'Disposable acceptance must not load a signing keeper.');
assert.equal(health.headers.get('cache-control'), 'no-store');
assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
assert.match(health.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
const status = await request('/api/status'); assert.equal(status.status, 200);
assert.equal(status.data.cluster, 'devnet'); assert.equal(status.data.build, expectedBuild);
assert.equal(status.data.checks.find(check => check.id === 'storage')?.status, 'operational');
assert.equal(status.data.settlementVerified, false); assert.equal(status.data.mainnetActivationAuthorized, false);
checks.push('real database health and network status remain distinct from settlement authorization');
assert.equal((await request('/api/ops/receipt-worker')).status, 401);
assert.equal((await request('/api/alerts', { body: { wallet: 'unsigned', mint: 'unsigned' } })).status, 401);
checks.push('anonymous privileged reads and writes fail closed');

const home = await request('/'); assert.equal(home.status, 200); assert.equal(home.headers.get('cache-control'), 'no-cache');
const asset = home.data.match(/(?:src|href)="(\/assets\/[^"?#]+\.js)"/)?.[1]; assert.ok(asset);
const bundle = await request(asset); assert.equal(bundle.status, 200); assert.match(bundle.headers.get('cache-control'), /immutable/);
for (const path of ['/explore', '/launch/coin/11111111111111111111111111111111', '/token/11111111111111111111111111111111', '/wallet/11111111111111111111111111111111']) {
  const response = await request(path); assert.equal(response.status, 200, `Deep route ${path}`); assert.match(response.headers.get('content-type'), /text\/html/);
}
const settings = await request('/build-settings.json'); assert.equal(settings.status, 200);
const browserSettings = typeof settings.data === 'string' ? JSON.parse(settings.data) : settings.data;
assert.equal(browserSettings.cluster, 'devnet'); assert.equal(browserSettings.mainnetEnabled, false); assert.equal(browserSettings.devWalletEnabled, false);
checks.push('built assets, safe browser settings, cache policies and deep links are served by the real container');

const wallet = Keypair.generate(); const wrongWallet = Keypair.generate(); const mint = Keypair.generate().publicKey.toBase58();
const author = wallet.publicKey.toBase58(); const origin = { origin: base };
assert.equal((await request('/api/token-chat/session/prepare', { headers: { origin: 'https://wrong-origin.example' }, body: { address: author } })).status, 403);
const forged = await request('/api/token-chat/session/prepare', { headers: origin, body: { address: author } }); assert.equal(forged.status, 200);
const wrongSignature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(forged.data.statement), wrongWallet.secretKey));
assert.equal((await request('/api/token-chat/session/verify', { headers: origin, body: { challengeId: forged.data.challengeId, signature: wrongSignature } })).status, 401);
const challenge = await request('/api/token-chat/session/prepare', { headers: origin, body: { address: author } }); assert.equal(challenge.status, 200);
const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.data.statement), wallet.secretKey));
const approvals = await Promise.all([base, replica].map(at => request('/api/token-chat/session/verify', { at, headers: origin, body: { challengeId: challenge.data.challengeId, signature } })));
assert.deepEqual(approvals.map(result => result.status).sort(), [200, 401], 'Concurrent verification must consume one database challenge exactly once.');
const session = approvals.find(result => result.status === 200).data;
const sessionHeaders = { ...origin, 'x-token-chat-session': session.token };
const path = `/api/tokens/${mint}/chat`;
let messageId;
try {
  const posted = await request(path, { at: replica, headers: sessionHeaders, body: { author, text: 'Disposable container acceptance message.' } });
  assert.equal(posted.status, 201); messageId = posted.data.message.id;
  const feed = await request(path); assert.equal(feed.status, 200);
  assert.equal(feed.data.messages.find(message => message.id === messageId)?.author, author);
  assert.equal((await request(path, { headers: sessionHeaders, body: { author: wrongWallet.publicKey.toBase58(), text: 'Impersonation must fail.' } })).status, 401);
  checks.push(replica === base ? 'real PostgreSQL single-use approval, authenticated post/read and wrong-wallet rejection' : 'two real replicas share PostgreSQL single-use approval and authenticated post/read');
} finally {
  if (messageId) assert.equal((await request(`${path}/delete`, { headers: sessionHeaders, body: { author, messageId } })).status, 200);
  assert.equal((await request('/api/token-chat/session/revoke', { headers: sessionHeaders, method: 'POST' })).status, 200);
}
assert.equal((await request(path, { at: replica, headers: sessionHeaders, body: { author, text: 'Revoked session must fail.' } })).status, 401);
assert.deepEqual((await request(path)).data.messages, []);
checks.push('message deletion and session revocation persist across actual HTTP requests');
console.log(JSON.stringify({ mode: 'real local container HTTP and PostgreSQL; no interception or chain broadcasts', base,
  replicas: replica === base ? 1 : 2, build: expectedBuild, checks, network: status.data.checks.find(check => check.id === 'network')?.status,
  publicDevnetTransactions: 0 }, null, 2));
