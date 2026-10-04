import assert from 'node:assert/strict';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { createXPostStore } from '../server/x-post-store.mjs';
import { runXPostWorker } from '../server/x-post-worker.mjs';
import { createXPublisher } from '../server/x-post-client.mjs';

// This harness resets only an explicitly enabled, disposable loopback database.
assert.equal(process.env.X_POST_DB_TEST, '1', 'Set X_POST_DB_TEST=1 for the isolated integration database.');
const databaseUrl = process.env.X_POST_TEST_DATABASE_URL;
assert.ok(databaseUrl, 'X_POST_TEST_DATABASE_URL is required.');
const target = new URL(databaseUrl);
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '15433');
assert.equal(target.pathname, '/funded_x_test');
const pool = new pg.Pool({ connectionString: databaseUrl });
const stores = [];
const checks = [];
const fixture = id => ({ id, kind: 'launch', cluster: 'devnet', occurredAt: '2026-10-04T00:00:00.000Z', text: 'Devnet integration fixture', proofs: { signature: 'synthetic-proof', slot: 42 } });
const published = { id: '123456', url: 'https://x.com/i/web/status/123456' };
async function store(accountId, options = {}) {
  const item = createXPostStore({ databaseUrl, accountId, minIntervalMs: 1, leaseMs: 1000, ...options });
  stores.push(item); await item.init(); return item;
}
async function allow(accountId) {
  await pool.query("UPDATE x_post_accounts SET next_allowed_at=clock_timestamp()-interval '1 second' WHERE account_id=$1", [accountId]);
  await pool.query("UPDATE x_post_outbox SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE account_id=$1", [accountId]);
}
try {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  const [a, b] = await Promise.all([store('concurrent', { minIntervalMs: 60_000 }), store('concurrent', { minIntervalMs: 1 })]);
  await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? a : b).enqueue(fixture('launch:first'))));
  assert.equal((await a.list()).length, 1);
  await b.enqueue({ ...fixture('launch:first'), proofs: { slot: 42, signature: 'synthetic-proof' } });
  await assert.rejects(b.enqueue({ ...fixture('launch:first'), text: 'Changed after approval' }), /immutable/);
  assert.equal((await a.list())[0].event.text, fixture('launch:first').text);
  checks.push('Concurrent enqueue deduplicates immutable events and canonicalizes proof key order');
  await a.enqueue(fixture('launch:second'));
  const claims = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? a : b).claim()));
  assert.equal(claims.filter(Boolean).length, 1);
  const first = claims.find(Boolean);
  await assert.rejects(b.markPosted(first.event.id, '00000000-0000-0000-0000-000000000000', published), /no longer current/);
  await a.markPosted(first.event.id, first.token, published);
  assert.equal(await b.claim(), null, 'Persisted account pacing blocks a different process after completion');
  const reopened = await store('concurrent', { minIntervalMs: 1 });
  assert.equal(await reopened.claim(), null, 'Reinitializing cannot lower persisted account pacing');
  assert.equal(Number((await pool.query('SELECT min_interval_ms FROM x_post_accounts WHERE account_id=$1', ['concurrent'])).rows[0].min_interval_ms), 60_000);
  const restartedProcess = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createXPostStore } from ${JSON.stringify(new URL('../server/x-post-store.mjs', import.meta.url).href)};
    const store = createXPostStore({ databaseUrl: process.env.X_POST_TEST_DATABASE_URL, accountId: 'concurrent', minIntervalMs: 1 });
    try {
      await store.init();
      assert.equal(await store.claim(), null);
      assert.equal((await store.list({status:'posted'})).length,1);
      assert.equal((await store.list({status:'pending'})).length,1);
    } finally { await store.close(); }
  `], { env: { ...process.env, X_POST_TEST_DATABASE_URL: databaseUrl }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(restartedProcess.status, 0, restartedProcess.stderr);
  await allow('concurrent');
  const second = await reopened.claim();
  assert.equal(second.event.id, 'launch:second');
  await reopened.markPosted(second.event.id, second.token, published);
  await allow('concurrent');
  assert.equal(await reopened.claim(), null);
  assert.equal((await reopened.list({ status: 'posted' })).length, 2);
  await assert.rejects(a.markPosted(first.event.id, first.token, published), /no longer current/);
  checks.push('Two workers dispatch only one event; posted markers, fencing and account pacing survive new store instances');

  const crashed = await store('crash');
  await crashed.enqueue(fixture('launch:crash'));
  const abandoned = await crashed.claim();
  await pool.query("UPDATE x_post_accounts SET lease_expires_at=clock_timestamp()-interval '1 second',next_allowed_at=clock_timestamp()-interval '1 second' WHERE account_id='crash'");
  await pool.query("UPDATE x_post_outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE account_id='crash'");
  const recovered = await store('crash');
  assert.equal(await recovered.claim(), null, 'Ambiguous delivery must never return to automatic dispatch');
  const uncertain = (await recovered.list())[0];
  assert.equal(uncertain.status, 'uncertain');
  assert.equal(uncertain.reason, 'sending-lease-expired');
  assert.equal(uncertain.attempts, 1);
  await assert.rejects(crashed.markPosted(abandoned.event.id, abandoned.token, published), /no longer current/);
  assert.equal(await recovered.claim(), null);
  checks.push('Expired sending leases become uncertain and reject stale completion without resending');

  const retry = await store('retry', { maxAttempts: 2 });
  await retry.enqueue(fixture('launch:rate-limit'));
  let claim = await retry.claim();
  await retry.retryLater(claim.event.id, claim.token, 60_000);
  const retryRestart = await store('retry', { maxAttempts: 2 });
  assert.equal(await retryRestart.claim(), null);
  assert.equal((await retryRestart.list())[0].status, 'pending');
  await allow('retry');
  claim = await retryRestart.claim();
  await retryRestart.retryLater(claim.event.id, claim.token, 60_000);
  assert.equal((await retryRestart.list())[0].status, 'failed');
  assert.equal((await retryRestart.list())[0].reason, 'retry-limit');
  assert.equal((await retryRestart.list())[0].attempts, 2);
  await allow('retry'); assert.equal(await retryRestart.claim(), null);
  checks.push('Rate-limit retry delay survives restart and bounded attempts become terminal');

  const isolated = await store('other-account');
  await isolated.enqueue(fixture('launch:first'));
  assert.equal((await isolated.list())[0].status, 'pending');
  assert.equal((await a.list({ status: 'posted' })).length, 2);
  const pendingRestart = await store('other-account');
  claim = await pendingRestart.claim();
  await pendingRestart.markUncertain(claim.event.id, claim.token, 'network-timeout');
  await allow('other-account');
  assert.equal(await isolated.claim(), null);
  assert.equal((await isolated.list())[0].status, 'uncertain');
  checks.push('Account namespaces are isolated; pending work survives restart and uncertain delivery is terminal');

  for (const [name, error, status] of [
    ['429', { delivery: 'not-sent', status: 429, retryAfterMs: 60_000 }, 'pending'],
    ['503', { delivery: 'unknown', status: 503 }, 'uncertain'],
    ['network', {}, 'uncertain'],
    ['403', { delivery: 'not-sent', status: 403 }, 'failed'],
  ]) {
    const dispatch = await store(`worker-${name}`, { leaseMs: 2000 });
    await dispatch.enqueue(fixture(`launch:${name}`));
    let sends = 0;
    const publish = async () => {
      sends++;
      assert.equal((await dispatch.list())[0].status, 'sending', 'Sending is durable before outbound delivery');
      throw Object.assign(new Error('Synthetic upstream failure'), error);
    };
    const options = { store: dispatch, publish, enabled: true, dryRun: false, timeoutMs: 100, maxPosts: 2 };
    await runXPostWorker(options);
    assert.equal((await dispatch.list())[0].status, status);
    await runXPostWorker(options);
    assert.equal(sends, 1, 'A second worker run cannot resend uncertain, failed, or rate-limited work');
  }
  const timeoutStore = await store('worker-timeout', { leaseMs: 2000 });
  await timeoutStore.enqueue(fixture('launch:timeout'));
  let timedOutSignal;
  const timeout = await runXPostWorker({ store: timeoutStore, enabled: true, dryRun: false, timeoutMs: 100,
    publish: async (_, { signal }) => { timedOutSignal = signal; return new Promise(() => {}); } });
  assert.equal(timeout.uncertain, 1);
  assert.equal(timedOutSignal.aborted, true);
  assert.equal((await timeoutStore.list())[0].status, 'uncertain');
  checks.push('Real persisted worker transitions retry only 429; 403 fails and timeout/network/5xx remain uncertain');

  const preview = await store('worker-preview');
  await preview.enqueue(fixture('launch:preview'));
  const forbidden = () => assert.fail('Disabled and draft workers must not contact X');
  assert.equal((await runXPostWorker({ store: preview, publish: forbidden })).mode, 'disabled');
  assert.equal((await runXPostWorker({ store: preview, publish: forbidden, enabled: true, dryRun: true })).events.length, 1);
  assert.equal((await preview.list())[0].attempts, 0);
  assert.equal((await preview.list())[0].status, 'pending');
  checks.push('Disabled and draft worker modes make zero publication requests and leave dispatch attempts unchanged');

  const capped = await store('capped', { maxHourlyPosts: 2, maxDailyPosts: 3 });
  for (let index = 0; index < 4; index++) await capped.enqueue(fixture(`launch:cap-${index}`));
  for (let index = 0; index < 2; index++) {
    await allow('capped'); const item = await capped.claim(); assert.ok(item);
    await capped.markPosted(item.event.id, item.token, published);
  }
  await allow('capped'); assert.equal(await capped.claim(), null, 'Hourly cap preserves pending backlog');
  const cappedRestart = await store('capped', { maxHourlyPosts: 60, maxDailyPosts: 1440 });
  assert.equal(await cappedRestart.claim(), null, 'A replica cannot raise durable account caps');
  assert.equal((await cappedRestart.list({ status: 'pending' })).length, 2);
  await pool.query("UPDATE x_post_accounts SET hour_start=date_trunc('hour',clock_timestamp())-interval '1 hour' WHERE account_id='capped'");
  const third = await cappedRestart.claim(); assert.ok(third);
  await cappedRestart.markPosted(third.event.id, third.token, published);
  await allow('capped');
  await pool.query("UPDATE x_post_accounts SET hour_start=date_trunc('hour',clock_timestamp())-interval '1 hour' WHERE account_id='capped'");
  assert.equal(await capped.claim(), null, 'Daily cap remains binding after the hourly window resets');
  await pool.query("UPDATE x_post_accounts SET day_start=date_trunc('day',clock_timestamp())-interval '1 day' WHERE account_id='capped'");
  const fourth = await capped.claim(); assert.ok(fourth);
  await capped.markPosted(fourth.event.id, fourth.token, published);
  assert.equal((await capped.list({ status: 'posted' })).length, 4);
  checks.push('Hourly and daily caps persist across replicas, retain backlog, and reset independently at database UTC boundaries');

  const mixedCase = await store('CaPpEd', { maxHourlyPosts: 60, maxDailyPosts: 1440 });
  assert.equal((await mixedCase.list({ status: 'posted' })).length, 4, 'X handle casing must not create a fresh account namespace');
  checks.push('Mixed-case account handles share the same durable queue and account limits');

  for (const [name, response, expected] of [
    ['success', () => Response.json({ data: { id: '987654' } }), 'posted'],
    ['limited', () => new Response('', { status: 429, headers: { 'retry-after': '120' } }), 'pending'],
    ['forbidden', () => new Response('', { status: 403 }), 'failed'],
    ['upstream', () => new Response('', { status: 503 }), 'uncertain'],
    ['invalid-json', () => new Response('not JSON', { status: 200 }), 'uncertain'],
    ['missing-id', () => Response.json({ data: {} }), 'uncertain'],
    ['reset', () => { throw new TypeError('Synthetic connection reset'); }, 'uncertain'],
  ]) {
    const actualStore = await store(`client-${name}`, { leaseMs: 2000 });
    await actualStore.enqueue(fixture(`launch:client-${name}`));
    const requests = [];
    const client = createXPublisher({ accessToken: 'synthetic-unit-token', expectedHandle: 'FundedFixture', expectedAccountId: '123', timeoutMs: 100,
      fetchImpl: async (url, options) => {
        requests.push({ url, method: options.method });
        assert.equal(options.redirect, 'error');
        if (url === 'https://api.x.com/2/users/me') return Response.json({ data: { id: '123', username: 'fundedfixture' } });
        assert.equal(url, 'https://api.x.com/2/tweets');
        assert.equal(options.method, 'POST');
        assert.equal((await actualStore.list())[0].status, 'sending');
        assert.deepEqual(JSON.parse(options.body), { text: fixture('unused').text });
        return response();
      } });
    await assert.rejects(client.publish(fixture('unverified')), /Verify the publishing account/);
    assert.equal(requests.length, 0);
    await client.verifyAccount();
    const options = { store: actualStore, publish: client.publish, enabled: true, dryRun: false, timeoutMs: 100 };
    await runXPostWorker(options);
    assert.equal((await actualStore.list())[0].status, expected, `Client response ${name} must persist the right outcome`);
    await runXPostWorker(options);
    assert.equal(requests.filter(item => item.method === 'POST').length, 1);
  }
  checks.push('Real client + worker + PostgreSQL integration classifies HTTP429/403/503, malformed success and connection reset without duplicate sends');

  const collectorA = await store('collector');
  const collectorB = await store('collector');
  assert.deepEqual(await collectorA.readCursor(), { version: 0, cursor: null });
  const competing = await Promise.allSettled([
    collectorA.enqueueBatch([fixture('launch:batch-a')], { cursor: { next: 'a' }, version: 0 }),
    collectorB.enqueueBatch([fixture('launch:batch-b')], { cursor: { next: 'b' }, version: 0 }),
  ]);
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(competing.filter(result => result.status === 'rejected').length, 1);
  const winner = competing.find(result => result.status === 'fulfilled').value;
  assert.equal((await collectorA.list()).length, 1);
  assert.equal((await collectorB.readCursor()).version, 1);
  assert.deepEqual((await collectorB.readCursor()).cursor, winner.cursor);
  const existing = (await collectorA.list())[0].event;
  await assert.rejects(collectorB.enqueueBatch([fixture('launch:must-roll-back'), { ...existing, text: 'Changed immutable content' }],
    { cursor: { next: 'invalid' }, version: 1 }), /immutable/);
  assert.equal(await collectorA.has('launch:must-roll-back'), false);
  assert.deepEqual(await collectorA.readCursor(), { version: 1, cursor: winner.cursor });
  assert.equal(await collectorA.has(existing.id), true);
  assert.equal(await isolated.has(existing.id), false);
  checks.push('Collector cursor and complete event batches commit atomically; racing checkpoints and immutable conflicts roll back all writes');
  console.log(JSON.stringify({ mode: 'real isolated PostgreSQL; no X HTTP or Solana transactions', checks, passed: checks.length }, null, 2));
} finally {
  await Promise.allSettled(stores.map(item => item.close()));
  await pool.end();
}
