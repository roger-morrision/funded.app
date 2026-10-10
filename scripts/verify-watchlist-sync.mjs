import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createPostgresStore } from '../server/postgres-store.mjs';
import { createXAuth, cookieValue } from '../server/x-auth.mjs';
import { createWatchlistHandler } from '../server/watchlists.mjs';
import { createWatchlistSync } from '../watchlist-sync.js';
import { createReferralAuth } from '../server/referral-auth.mjs';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

// Local test database only. Never load deployment credentials.
const db = new URL(process.env.WATCHLIST_TEST_DATABASE_URL || 'postgresql://funded:funded-test@127.0.0.1:15432/funded_test');
assert(['127.0.0.1', 'localhost'].includes(db.hostname) && db.pathname.endsWith('_test'), 'Use a local test database.');
const schema = `watchlist_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: db.href, connectionTimeoutMillis: 5000 });
let store, server;
const mintA = '9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
const mintB = '9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w';
const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  db.searchParams.set('options', `-c search_path=${schema}`);
  store = createPostgresStore(db.href);
  await store.health();
  const auth = createXAuth(store);
  const referralAuth = createReferralAuth(store);
  const tokenA = await auth.issue({ id: '123', username: 'watchtest' });
  const tokenA2 = await auth.issue({ id: '123', username: 'watchtest' });
  const tokenB = await auth.issue({ id: '456', username: 'otheruser' });
  const handler = createWatchlistHandler({ store, cluster: 'devnet', origin: '', getSession: req => auth.session(cookieValue(req, 'funded_x_session')), getWalletSession: req => referralAuth.session(cookieValue(req, 'funded_referral_session')) });
  server = createServer(async (req, res) => {
    try { if (!await handler(req, res, new URL(req.url, 'http://localhost'))) { res.writeHead(404); res.end(); } }
    catch { res.writeHead(500); res.end(JSON.stringify({ error: 'Test server failure' })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const raw = (token, options = {}, path = '/api/watchlist') => fetch(`${base}${path}`, { ...options, headers: { cookie: `funded_x_session=${token}`, origin: base, 'content-type': 'application/json', ...options.headers }, body: options.body ? JSON.stringify(options.body) : undefined });
  const rawWallet = (token, wallet, options = {}) => fetch(`${base}/api/watchlist?accountId=${encodeURIComponent(`wallet:${wallet}`)}`, { ...options, headers: { cookie: `funded_referral_session=${token}`, origin: base, 'content-type': 'application/json', ...options.headers }, body: options.body ? JSON.stringify(options.body) : undefined });
  const request = (token, wallet) => async (path, options = {}) => {
    const response = wallet ? await rawWallet(token, wallet, options) : await raw(token, options, path);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return { available: true, data };
  };
  assert.equal((await raw('')).status, 401);
  const initial = await (await raw(tokenA)).json();
  assert.equal((await raw(tokenA, { method: 'POST', body: { action: 'add', mint: mintA, accountId: '123' } })).status, 403);
  const post = (body, headers = {}) => raw(tokenA, { method: 'POST', body, headers: { 'x-watchlist-csrf': initial.csrf, ...headers } });
  assert.equal((await post({ action: 'add', mint: mintA, accountId: '123' }, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await post({ action: 'add', mint: mintA, accountId: '456' })).status, 409);
  assert.equal((await post({ action: 'add', mint: 'invalid', accountId: '123' })).status, 400);

  const localA = storage();
  localA.setItem('funded.app.community.watchlist', JSON.stringify([mintA]));
  const deviceA = createWatchlistSync({ storage: localA, request: request(tokenA) });
  const deviceB = createWatchlistSync({ storage: storage(), request: request(tokenA2) });
  assert.equal(await deviceA.setIdentity('123'), true);
  await deviceB.setIdentity('123');
  assert.deepEqual(deviceB.get(), [mintA], 'A new device reads the imported token from PostgreSQL.');
  await Promise.all([deviceA.save(mintB, false), deviceB.save(mintA, true)]);
  await deviceA.refresh(); await deviceB.refresh();
  assert.deepEqual(deviceA.get(), [mintB]);
  assert.deepEqual(deviceB.get(), [mintB], 'Concurrent independent edits do not overwrite each other.');
  const importId = randomUUID();
  await post({ accountId: '123', action: 'import', importId, mints: [mintA] });
  await deviceB.save(mintA, true);
  await post({ accountId: '123', action: 'import', importId, mints: [mintA] });
  await deviceB.refresh();
  assert.deepEqual(deviceB.get(), [mintB], 'A retried import cannot resurrect a removed token.');
  await deviceA.setIdentity(null);
  assert.deepEqual(deviceA.get(), [], 'Signing out clears account favorites.');
  const other = createWatchlistSync({ storage: localA, request: request(tokenB) });
  await other.setIdentity('456');
  assert.deepEqual(other.get(), [], 'Account favorites cannot migrate to a different account.');
  const failing = createWatchlistSync({ storage: storage(), request: async () => { throw new Error('offline'); } });
  assert.equal(await failing.setIdentity('123'), false);
  assert.equal(await failing.save(mintA, false), false, 'An offline write must not report success.');
  const reopened = createPostgresStore(db.href);
  assert.deepEqual((await reopened.readWatchlist('123', 'devnet')).mints, [mintB], 'Data survives reopening the database store.');
  await reopened.close();

  const walletKeypair = Keypair.generate();
  const wallet = walletKeypair.publicKey.toBase58();
  const walletLogin = async keypair => {
    const challenge = await referralAuth.start(keypair.publicKey.toBase58());
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.statement), keypair.secretKey));
    return (await referralAuth.verify(challenge.challengeId, keypair.publicKey.toBase58(), signature)).token;
  };
  const walletTokenA = await walletLogin(walletKeypair);
  const walletTokenB = await walletLogin(walletKeypair);
  const walletIdentity = `wallet:${wallet}`;
  assert.equal((await rawWallet('', wallet)).status, 401, 'A connected address without signed session cannot read favorites.');
  assert.equal((await rawWallet(walletTokenA, Keypair.generate().publicKey.toBase58())).status, 401, 'One wallet session cannot read another wallet.');
  const walletInitial = await (await rawWallet(walletTokenA, wallet)).json();
  assert.equal((await rawWallet(walletTokenA, wallet, { method: 'POST', body: { action: 'add', mint: mintA, accountId: walletIdentity } })).status, 403, 'A signed wallet still needs the session CSRF token.');
  const walletDeviceA = createWatchlistSync({ storage: storage(), request: request(walletTokenA, wallet) });
  const walletDeviceB = createWatchlistSync({ storage: storage(), request: request(walletTokenB, wallet) });
  assert.equal(await walletDeviceA.setIdentity(walletIdentity), true);
  assert.equal(await walletDeviceA.save(mintA, false), true);
  assert.equal(await walletDeviceB.setIdentity(walletIdentity), true);
  assert.deepEqual(walletDeviceB.get(), [mintA], 'The same verified wallet loads favorites on another device.');
  assert.equal((await rawWallet(walletTokenA, wallet, { method: 'POST', headers: { 'x-watchlist-csrf': walletInitial.csrf }, body: { action: 'add', mint: mintB, accountId: '123' } })).status, 409, 'Wallet sessions cannot modify X favorites.');
  assert.deepEqual((await store.readWatchlist('123', 'devnet')).mints, [mintB], 'Wallet favorites stay separate from X favorites.');
  const otherWallet = Keypair.generate();
  const otherWalletToken = await walletLogin(otherWallet);
  assert.deepEqual((await (await rawWallet(otherWalletToken, otherWallet.publicKey.toBase58())).json()).mints, [], 'Different wallets stay isolated.');

  if (process.env.UI_BASE_URL) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
      const errors = [];
      const pages = [];
      for (const [index, context] of contexts.entries()) {
        await context.route('**/api/**', async route => {
          const path = new URL(route.request().url()).pathname;
          if (path === '/api/watchlist') {
            const response = await raw(index === 0 ? tokenA : tokenA2, { method: route.request().method(), body: route.request().postDataJSON() || undefined, headers: { 'x-watchlist-csrf': route.request().headers()['x-watchlist-csrf'] || '' } });
            return route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
          }
          if (path === '/api/x/me') return route.fulfill({ json: { authenticated: true, user: { id: '123', username: 'watchtest' } } });
          if (path === '/api/x-fee/claims') return route.fulfill({ json: { claims: [], handle: '@watchtest' } });
          if (path === '/api/launches') return route.fulfill({ json: [mintA, mintB].map((mint, i) => ({ mint, cluster: 'devnet', onchainVerified: true, name: `Favorite test ${i}`, symbol: `FAV${i}`, creatorWallet: mintA })) });
          return route.fulfill({ status: 503, json: { error: 'Mocked market API' } });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${process.env.UI_BASE_URL}/#community`);
        await page.waitForFunction(() => document.querySelector('#community .section-state')?.textContent === 'Synced to account').catch(async error => { throw new Error(`${error.message}; page errors=${JSON.stringify(errors)}; status=${await page.locator('[data-watchlist-status]').allTextContents()}`); });
        assert.equal(await page.locator('#watchlist-items .saved-token-row').count(), 1);
        pages.push(page);
      }
      await pages[0].locator('#watchlist-items .watch-button').click();
      await pages[0].waitForFunction(() => document.querySelectorAll('#watchlist-items .saved-token-row').length === 0);
      await pages[1].locator('#watchlist-sync-retry').click();
      await pages[1].waitForFunction(() => document.querySelectorAll('#watchlist-items .saved-token-row').length === 0);
      assert.deepEqual(errors, []);
      console.log('PASS: two independent Chrome contexts share database favorites and observe removals. Market and sign-in responses mocked; favorites API and PostgreSQL are real local services.');
    } finally { await browser.close(); }
  }
  console.log('PASS: PostgreSQL persistence, account isolation, authenticated writes, CSRF/origin checks, concurrency, import retries and offline errors.');
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await store?.close();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
