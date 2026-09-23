// Versioned separately from existing immutable launch policies.
export const AUTOMATIC_REWARDS = Object.freeze({
  version: 2, holderAsset: 'SOL', periodSeconds: 86400, sampleIntervalSeconds: 300,
  cutoffUtc: '00:00 UTC', payoutUtc: '01:00 UTC',
  minimumLamports: '10000000', referralDelivery: 'manual-claim',
  holderDelivery: 'automatic', airdropAsset: 'launched-token',
  airdropEligibility: '$FUNDED', feeBudget: 'operations',
});

export function distributionClock(schedule, now = Date.now()) {
  if (!schedule || schedule.status === 'unavailable') return { label: 'Not scheduled', remaining: null };
  if (schedule.status === 'waiting-migration') return { label: 'Waiting for migration', remaining: null };
  if (['paid', 'delayed', 'distributing', 'blocked', 'skipped'].includes(schedule.status)) {
    return { label: { paid: 'Paid', delayed: 'Delayed', distributing: 'Distributing', blocked: 'Distribution blocked', skipped: 'Reward period skipped' }[schedule.status], remaining: null };
  }
  const cutoff = Date.parse(schedule.cutoffAt), payout = Date.parse(schedule.payoutAt);
  if (!Number.isFinite(cutoff) || !Number.isFinite(payout) || payout < cutoff) return { label: 'Schedule unavailable', remaining: null };
  if (now >= payout) return { label: 'Delayed · awaiting payment confirmation', remaining: null };
  if (now >= cutoff) return { label: schedule.status === 'indexing' ? 'Cutoff reached · finalizing holder history' : schedule.status === 'prepared' ? 'Distribution prepared · payout in' : 'Calculating allocations · next payout', remaining: Math.ceil((payout - now) / 1000) };
  return { label: 'Reward period closes in', remaining: Math.ceil((cutoff - now) / 1000) };
}

export function countdownText(seconds) {
  if (seconds == null) return '—';
  if (!Number.isFinite(Number(seconds))) return '—';
  const value = Math.max(0, Math.floor(seconds));
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(n => String(n).padStart(2, '0')).join(':');
}

function units(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Amounts must be unsigned integer strings.');
  return BigInt(value);
}

// Each complete snapshot describes balances until the next snapshot. The indexer
// must supply every balance change, including an opening and closing boundary.
export function holdingWeights({ start, end, snapshots, excludedWallets = [], coverage }) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) throw new Error('Invalid reward period.');
  if (!['complete-finalized', 'finalized-sampled-v1'].includes(coverage) || !Array.isArray(snapshots) || snapshots.length < 2) throw new Error('Finalized holder history is required.');
  if (snapshots[0].at !== start || snapshots.at(-1).at !== end) throw new Error('Holder history must cover both period boundaries.');
  const excluded = new Set(excludedWallets), weights = new Map();
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    if (!Number.isSafeInteger(snapshot.at) || (i > 0 && snapshot.at <= snapshots[i - 1].at)) throw new Error('Snapshots must be strictly ordered.');
    const duration = i === snapshots.length - 1 ? 0n : BigInt(snapshots[i + 1].at - snapshot.at);
    const accounts = new Set();
    for (const row of snapshot.accounts) {
      if (!row.account || !row.wallet || accounts.has(row.account)) throw new Error('Duplicate or missing holder account.');
      accounts.add(row.account);
      const balance = units(row.balance);
      if (!excluded.has(row.wallet)) weights.set(row.wallet, (weights.get(row.wallet) || 0n) + balance * duration);
    }
  }
  return [...weights].filter(([, weight]) => weight > 0n).sort(([a], [b]) => a.localeCompare(b)).map(([wallet, weight]) => ({ wallet, weight: String(weight) }));
}

// Dust is explicitly retained for the next pool, never silently awarded to a wallet.
export function allocateHolderPool(poolLamports, weights) {
  const pool = units(poolLamports), seen = new Set();
  const parsed = weights.map(row => {
    if (!row.wallet || seen.has(row.wallet)) throw new Error('Duplicate or missing recipient.');
    seen.add(row.wallet);
    return { wallet: row.wallet, weight: units(row.weight) };
  });
  const total = parsed.reduce((sum, row) => sum + row.weight, 0n);
  const allocations = parsed.map(row => ({ wallet: row.wallet, amountLamports: String(total ? pool * row.weight / total : 0n) })).filter(row => row.amountLamports !== '0');
  return { allocations, remainderLamports: String(pool - allocations.reduce((sum, row) => sum + BigInt(row.amountLamports), 0n)) };
}
