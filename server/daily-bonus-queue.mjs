import { DEFAULT_BONUS_SCHEDULE, currentBonusStart, bonusWindowKey, bonusWindow } from './daily-bonus-schedule.mjs';
export function dailyBonusWork({ app, ledger, now, limit = 3, schedule = DEFAULT_BONUS_SCHEDULE }) {
  const timestamps = Object.values(app.launches || {}).filter(row => row.cluster === 'devnet'
    && row.onchainVerified === true && row.feeDistribution?.fixedFunded?.communityRewards?.dailyBonus?.version === 1
    && (!schedule.mints || schedule.mints.includes(row.mint))
    && Number.isSafeInteger(row.createdTimestamp) && row.createdTimestamp > 0).map(row => row.createdTimestamp);
  if (!timestamps.length) return { missing:[], pending:[], eligible:false };
  const snapshots = ledger.dailyBonusSnapshots || {}, period = schedule.periodSeconds;
  const first = currentBonusStart(Math.min(...timestamps),schedule);
  const missing = [];
  for (let time = first; time < currentBonusStart(now,schedule); time += period) {
    const day = bonusWindowKey(time,schedule);
    const row = snapshots[day];
    if (!row || row.evidenceCoverageVersion !== 1 && row.status !== 'reconciliation-required') missing.push(day);
  }
  const pending = Object.entries(snapshots).filter(([day,row]) => {
    try { bonusWindow(day,now); } catch { return false; }
    return (period !== 300 || day.startsWith('qa5m:')) && row.status === 'snapshotted'
      && row.snapshot.sources.some(source => source.allocations.length && row.payouts?.[source.collectionSignature]?.status !== 'paid');
  }).map(([day])=>day).sort();
  const cursor = ledger.dailyBonusWorkCursor;
  const ordered = cursor ? [...pending.filter(day => day > cursor), ...pending.filter(day => day <= cursor)] : pending;
  const captureCursor = ledger.dailyBonusCaptureCursor;
  const missingOrder = captureCursor ? [...missing.filter(day => day > captureCursor), ...missing.filter(day => day <= captureCursor)] : missing;
  return { missing:missingOrder.slice(0,limit), pending:ordered.slice(0,limit), eligible:true };
}
