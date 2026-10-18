import { latestBonusDay } from './daily-bonus.mjs';
export function dailyBonusWork({ app, ledger, now, limit = 3 }) {
  const timestamps = Object.values(app.launches || {}).filter(row => row.cluster === 'devnet'
    && row.onchainVerified === true && row.feeDistribution?.fixedFunded?.communityRewards?.dailyBonus?.version === 1
    && Number.isSafeInteger(row.createdTimestamp) && row.createdTimestamp > 0).map(row => row.createdTimestamp);
  if (!timestamps.length) return { missing:[], pending:[], eligible:false };
  const latest = latestBonusDay(now), snapshots = ledger.dailyBonusSnapshots || {};
  const first = Math.floor(timestamps.reduce((earliest,time) => Math.min(earliest,time), timestamps[0]) / 86400) * 86400;
  const missing = [];
  for (let time = first; time < now - now % 86400; time += 86400) {
    const day = new Date(time * 1000).toISOString().slice(0,10);
    const row = snapshots[day];
    if (day <= latest && (!row || row.evidenceCoverageVersion !== 1 && row.status !== 'reconciliation-required')) missing.push(day);
  }
  const pending = Object.entries(snapshots).filter(([day, row]) => day <= latest && row.status === 'snapshotted'
    && row.snapshot.sources.some(source => source.allocations.length
      && row.payouts?.[source.collectionSignature]?.status !== 'paid')).map(([day]) => day).sort();
  const cursor = ledger.dailyBonusWorkCursor;
  const ordered = cursor ? [...pending.filter(day => day > cursor), ...pending.filter(day => day <= cursor)] : pending;
  const captureCursor = ledger.dailyBonusCaptureCursor;
  const missingOrder = captureCursor ? [...missing.filter(day => day > captureCursor), ...missing.filter(day => day <= captureCursor)] : missing;
  return { missing:missingOrder.slice(0,limit), pending:ordered.slice(0,limit), eligible:true };
}
