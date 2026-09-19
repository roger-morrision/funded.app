import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { createPostgresStore } from '../server/postgres-store.mjs';

const databaseUrl = process.env.DATABASE_URL;
const url = new URL(databaseUrl || '');
assert.equal(process.env.BACKEND_DB_TEST, '1', 'This test must be explicitly enabled.');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '15432');
assert.equal(url.pathname, '/funded_test');
const pool = new pg.Pool({ connectionString: databaseUrl });
const oldLaunch = { mint: 'legacy-mint', creatorWallet: 'legacy-creator', updatedAt: '2026-01-01T00:00:00.000Z' };
const legacy = { version: 4, launches: { [oldLaunch.mint]: oldLaunch }, settlements: {}, obligations: {}, claims: {}, referralClaims: {}, payouts: {}, collections: {}, launchReviews: {}, alerts: {}, xIntake: {}, referrals: { codes: {}, wallets: {}, attributions: {}, challenges: {} } };
await pool.query(await readFile(resolve('db/schema.sql'), 'utf8'));
await pool.query('INSERT INTO app_state (id, version, payload) VALUES (1, 4, $1::jsonb)', [JSON.stringify(legacy)]);
const store = createPostgresStore(databaseUrl);
const other = createPostgresStore(databaseUrl);
try {
  assert.deepEqual((await store.read()).launches[oldLaunch.mint], oldLaunch, 'Legacy JSON state must migrate once.');
  const before = await pool.query('SELECT updated_at FROM launches WHERE mint = $1', [oldLaunch.mint]);
  await store.update(state => { state.alerts.one = { id: 'one', status: 'active' }; });
  const after = await pool.query('SELECT updated_at FROM launches WHERE mint = $1', [oldLaunch.mint]);
  assert.equal(after.rows[0].updated_at.getTime(), before.rows[0].updated_at.getTime(), 'Unchanged launch rows must not be reprojected.');

  await Promise.all([
    store.update(state => { state.collections.claim = { id: 'claim', signature: 'claim', mint: oldLaunch.mint, status: 'collected', collectedLamports: 1_000_000_000, attribution: 'mint-verified', cluster: 'devnet' }; }),
    other.update(state => { state.referrals.codes.CODE = { wallet: 'inviter', code: 'CODE' }; }),
  ]);
  const state = await other.read();
  assert.equal(state.collections.claim.collectedLamports, 1_000_000_000);
  assert.equal(state.referrals.codes.CODE.wallet, 'inviter');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM state_entities')).rows[0].count, 4);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM collections')).rows[0].count, 1);
  assert.equal((await pool.query("SELECT payload->>'mint' AS mint FROM app_state WHERE id = 1")).rows[0].mint, null, 'Legacy blob is not rewritten on updates.');

  const market = { mint: oldLaunch.mint, cluster: 'devnet', observedAt: new Date().toISOString(), coverage: 'partial' };
  await store.writeMarketActivity(oldLaunch.mint, 'devnet', market);
  assert.deepEqual(await other.readMarketActivity(oldLaunch.mint, 'devnet'), market);
  const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
  assert.equal(await store.chargeRpcRate('integration', 7, 10, windowStart), true);
  assert.equal(await other.chargeRpcRate('integration', 4, 10, windowStart), false, 'Rate budget must be shared between store instances.');

  const port = 18108;
  const api = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', FUNDED_STORE_PATH: '', FUNDED_API_TOKEN: 'postgres-test-token', DATABASE_URL: databaseUrl, DATABASE_SSL: 'false' },
    stdio: 'ignore',
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'Production API did not start on the keyed store.');
    const activity = await (await fetch(`${base}/api/tokens/${oldLaunch.mint}/fee-activity`)).json();
    assert.equal(activity.source, 'funded.app-postgresql');
    assert.equal(activity.collections[0].collectedLamports, 1_000_000_000);
    const unauthorized = await fetch(`${base}/api/alerts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: 'viewer', mint: oldLaunch.mint }) });
    assert.equal(unauthorized.status, 401);
  } finally { api.kill(); }
  console.log('PostgreSQL keyed-store checks passed');
} finally {
  await Promise.all([store.close(), other.close(), pool.end()]);
}
