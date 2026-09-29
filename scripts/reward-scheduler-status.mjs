import { resolve } from 'node:path';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { rewardServiceHealth } from '../server/reward-service-health.mjs';

const store = createAutomaticRewardStore(process.env.AUTOMATIC_REWARD_STORE_PATH || resolve(process.cwd(), 'data', 'automatic-rewards.json'));
const state = await store.read(), service = state.serviceStatus || {};
const worker = rewardServiceHealth(service);
const schedules = Object.values(state.schedules || {});
const blockedSchedules = schedules.filter(row => row.status === 'blocked').length;
const result = { ...worker, workerHealthy:worker.healthy, healthy:worker.healthy && blockedSchedules === 0,
  blockedSchedules, reasons:blockedSchedules ? [...worker.reasons, 'blocked-reward-schedules'] : worker.reasons,
  activePrograms: Object.values(state.programs || {}).filter(row => row.enabled).length,
  recentSchedules: schedules.sort((a, b) => b.periodStart - a.periodStart).slice(0, 10).map(row => ({ id:row.id, status:row.status, reason:row.reason || null })) };
console.log(JSON.stringify(result));
if (process.argv.includes('--check') && !result.healthy) process.exitCode = 1;
