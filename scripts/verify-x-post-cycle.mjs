import assert from 'node:assert/strict';
import bs58 from 'bs58';
import pg from 'pg';
import { createXPostStore } from '../server/x-post-store.mjs';
import { createPostgresStore } from '../server/postgres-store.mjs';
import { runXPostCycle } from './run-x-post-worker.mjs';

assert.equal(process.env.X_POST_DB_TEST, '1');
const databaseUrl = process.env.X_POST_TEST_DATABASE_URL;
const target = new URL(databaseUrl);
assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '15433'); assert.equal(target.pathname, '/funded_x_test');
const accountId = 'cycle-fixture';
const pool = new pg.Pool({ connectionString: databaseUrl });
const store = createXPostStore({ databaseUrl, accountId });
const mint = bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
const recipient = bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 2));
const proof = n => ({ signature: bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => (i + n) % 256)), slot: n + 100, commitment: 'finalized', verified: true, cluster: 'devnet' });
const now = Date.parse('2026-10-04T12:00:00Z');
const occurredAt = '2026-10-03T12:00:00.000Z';
const launch = { mint, signature: proof(1).signature, cluster: 'devnet', onchainVerified: true, createdTimestamp: Date.parse(occurredAt) / 1000,
  creatorLaunchBurn: { tier: 'pro', status: 'verified', amountTokens: 100, receipt: { signature: proof(1).signature, verified: true, atomicWithPumpLaunch: true } } };
const listing = { ...launch, signature: proof(2).signature, status: 'listed', listedAt: occurredAt };
const share = { mint, wallet: recipient, cluster: 'devnet', publicConsent: true, consentVerified: true, consentedAt: occurredAt, buySignature: proof(3).signature, sellSignature: proof(4).signature };
const common = { cluster: 'devnet', coverage: 'complete', windowStart: '2026-10-03T00:00:00.000Z', windowEnd: '2026-10-04T00:00:00.000Z', proofs: [proof(5)] };
const adapters = {
  verifyLaunch: async () => ({ mint, name: 'Fixture launch', marketingTier: 'pro', proofs: [proof(1)], occurredAt }),
  verifyListing: async () => ({ mint, name: 'Fixture listing', listingType: 'paid', proofs: [proof(2)], occurredAt }),
  verifyPublicClosedTrade: async () => ({ mint, wallet: recipient, name: 'Fixture trade', publicConsent: true, positionClosed: true, completeCostBasis: true, buyCostLamports: '1000000000', sellProceedsLamports: '3000000000', feesLamports: '1000000', proofs: [proof(3), proof(4)], occurredAt }),
  verifiedDailyProjects: async () => ({ ...common, metric: 'volume_lamports', projects: [{ mint, name: 'Fixture project', amountLamports: '3000000000' }] }),
  verifiedDailyRewards: async () => ({ ...common, scope: 'recorded-verified-payouts', payments: [{ id: 'reward', recipient, signature: proof(5).signature, amountLamports: '1000000001', asset: 'SOL', status: 'paid', finalized: true, balanceDeltaVerified: true }] }),
};
const config = { execute: false, handle: accountId, cluster: 'devnet', enabledAt: '2026-10-02T00:00:00.000Z', origin: 'https://funded.vip', minProfitLamports: '1000000000', maxPosts: 20 };
const options = { config, store, mainStore: { read: async () => ({ launches: { launch }, listings: { listing }, xPublicTradeShares: { share } }) }, readRewards: async () => null, adapters, now,
  publish: () => assert.fail('Draft collection must not publish') };

