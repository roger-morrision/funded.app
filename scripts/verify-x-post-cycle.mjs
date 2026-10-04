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
const launch = { mint, signature: proof(1).signature, cluster: 'devnet', onchainVerified: true, createdTimestamp: Date.parse(occurredAt) / 1000 };
const listing = { ...launch, signature: proof(2).signature, status: 'listed', listedAt: occurredAt };
const share = { mint, wallet: recipient, cluster: 'devnet', publicConsent: true, consentVerified: true, consentedAt: occurredAt, buySignature: proof(3).signature, sellSignature: proof(4).signature };
const common = { cluster: 'devnet', coverage: 'complete', windowStart: '2026-10-03T00:00:00.000Z', windowEnd: '2026-10-04T00:00:00.000Z', proofs: [proof(5)] };
const adapters = {
  verifyLaunch: async () => ({ mint, name: 'Fixture launch', proofs: [proof(1)], occurredAt }),
  verifyListing: async () => ({ mint, name: 'Fixture listing', listingType: 'paid', proofs: [proof(2)], occurredAt }),
  verifyPublicClosedTrade: async () => ({ mint, wallet: recipient, name: 'Fixture trade', publicConsent: true, positionClosed: true, completeCostBasis: true, buyCostLamports: '1000000000', sellProceedsLamports: '3000000000', feesLamports: '1000000', proofs: [proof(3), proof(4)], occurredAt }),
  verifiedDailyProjects: async () => ({ ...common, metric: 'volume_lamports', projects: [{ mint, name: 'Fixture project', amountLamports: '3000000000' }] }),
  verifiedDailyRewards: async () => ({ ...common, scope: 'recorded-verified-payouts', payments: [{ id: 'reward', recipient, signature: proof(5).signature, amountLamports: '1000000001', asset: 'SOL', status: 'paid', finalized: true, balanceDeltaVerified: true }] }),
};
const config = { execute: false, handle: accountId, cluster: 'devnet', enabledAt: '2026-10-02T00:00:00.000Z', origin: 'https://funded.vip', minProfitLamports: '1000000000', maxPosts: 20 };
const options = { config, store, mainStore: { read: async () => ({ launches: { launch }, listings: { listing }, xPublicTradeShares: { share } }) }, readRewards: async () => null, adapters, now,
  publish: () => assert.fail('Draft collection must not publish') };
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
  console.log(JSON.stringify({ mode: 'real PostgreSQL with synthetic verified source adapters; no network or publications', passed: 3, checks: ['Five event kinds collect, format and enqueue atomically', 'Second draft cycle preserves exact amounts and suppresses replay', 'Main-state public trade consent bucket survives store close and reopen'] }, null, 2));
} finally { await store.close(); await pool.end(); }
