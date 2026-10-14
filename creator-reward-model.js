const amount = value => {
  if (!/^(0|[1-9]\d*)$/.test(String(value))) throw new Error('Invalid reward amount');
  return BigInt(value);
};

export function verifiedV3CreatorLaunch(launch, wallet, cluster) {
  return Boolean(wallet && launch?.onchainVerified === true && launch.cluster === cluster
    && launch.creatorWallet === wallet && launch.mint
    && launch.pumpFeeRoute?.scope === 'per-mint-v3'
    && launch.pumpFeeRoute.router === launch.creator
    && launch.pumpFeeRoute.programId);
}

export function creatorRewardRow(launch, activity, wallet, cluster) {
  const overview = activity?.overview;
  if (!verifiedV3CreatorLaunch(launch, wallet, cluster)
    || activity?.mint !== launch.mint || activity.cluster !== cluster
    || !overview?.available || overview.scope !== 'per-mint-v3'
    || overview.creatorWallet !== wallet || !Array.isArray(overview.collections)) {
    throw new Error('Creator reward verification unavailable');
  }
  let unclaimed = 0n, paid = 0n, pendingSettlementCount = 0;
  for (const collection of overview.collections) {
    if (collection.settlement !== 'finalized') {
      pendingSettlementCount += 1;
      continue;
    }
    const plan = collection.allocationPlan;
    if (plan?.status !== 'allocated-not-funded' || plan.mint !== launch.mint
      || plan.sourceCollectionSignature !== collection.signature
      || plan.programId !== launch.pumpFeeRoute.programId) {
      throw new Error('V3 creator allocation verification incomplete');
    }
    const allocated = amount(plan.creatorDirected?.walletLamports);
    if (collection.creatorWalletPayoutVerified === true) paid += allocated;
    else unclaimed += allocated;
  }
  const ready = unclaimed > 0n && overview.gates?.creatorWalletPayout === true;
  return { mint:launch.mint, name:launch.symbol || launch.name || launch.mint.slice(0,8), fullName:launch.name || launch.symbol || launch.mint, overview,
    unclaimed, paid, available:unclaimed, pendingSettlementCount, ready,
    status:ready ? 'Ready for V3 payout' : unclaimed > 0n ? 'Payout unavailable'
      : pendingSettlementCount ? 'Settlement pending' : paid > 0n ? 'Recorded paid' : 'No creator allocation' };
}

export function filterCreatorRewards(rows, { filter = 'active', query = '' } = {}) {
  const search = query.trim().toLowerCase();
  return rows.filter(row => (filter === 'all' || row.unclaimed > 0n || row.pendingSettlementCount > 0)
    && (!search || `${row.name} ${row.fullName} ${row.mint}`.toLowerCase().includes(search)))
    .sort((a,b) => Number(b.ready) - Number(a.ready) || (a.available === b.available ? a.name.localeCompare(b.name) : a.available > b.available ? -1 : 1));
}
