import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedgerRepository, migrate } from '../server/postgres/ledger.mjs';
import { createClaimsRepository } from '../server/postgres/claims.mjs';
import { createAccountsRepository } from '../server/postgres/accounts.mjs';
import { createReceiptsRepository } from '../server/postgres/receipts.mjs';
import { createAssetsRepository } from '../server/postgres/assets.mjs';

// A recording database adapter verifies repository orchestration, not PostgreSQL execution.
function database(answer = () => ({ rows: [], rowCount: 0 })) {
  const calls = [];
  const client = {
    async query(sql, args = []) { calls.push({ sql, args }); return answer(sql, args); },
    release() { calls.push({ sql: 'release' }); },
  };
  return { calls, pool: { connect: async () => client, query: client.query },
    ensureReady: async () => { calls.push({ sql: 'ready' }); } };
}

test('claim repositories reject invalid IDs before opening a database transaction', async () => {
  const db = database();
  const repo = createClaimsRepository(db);
  for (const method of ['readClaimState', 'readReferralClaimState', 'updateClaimState', 'updateReferralClaimState']) {
    await assert.rejects(repo[method]('__proto__', () => {}), /Invalid claim ID/);
  }
  assert.deepEqual(db.calls, []);
});

test('migration resolves the original schema file after moving into the postgres directory', async () => {
  const db = database(sql => ({ rows: sql.startsWith('SELECT') ? [{ id: 1, version: 2 }] : [], rowCount: 1 }));
  await migrate(db.pool);
  assert.equal(db.calls[0].sql, 'BEGIN');
  assert.match(db.calls[2].sql, /CREATE TABLE IF NOT EXISTS app_state/);
  assert.deepEqual(db.calls.slice(-2).map(c => c.sql), ['COMMIT', 'release']);
});

test('claim and canonical payout commit on the same connection after both locks', async () => {
  const db = database();
  const repo = createClaimsRepository(db);
  await repo.updateClaimState('reward-1', state => {
    state.claims['reward-1'] = { id: 'reward-1', status: 'paid' };
    state.payouts['x:reward-1'] = { id: 'x:reward-1', claimId: 'reward-1' };
  });
  const sql = db.calls.map(c => c.sql);
  assert.deepEqual(sql.slice(0, 4), ['ready', 'BEGIN', 'SELECT pg_advisory_xact_lock_shared(81730421)', 'SELECT pg_advisory_xact_lock(81730423,hashtext($1))']);
  const writes = db.calls.filter(c => c.sql.startsWith('INSERT'));
  assert.deepEqual(writes.map(c => c.args.slice(0, 2)), [['claims', 'reward-1'], ['payouts', 'x:reward-1']]);
  assert.deepEqual(sql.slice(-2), ['COMMIT', 'release']);
});

test('paid claims without a receipt roll back before writes and release the connection', async () => {
  const db = database();
  await assert.rejects(createClaimsRepository(db).updateClaimState('reward-1', state => {
    state.claims['reward-1'] = { id: 'reward-1', status: 'paid' };
  }), /canonical payout/);
  assert.ok(!db.calls.some(c => /^(INSERT|COMMIT)/.test(c.sql)));
  assert.deepEqual(db.calls.slice(-2).map(c => c.sql), ['ROLLBACK', 'release']);
});

test('legacy ledger changes keep entity and projection writes in one transaction', async () => {
  const db = database();
  await createLedgerRepository(db).update(state => { state.launches.mint = { mint: 'mint' }; });
  const statements = db.calls.map(c => c.sql);
  assert.equal(statements[2], 'SELECT pg_advisory_xact_lock(81730421)');
  const entity = statements.findIndex(sql => sql.startsWith('INSERT INTO state_entities'));
  const projection = statements.findIndex(sql => sql.startsWith('INSERT INTO launches'));
  assert.ok(entity > 2 && projection > entity && statements.indexOf('COMMIT') > projection);
  assert.equal(statements.at(-1), 'release');
});

test('chat append still delegates through the composed repository and bounds retained messages', async () => {
  const messages = [{ id: 1 }, { id: 2 }];
  const db = database(sql => ({ rows: sql.startsWith('SELECT payload FROM state_entities') ? [{ payload: messages }] : [], rowCount: 0 }));
  const repo = { ...createAccountsRepository(db) };
  assert.deepEqual(await repo.appendCoinChat('mint', { id: 3 }, 2), { id: 3 });
  const write = db.calls.find(c => c.sql.startsWith('INSERT INTO state_entities'));
  assert.deepEqual(JSON.parse(write.args[2]), [{ id: 2 }, { id: 3 }]);
  assert.deepEqual(db.calls.slice(-2).map(c => c.sql), ['COMMIT', 'release']);
});

test('receipt read failures roll back repeatable-read snapshots', async () => {
  const db = database(sql => { if (sql.includes('receipt_counts')) throw new Error('database failure'); return { rows: [], rowCount: 0 }; });
  await assert.rejects(createReceiptsRepository(db).readReceiptCandidates('devnet'), /database failure/);
  assert.equal(db.calls[1].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(db.calls.slice(-2).map(c => c.sql), ['ROLLBACK', 'release']);
});

test('asset reads wait for shared readiness and preserve the unbounded default feed', async () => {
  const db = database(() => ({ rows: [{ payload: { mint: 'older-launch' } }], rowCount: 1 }));
  assert.deepEqual(await createAssetsRepository(db).readLaunches(), [{ mint: 'older-launch' }]);
  assert.equal(db.calls[0].sql, 'ready');
  assert.equal(db.calls[1].sql, 'SELECT payload FROM launches ORDER BY updated_at DESC, mint');
});
