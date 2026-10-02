import assert from 'node:assert/strict';
import test from 'node:test';
import { rewardServiceHealth } from '../server/reward-service-health.mjs';
import { automaticRewardStatus } from '../server/automatic-rewards.mjs';

test('a fresh readiness report with a blocking reason remains unavailable', () => {
  const now = Date.parse('2026-10-01T07:00:00.000Z');
  const serviceStatus = { checkedAt:new Date(now).toISOString(), constrainedPayouts:true, reasons:['rpc-unavailable'] };
  assert.deepEqual(rewardServiceHealth(serviceStatus, now), {
    healthy:false, checkedAt:serviceStatus.checkedAt, ageSeconds:0, reasons:['rpc-unavailable'],
  });
  assert.equal(automaticRewardStatus(new Date(now), { serviceStatus }).status, 'unavailable');
});
