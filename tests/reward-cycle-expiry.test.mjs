import test from 'node:test';
import assert from 'node:assert/strict';
import { createRewardScheduler, unpayableCycleSchedule } from '../server/reward-scheduler.mjs';
import { rewardCycleExpiryGraceSeconds } from '../server/automatic-reward-chain.mjs';

const leaves = [{ recipient: 'pool', amount: '40', index: 0 }, { recipient: 'holder', amount: '60', index: 1 }];
const blocked = { id: 's1', mint: 'm', kind: 'holder', status: 'blocked', cycle: 'c', payoutAt: 1000, manifest: { leaves },
  reason: 'Holder manifest contains a protocol-owned vault or PumpSwap liquidity pool; reconcile before payout.',
  payments: { holder: { status: 'paid' }, pool: { status: 'verification-pending', reason: 'TokenOwnerOffCurveError' } } };

test('only cycles that can never be fully paid are expirable', () => {
  assert.equal(unpayableCycleSchedule(blocked), true);
  assert.equal(unpayableCycleSchedule({ ...blocked, status: 'distributing', reason: null }), true, 'every unpaid leaf is off-curve');
  assert.equal(unpayableCycleSchedule({ ...blocked, status: 'distributing', reason: null,
    payments: { ...blocked.payments, pool: { status: 'verification-pending', reason: 'RPC timeout' } } }), false, 'transient failures retry');
  assert.equal(unpayableCycleSchedule({ ...blocked, cycle: null }), false, 'nothing committed on-chain');
  assert.equal(unpayableCycleSchedule({ ...blocked, status: 'blocked', reason: 'Holder opening snapshot gap exceeds the configured sampling interval.', payments: {} }), false);
});

test('grace matches the program build per cluster', () => {
  assert.equal(rewardCycleExpiryGraceSeconds('devnet'), 600);
  assert.equal(rewardCycleExpiryGraceSeconds('mainnet-beta'), 30 * 86400);
});

function harness() {
  let state = { schedules: { s1: structuredClone(blocked) } };
  const store = { transaction: async fn => { const next = structuredClone(state); const out = fn(next); state = next; return structuredClone(out); }, read: async () => structuredClone(state) };
  const calls = [];
  const chain = { cycleExpiryGraceSeconds: 600, readiness: async () => ({ constrainedPayouts: true, reasons: [] }),
    expireCycle: async row => { calls.push(row.id); return { signature: 'sig', unpaidAmount: '40' }; } };
  return { scheduler: createRewardScheduler({ store, chain, indexer: {} }), calls, get state() { return state; } };
}

test('an unpayable cycle is expired once after the grace period, never before', async () => {
  const h = harness();
  await h.scheduler.execute(1000 + 599);
  assert.deepEqual(h.calls, []);
  await h.scheduler.execute(1000 + 600);
  assert.deepEqual(h.calls, ['s1']);
  assert.equal(h.state.schedules.s1.status, 'expired');
  assert.equal(h.state.schedules.s1.expiredUnpaidAmount, '40');
  await h.scheduler.execute(5000);
  assert.deepEqual(h.calls, ['s1'], 'expired is terminal');
});