async function verifyOlderSourceRecovery() {
  const recoveryAccount = 'cycle-older-fixture';
  const sourcePrefix = 'qa-x-older-';
  const sourceStore = createPostgresStore(databaseUrl);
  const openOutbox = () => createXPostStore({ databaseUrl, accountId: recoveryAccount });
  let recoveryStore = openOutbox();
  const verifications = new Map();
  const newer = { ...launch, mint: bs58.encode(new Uint8Array(32).fill(100)), signature: proof(100).signature };
  const older = Array.from({ length: 60 }, (_, index) => ({
    ...launch, mint: bs58.encode(new Uint8Array(32).fill(index + 20)), signature: proof(index + 20).signature,
    createdTimestamp: Date.parse('2026-10-03T01:00:00Z') / 1000 + index,
  }));
  const recoveryOptions = {
    ...options, config: { ...config, handle: recoveryAccount },
    mainStore: { read: async () => ({ launches: Object.fromEntries(Object.entries((await sourceStore.read()).launches || {}).filter(([key]) => key.startsWith(sourcePrefix))) }) },
    adapters: { verifyLaunch: async row => {
      verifications.set(row.signature, (verifications.get(row.signature) || 0) + 1);
      return { mint: row.mint, name: 'Recovered fixture', marketingTier: 'pro', occurredAt: new Date(row.createdTimestamp * 1000).toISOString(), proofs: [{ ...proof(1), signature: row.signature }] };
    } },
  };
  const cycle = () => runXPostCycle({ ...recoveryOptions, store: recoveryStore });
  try {
    await recoveryStore.init();
    await pool.query('DELETE FROM x_post_outbox WHERE account_id=$1', [recoveryAccount]);
    await pool.query('UPDATE x_post_accounts SET collector_cursor=NULL,cursor_version=0 WHERE account_id=$1', [recoveryAccount]);
    await sourceStore.update(state => {
      state.launches ||= {};
      for (const key of Object.keys(state.launches)) if (key.startsWith(sourcePrefix)) delete state.launches[key];
      state.launches[`${sourcePrefix}newer`] = newer;
    });
    assert.equal((await cycle()).collected, 1);
    const highwater = (await recoveryStore.readCursor()).cursor.streams.launch.after;
    await sourceStore.update(state => {
      older.forEach((row, index) => { state.launches[`${sourcePrefix}${index}`] = row; });
    });

    // A failed durable enqueue must not acknowledge the older-source scan.
    const beforeFailure = await recoveryStore.readCursor();
    await assert.rejects(runXPostCycle({ ...recoveryOptions, store: { ...recoveryStore, enqueueBatch: async () => { throw new Error('Fixture enqueue unavailable'); } } }), /Fixture enqueue unavailable/);
    assert.deepEqual(await recoveryStore.readCursor(), beforeFailure);
    assert.equal((await recoveryStore.list({ limit: 200 })).length, 1);

    await cycle();
    const checkpoint = await recoveryStore.readCursor();
    assert.deepEqual(checkpoint.cursor.streams.launch.after, highwater, 'Older-source reconciliation must not move the fresh highwater backward');
    assert.ok(checkpoint.cursor.streams.launch.reconciliation?.throughId, 'A bounded older-source sweep must persist its finite ceiling');
    const partiallySaved = await recoveryStore.list({ limit: 200 });
    assert(partiallySaved.length > 1 && partiallySaved.length < older.length + 1, 'More than one batch must be needed to discover the older sources');
    await recoveryStore.close();
    recoveryStore = openOutbox();
    await recoveryStore.init();
    assert.deepEqual(await recoveryStore.readCursor(), checkpoint, 'Cyclic scan checkpoint survives closing and reopening the PostgreSQL outbox');
    assert.deepEqual(await recoveryStore.list({ limit: 200 }), partiallySaved, 'Partial drafts survive closing and reopening the PostgreSQL outbox');

    for (let attempt = 0; attempt < 10 && (await recoveryStore.list({ limit: 200 })).length < older.length + 1; attempt += 1) await cycle();
    const all = await recoveryStore.list({ limit: 200 });
    assert.equal(all.length, older.length + 1, 'All eligible sources inserted behind the timestamp highwater must be discovered');
    assert.equal(new Set(all.map(row => row.event.id)).size, all.length);
    assert.deepEqual(new Set(all.map(row => row.event.proofs[0].signature)), new Set([newer, ...older].map(row => row.signature)));
    assert(all.every(row => row.status === 'pending' && row.attempts === 0), 'Reconciliation creates drafts without dispatch');
    const verifiedBeforeReplay = new Map(verifications);
    await recoveryStore.close();
    recoveryStore = openOutbox();
    await recoveryStore.init();
    for (let attempt = 0; attempt < 4; attempt += 1) assert.equal((await cycle()).collected, 0, 'Restarted cyclic sweeps must suppress every durable event ID');
    assert.deepEqual(verifications, verifiedBeforeReplay, 'Known drafts are not reverified or republished during reconciliation');
    assert.deepEqual(await recoveryStore.list({ limit: 200 }), all, 'Retry and restart preserve exactly one immutable draft per source');
  } finally { await recoveryStore.close(); await sourceStore.close(); }
}
try {
  await store.init();
  await pool.query('DELETE FROM x_post_outbox WHERE account_id=$1', [accountId]);
  await pool.query('UPDATE x_post_accounts SET collector_cursor=NULL,cursor_version=0 WHERE account_id=$1', [accountId]);
  const first = await runXPostCycle(options);
  assert.equal(first.collected, 5, 'All five collector kinds must survive formatting and durable enqueue');
  assert.equal(first.mode, 'draft');
  const saved = await store.list();
  assert.equal(saved.length, 5);
  assert(saved.every(row => row.status === 'pending' && row.attempts === 0 && row.event.text.startsWith('[Devnet test]')));
  assert(saved.some(row => row.event.text.includes('1.000000001 SOL')), 'Exact reward units survive the full collector-to-formatter path');
  const second = await runXPostCycle(options);
  assert.equal(second.collected, 0, 'Persisted collector cursor suppresses duplicate drafts');
  assert.equal((await store.list()).length, 5);
  const mainLedger = createPostgresStore(databaseUrl);
  try { await mainLedger.update(state => { state.xPublicTradeShares ||= {}; state.xPublicTradeShares['qa-persisted-consent'] = share; }); }
  finally { await mainLedger.close(); }
  const reopenedLedger = createPostgresStore(databaseUrl);
  try { assert.deepEqual((await reopenedLedger.read()).xPublicTradeShares['qa-persisted-consent'], share, 'Public trade consent bucket must survive closing and reopening the PostgreSQL main state store'); }
  finally { await reopenedLedger.close(); }
  await verifyOlderSourceRecovery();
  console.log(JSON.stringify({ mode: 'real PostgreSQL with synthetic verified source adapters; no network or publications', passed: 4, checks: ['Five event kinds collect, format and enqueue atomically', 'Second draft cycle preserves exact amounts and suppresses replay', 'Main-state public trade consent bucket survives store close and reopen', 'Older eligible sources reconcile across bounded batches, enqueue failure, store restart and duplicate sweeps'] }, null, 2));
} finally { await store.close(); await pool.end(); }
