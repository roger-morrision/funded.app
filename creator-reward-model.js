const amount = value => {
  if (!/^(0|[1-9]\d*)$/.test(String(value))) throw new Error('Invalid reward amount');
  return BigInt(value);
};

export function creatorRewardRow(launch, activity, wallet, cluster) {
  const overview = activity?.overview;
  if (!wallet || !launch?.onchainVerified || launch.cluster !== cluster || launch.creatorWallet !== wallet
    || activity?.mint !== launch.mint || activity.cluster !== cluster || !overview?.available || overview.creatorWallet !== wallet) {
    throw new Error('Creator reward verification unavailable');
  }
  let receiver = overview.receivers?.find(row => row.id === 'creator' && row.recipient === wallet);
  const claim = overview.creatorClaim;
  // A launch may allocate its entire creator share to holders or an X account.
  if (!receiver && Array.isArray(overview.receivers) && !overview.receivers.some(row => row.id === 'creator') && claim?.claimableLamports === '0') {
    receiver = { withoutConfirmedPayoutLamports:'0', confirmedPaidLamports:'0' };
  }
  if (!receiver || !claim) throw new Error('Creator reward verification incomplete');
  const unclaimed = amount(receiver.withoutConfirmedPayoutLamports), paid = amount(receiver.confirmedPaidLamports);
  const available = amount(claim.claimableLamports), minimum = amount(claim.minimumLamports);
  if (available > unclaimed || minimum <= 0n) throw new Error('Creator reward amounts inconsistent');
  const ready = claim.eligible === true && available >= minimum;
  return { mint:launch.mint, name:launch.symbol || launch.name || launch.mint.slice(0,8), fullName:launch.name || launch.symbol || launch.mint, overview,
    unclaimed, paid, available, minimum, ready,
    status:ready ? 'Ready to claim' : unclaimed > available ? 'Payment processing'
      : available > 0n ? 'Below claim minimum' : 'No rewards ready' };
}

export function filterCreatorRewards(rows, { filter = 'active', query = '' } = {}) {
  const search = query.trim().toLowerCase();
  return rows.filter(row => (filter === 'all' || row.unclaimed > 0n)
    && (!search || `${row.name} ${row.fullName} ${row.mint}`.toLowerCase().includes(search)))
    .sort((a,b) => Number(b.ready) - Number(a.ready) || (a.available === b.available ? a.name.localeCompare(b.name) : a.available > b.available ? -1 : 1));
}
