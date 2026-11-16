import test from 'node:test';
import assert from 'node:assert/strict';
import { rewardHeartbeat } from '../server/reward-heartbeat.mjs';

function harness(ready) {
  let state = {};
  const store = { transaction: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const chain = { readiness: async () => ready() };
  return { scheduler: { heartbeat: at => rewardHeartbeat({ store, chain }, at) }, get state() { return state; }, set: value => { state = value; } };
}

test('heartbeat refreshes a healthy status, keeps indexing failures, and records chain failures', async () => {
  let ok = true;
  const h = harness(() => ok ? { constrainedPayouts: true, reasons: [] } : { constrainedPayouts: false, reasons: ['router-authority-mismatch'] });
  h.set({ serviceStatus: { constrainedPayouts: true, reasons: [], reason: null, checkedAt: '2026-11-16T00:00:00.000Z' } });
  await h.scheduler.heartbeat(new Date('2026-11-16T00:05:00Z'));
  assert.equal(h.state.serviceStatus.checkedAt, '2026-11-16T00:05:00.000Z');
  h.set({ serviceStatus: { constrainedPayouts: false, reasons: ['finalized-holder-indexing-unavailable:m'], checkedAt: '2026-11-16T00:00:00.000Z' } });
  await h.scheduler.heartbeat(new Date('2026-11-16T00:06:00Z'));
  assert.deepEqual(h.state.serviceStatus.reasons, ['finalized-holder-indexing-unavailable:m'], 'an indexing failure is not hidden');
  assert.equal(h.state.serviceStatus.checkedAt, '2026-11-16T00:00:00.000Z');
  ok = false;
  h.set({ serviceStatus: { constrainedPayouts: true, reasons: [], checkedAt: '2026-11-16T00:00:00.000Z' } });
  await h.scheduler.heartbeat(new Date('2026-11-16T00:07:00Z'));
  assert.equal(h.state.serviceStatus.constrainedPayouts, false);
  assert.deepEqual(h.state.serviceStatus.reasons, ['router-authority-mismatch']);
});
