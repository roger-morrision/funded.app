import { validXId, validMint, normalizeCreatorHandle } from '../creator-support-model.js';

export function eligibleSupportLaunches(state, cluster) {
  return Object.values(state.launches || {}).filter(launch => launch.onchainVerified === true && launch.cluster === cluster
    && validXId(launch.xUserId) && validMint(launch.mint) && launch.policySignature
    && launch.pumpFeeRoute?.verified === true && launch.pumpFeeRoute?.scope === 'per-mint-v2'
    && launch.pumpFeeRoute.router === launch.creator
    && Number(launch.feeDistribution?.creatorDirected?.shares?.solClaimPercent) > 0);
}

export function creatorDirectoryRecords(state, cluster) {
  const byId = new Map();
  // Stable mint order gives identical fallback identity on file and PostgreSQL stores.
  for (const launch of eligibleSupportLaunches(state, cluster).sort((a,b) => a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0)) {
    const id = String(launch.xUserId);
    const row = byId.get(id) || { id, handle: launch.feeDistribution.creatorDirected.recipients?.xAccount, coinCount: 0 };
    row.coinCount++; byId.set(id, row);
  }
  for (const [id, profile] of Object.entries(state.creatorProfiles || {})) {
    if (validXId(id) && profile.listed && profile.identityVerified && !profile.optedOut && !byId.has(id)) byId.set(id, { id, coinCount: 0 });
  }
  const records = [];
  for (const [id, row] of byId) {
    const profile = state.creatorProfiles?.[id];
    if (profile?.optedOut) continue;
    try {
      const handle = normalizeCreatorHandle(profile?.handle || row.handle);
      records.push({ id, handle, name: profile?.name || handle, identityVerified: profile?.identityVerified === true, coinCount: row.coinCount });
    } catch { /* Invalid handles are never advertised. */ }
  }
  return records.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function directoryPage(records, { after = '', query = '', follows = [] } = {}) {
  const matches = records.filter(row => (!after || row.id > after) && (!follows.length || follows.includes(row.id))
    && `${row.handle} ${row.name}`.toLowerCase().includes(query));
  const creators = matches.slice(0,50);
  return { creators, limit: 50, nextCursor: matches.length > 50 ? creators.at(-1).id : null };
}
