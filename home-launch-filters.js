export const HOME_FILTER_FLAGS = ['curve', 'migrated', 'mintRevoked', 'freezeRevoked', 'social', 'promoted', 'holderFees', 'airdrop'];
export const HOME_FILTER_RANGES = ['ageHours', 'marketCapUsd', 'reserveUsd', 'volumeUsd', 'trades', 'collectedCreatorFeesSol', 'holders', 'topTenHolderPercent', 'devHoldingPercent'];

export function emptyHomeLaunchFilters() {
  return { query: '', flags: [], ranges: Object.fromEntries(HOME_FILTER_RANGES.map(name => [name, { min: null, max: null }])) };
}

export function normalizeHomeLaunchFilters(value) {
  const filters = emptyHomeLaunchFilters();
  filters.query = String(value?.query || '').trim().slice(0, 100);
  filters.flags = HOME_FILTER_FLAGS.filter(name => Array.isArray(value?.flags) && value.flags.includes(name));
  for (const name of HOME_FILTER_RANGES) {
    for (const bound of ['min', 'max']) {
      const raw = value?.ranges?.[name]?.[bound];
      const number = raw == null || raw === '' ? NaN : Number(raw);
      filters.ranges[name][bound] = Number.isFinite(number) && number >= 0 ? number : null;
    }
  }
  return filters;
}

export function homeLaunchFilterCount(value) {
  const filters = normalizeHomeLaunchFilters(value);
  return Number(Boolean(filters.query)) + filters.flags.length
    + HOME_FILTER_RANGES.reduce((count, name) => count + Number(filters.ranges[name].min != null) + Number(filters.ranges[name].max != null), 0);
}

const observed = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const bounded = (value, range, lowerBoundOnly = false) => {
  if (range.min == null && range.max == null) return true;
  if (value == null) return false;
  if (range.min != null && value < range.min) return false;
  if (range.max != null && (lowerBoundOnly || value > range.max)) return false;
  return true;
};

export function matchesHomeLaunchFilters(item, value, { cluster = 'devnet', solUsdPrice = null, nowMs = Date.now() } = {}) {
  const filters = normalizeHomeLaunchFilters(value);
  const query = filters.query.toLowerCase();
  if (query && !`${item.name || ''} ${item.symbol || ''} ${item.address || ''}`.toLowerCase().includes(query)) return false;

  const flags = new Set(filters.flags);
  if ((flags.has('curve') || flags.has('migrated'))
    && !(flags.has('curve') && item.complete === false && item.migrated !== true)
    && !(flags.has('migrated') && item.migrated === true)) return false;
  if (flags.has('mintRevoked') && item.mintAuthorityRevoked !== true) return false;
  if (flags.has('freezeRevoked') && item.freezeAuthorityRevoked !== true) return false;
  if (flags.has('social') && ![item.website, item.twitter, item.telegram, item.discord, item.x].some(Boolean)) return false;
  if (flags.has('promoted') && !['boost', 'pro', 'premier'].includes(item.promotionTier)) return false;
  if (flags.has('holderFees') && !(item.holderFeePercent > 0)) return false;
  if (flags.has('airdrop') && !(item.communityAirdropPercent > 0)) return false;

  const created = observed(item.createdTimestamp);
  const createdMs = created == null ? null : created > 10_000_000_000 ? created : created * 1000;
  const ageHours = createdMs != null && createdMs > 0 && createdMs <= nowMs ? (nowMs - createdMs) / 3_600_000 : null;
  if (!bounded(ageHours, filters.ranges.ageHours)) return false;

  const quote = observed(solUsdPrice);
  const capSol = observed(item.migrated === true ? item.poolMarketCapSol : item.curveCapSol);
  const reserveSol = observed(item.migrated === true ? item.poolReserveSol : item.curveReserveSol);
  const capUsd = cluster === 'devnet' ? capSol != null && quote != null ? capSol * quote : null : observed(item.marketCapUsd);
  const reserveUsd = cluster === 'devnet' ? reserveSol != null && quote != null ? reserveSol * quote : null : observed(item.liquidityUsd);
  const volumeSol = observed(item.windowVolumeSol);
  const volumeUsd = cluster === 'devnet' ? volumeSol != null && quote != null ? volumeSol * quote : null : observed(item.volume24hUsd);
  const trades = observed(cluster === 'devnet' ? item.windowTradeCount : item.tradeCount24h);
  const indexedHolders = observed(item.holders);
  const sampledHolders = observed(item.holderWalletCount);
  const holders = indexedHolders ?? sampledHolders;
  const holdersAreLowerBound = indexedHolders == null && item.holderWalletCoverage === 'lower-bound';
  if (!bounded(capUsd, filters.ranges.marketCapUsd) || !bounded(reserveUsd, filters.ranges.reserveUsd)) return false;
  if (!bounded(volumeUsd, filters.ranges.volumeUsd, item.windowCoverage === 'partial')
    || !bounded(trades, filters.ranges.trades, item.windowCoverage === 'partial')) return false;
  if (!bounded(holders, filters.ranges.holders, holdersAreLowerBound)) return false;
  if (!bounded(observed(item.collectedCreatorFeesSol), filters.ranges.collectedCreatorFeesSol)) return false;
  if (!bounded(observed(item.topTenHolderPercent), filters.ranges.topTenHolderPercent)
    || !bounded(observed(item.devHoldingPercent), filters.ranges.devHoldingPercent)) return false;
  return true;
}
