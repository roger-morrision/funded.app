import assert from 'node:assert/strict';
import test from 'node:test';
import { workerHeartbeatHealth, workerFailureReport, rewardWorkerFailureStatus } from '../server/worker-readiness.mjs';
import { receiptWorkerStatus } from '../server/receipt-worker-status.mjs';
import { rewardServiceHealth } from '../server/reward-service-health.mjs';
import { createHolderHistoryIndexer } from '../server/holder-history-indexer.mjs';
const now = Date.parse('2026-10-04T12:00:00Z');
const at = new Date(now).toISOString();

test('community readiness rejects malformed, missing, future, stale and wrong-network heartbeats', () => {
  const options = { now, maxAgeMs: 90_000, expectedCluster: 'devnet' };
  const valid = { status: 'ready', cluster: 'devnet', at };
  assert.equal(workerHeartbeatHealth(valid, options).healthy, true);
  for (const report of [null, { ...valid, at: undefined }, { ...valid, at: 'invalid' }, { ...valid, at: new Date(now + 1).toISOString() }, { ...valid, at: new Date(now - 90_001).toISOString() }, { ...valid, cluster: 'mainnet-beta' }, { ...valid, status: 'failed' }]) {
    const checked = workerHeartbeatHealth(report, options);
    assert.equal(checked.healthy, false);
    assert(checked.reasons.length);
  }
  assert.equal(workerHeartbeatHealth(valid, { ...options, maxAgeMs: NaN }).healthy, false);
});

test('a new failed worker pass immediately replaces a previously healthy heartbeat', () => {
  const previous = { status: 'ready', cluster: 'devnet', at };
  assert.equal(workerHeartbeatHealth(previous, { now }).healthy, true);
  for (const quotaExhausted of [false, true]) {
    const failure = workerFailureReport({ quotaExhausted, now });
    assert.equal(workerHeartbeatHealth(failure, { now }).healthy, false);
    assert.equal(rewardServiceHealth(rewardWorkerFailureStatus({ quotaExhausted, now }), now).healthy, false);
  }
});

test('receipt workers cannot pass health checks with fabricated time evidence', () => {
  const valid = { owner: null, expiresAt: 0, lastRun: { status: 'pass-finished', startedAt: at, finishedAt: at } };
  assert.equal(receiptWorkerStatus(valid, { now }).status, 'pass-finished');
  for (const lastRun of [{ status: 'pass-finished' }, { status: 'pass-finished', finishedAt: 'invalid' }, { status: 'pass-finished', startedAt: at }, { status: 'pass-finished', startedAt: at, finishedAt: 'invalid' }, { status: 'pass-finished', startedAt: new Date(now + 1).toISOString(), finishedAt: at }, { status: 'pass-finished', finishedAt: new Date(now + 1).toISOString() }]) {
    assert.equal(receiptWorkerStatus({ ...valid, lastRun }, { now }).status, 'invalid-heartbeat');
  }
  assert.equal(receiptWorkerStatus({ ...valid, owner: 'worker', expiresAt: Infinity }, { now }).status, 'invalid-heartbeat');
  assert.equal(receiptWorkerStatus(valid, { now: now + 300001 }).status, 'stale');
});

test('holder indexer rejects another network before reading accounts or persisting rewards snapshots', async () => {
  let reads = 0, writes = 0;
  const indexer = createHolderHistoryIndexer({ expectedGenesisHash: 'expected-devnet', connection: {
    getGenesisHash: async () => 'wrong-network', getAccountInfo: async () => { reads += 1; },
  }, store: { transaction: async () => { writes += 1; } } });
  await assert.rejects(indexer.capture('11111111111111111111111111111111'), /network does not match/);
  assert.equal(reads, 0); assert.equal(writes, 0);
});

test('holder indexer checks network identity on every capture rather than caching readiness', async () => {
  let calls = 0;
  const indexer = createHolderHistoryIndexer({ expectedGenesisHash: 'expected-devnet', connection: {
    getGenesisHash: async () => ++calls === 1 ? 'expected-devnet' : 'wrong-network',
    getAccountInfo: async () => null,
  }, store: { transaction: async () => assert.fail('No incomplete snapshot should persist') } });
  await assert.rejects(indexer.capture('11111111111111111111111111111111'), /does not exist/);
  await assert.rejects(indexer.capture('11111111111111111111111111111111'), /network does not match/);
  assert.equal(calls, 2);
});
