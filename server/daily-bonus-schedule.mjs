import { PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';

export const DEFAULT_BONUS_SCHEDULE = Object.freeze({ periodSeconds:86400, mode:'daily', mints:null });
export function bonusSchedule({ cluster, env = process.env }) {
  const period = String(env.FUNDED_DEVNET_QA_BONUS_PERIOD_SECONDS || '86400');
  if (period === '86400') return DEFAULT_BONUS_SCHEDULE;
  if (cluster !== 'devnet' || env.FUNDED_DEVNET_QA_MINIMUMS_ENABLED !== 'true' || period !== '300')
    throw new Error('Five-minute bonus snapshots require explicit Devnet QA configuration.');
  const mints = [...new Set(String(env.FUNDED_DEVNET_QA_BONUS_MINTS || '').split(',').map(row=>row.trim()).filter(Boolean))];
  if (!mints.length || mints.length > 8) throw new Error('Select one to eight disposable QA bonus mints.');
  for (const mint of mints) if (new PublicKey(mint).toBase58() !== mint) throw new Error('Invalid QA bonus mint.');
  return Object.freeze({ periodSeconds:300, mode:'devnet-qa-5m', mints:Object.freeze(mints),
    cohort:createHash('sha256').update([...mints].sort().join(',')).digest('hex').slice(0,12) });
}
export function bonusWindowKey(start, schedule = DEFAULT_BONUS_SCHEDULE) {
  return schedule.periodSeconds === 300 ? `qa5m:${new Date(start * 1000).toISOString().replace('.000Z','Z')}${schedule.cohort ? '@'+schedule.cohort : ''}`
    : new Date(start * 1000).toISOString().slice(0,10);
}
export function bonusWindow(day, now = Math.floor(Date.now()/1000)) {
  const qa = /^qa5m:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z(?:@[a-f0-9]{12})?$/.test(String(day));
  if (!qa && !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error('A UTC day or namespaced five-minute QA window is required.');
  const cohort = qa ? day.split('@')[1] : null;
  const period = qa ? 300 : 86400, start = Date.parse(qa ? day.slice(5).split('@')[0] : `${day}T00:00:00Z`)/1000;
  if (!Number.isSafeInteger(start) || start % period || bonusWindowKey(start,{periodSeconds:period,cohort}) !== day || start + period > now)
    throw new Error(qa ? 'A completed five-minute QA window is required.' : 'A completed UTC day is required.');
  return { day, start, end:start + period, ...(qa ? { periodSeconds:period, qa:true } : {}), ...(cohort ? {cohort} : {}) };
}
export const currentBonusStart = (now, schedule = DEFAULT_BONUS_SCHEDULE) => Math.floor(now / schedule.periodSeconds) * schedule.periodSeconds;
export const latestBonusDay = (now = Math.floor(Date.now()/1000), schedule = DEFAULT_BONUS_SCHEDULE) => bonusWindowKey(currentBonusStart(now,schedule) - schedule.periodSeconds,schedule);
export const publicBonusSchedule = schedule => ({ periodSeconds:schedule.periodSeconds, mode:schedule.mode,
  ...(schedule.mints ? { mints:schedule.mints, cohort:schedule.cohort } : {}) });
