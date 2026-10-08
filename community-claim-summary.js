// Sum token quantities across launches, never their planned allocations or USD value.
export function communityClaimSummary(launches, reserves, { launchesReady, reservesReady }) {
  const unavailable = { amount: '—', projects: null, state: 'unavailable', note: 'Confirmed claim totals unavailable' };
  if (!launchesReady || !reservesReady) return unavailable;
  const projects = new Map(launches.filter(row => row?.onchainVerified && row.mint
    && Number.isSafeInteger(row.communityAirdrop?.reservedTokens) && row.communityAirdrop.reservedTokens > 0)
    .map(row => [row.mint, row]));
  let microTokens = 0n, claimedProjects = 0, checkedProjects = 0;
  for (const [mint, launch] of projects) {
    const reserve = reserves.get(mint);
    if (reserve?.verified !== true || Number(reserve.reservedTokens) !== launch.communityAirdrop.reservedTokens) continue;
    if (reserve.status === 'funded') { checkedProjects += 1; continue; }
    if (!['drop-active', 'drop-closed'].includes(reserve.status)
      || !/^\d+$/.test(String(reserve.claimedBaseUnits)) || !/^\d+$/.test(String(reserve.totalBaseUnits))) continue;
    const claimed = BigInt(reserve.claimedBaseUnits), total = BigInt(reserve.totalBaseUnits);
    if (total <= 0n || claimed > total) continue;
    checkedProjects += 1;
    if (claimed > 0n) claimedProjects += 1;
    microTokens += claimed * BigInt(launch.communityAirdrop.reservedTokens) * 1_000_000n / total;
  }
  if (projects.size && !checkedProjects) return unavailable;
  const partial = checkedProjects < projects.size;
  const whole = (microTokens / 1_000_000n).toLocaleString('en-US');
  const fraction = String(microTokens % 1_000_000n).padStart(6, '0').replace(/0+$/, '');
  return {
    amount: `${partial ? '≥' : ''}${whole}${fraction ? `.${fraction}` : ''}`,
    projects: claimedProjects,
    state: partial ? 'partial' : claimedProjects ? 'available' : 'empty',
    note: partial
      ? `Confirmed claims from ${claimedProjects} projects · claim data available for ${checkedProjects} of ${projects.size} projects`
      : 'Tokens received by claimants / projects with confirmed claims',
  };
}

export function communityClaimUnit(summary) {
  return `tokens / ${summary.projects == null ? '—' : summary.projects.toLocaleString('en-US')} ${summary.projects === 1 ? 'project' : 'projects'}`;
}
