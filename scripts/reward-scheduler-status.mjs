import { resolve } from 'node:path';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';

const store = createAutomaticRewardStore(process.env.AUTOMATIC_REWARD_STORE_PATH || resolve(process.cwd(), 'data', 'automatic-rewards.json'));
const state = await store.read(), service = state.serviceStatus || {};
const ageMs = service.checkedAt ? Date.now() - Date.parse(service.checkedAt) : Infinity;
const result = { healthy: service.constrainedPayouts === true && ageMs >= 0 && ageMs <= 180_000, checkedAt: service.checkedAt || null, ageSeconds: Number.isFinite(ageMs) ? Math.floor(ageMs / 1000) : null, reasons: service.reasons || ['worker-has-not-reported-readiness'], activePrograms: Object.values(state.programs || {}).filter(row => row.enabled).length, recentSchedules: Object.values(state.schedules || {}).sort((a, b) => b.periodStart - a.periodStart).slice(0, 10).map(row => ({ id:row.id, status:row.status, reason:row.reason || null })) };
console.log(JSON.stringify(result));
if (process.argv.includes('--check') && !result.healthy) process.exitCode = 1;
