import {verifiedPromotionBadge} from '../../../promotion-badge.js';
import {activeBoostMultiplier,activeBoostPackages} from '../../../boost-offer.js';
import {withMarketWindow} from '../../../market-intelligence.js';

const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const nonnegative = value => { const n = number(value); return n != null && n >= 0 ? n : null; };
export function top100Records(assets, {boosts = {}, solUsd = null, policies = [], cluster = 'devnet', now = Date.now()} = {}) {
  const rate = number(solUsd), unique = new Map();
  const launches = new Map(policies.filter(row => row.onchainVerified === true && row.cluster === cluster).map(row => [row.mint,row]));
  for (const asset of assets) {
    const mint = asset.address || asset.mint;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || '')) continue;
    const market = withMarketWindow(asset, '24h');
    const capSol = asset.complete === true ? nonnegative(asset.poolMarketCapSol) : nonnegative(asset.curveCapSol);
    const capUsd = capSol != null && rate > 0 ? capSol * rate : nonnegative(asset.marketCapUsd);
    const volume = market.windowVolumeSol;
    const activityFresh = Number.isFinite(asset.marketActivityObservedAt) && now - asset.marketActivityObservedAt >= 0 && now - asset.marketActivityObservedAt < 300_000;
    const created = number(asset.createdTimestamp);
    const createdMs = created > 0 ? created * (created < 10_000_000_000 ? 1000 : 1) : null;
    const policy = launches.get(mint), promotion = verifiedPromotionBadge(policy);
    const paidListing = asset.listingPayment?.verified === true && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(asset.listingPayment.signature || '');
    const boost = activeBoostMultiplier(boosts[mint], now), packs = activeBoostPackages(boosts[mint], now);
    const expiries = packs.map(pack => Date.parse(pack.expiresAt));
    const boostNextExpiry = boost > 0 ? expiries.length ? Math.min(...expiries) : Date.parse(boosts[mint].nextExpiry || boosts[mint].expiresAt) : null;
    const boostExpiresAt = boost > 0 ? expiries.length ? Math.max(...expiries) : Date.parse(boosts[mint].expiresAt) : null;
    const record = {...asset, mint, capUsd, capSol, paidListing, boost, boostNextExpiry, boostExpiresAt,
      tier:promotion?.tier || (policy ? 'standard' : 'external'), paidPriority:Boolean(promotion) || paidListing,
      volumeUsd:activityFresh && volume != null && rate > 0 ? volume * rate : null,
      trades:activityFresh ? market.windowTradeCount : null,
      change:activityFresh ? market.windowPriceChangePercent : null,
      partial:market.windowCoverage !== 'complete',
      ageHours:createdMs && createdMs <= now && (!asset.listingPayment || asset.launchAgeVerified) ? (now - createdMs) / 3600000 : null,
      stage:asset.migrated === true ? 'migrated' : asset.complete === false ? 'curve' : 'unknown'};
    if (!unique.has(mint) || unique.get(mint).registryFallback) unique.set(mint, record);
  }
  return [...unique.values()];
}

export function rankTop100(records, {sort = 'featured', query = '', stage = 'all', tier = 'all', minCap = 0, maxAge = 0} = {}) {
  const metric = row => sort === 'boosted' ? row.boost : sort === 'volume' ? row.volumeUsd : sort === 'trades' ? row.trades : row.capUsd;
  const ranked = records.filter(row => sort !== 'boosted' || row.boost > 0)
    .filter(row => sort === 'featured' || metric(row) != null)
    .sort((a,b) => (sort === 'featured' ? (b.boost || 0) - (a.boost || 0) || Number(b.paidPriority === true) - Number(a.paidPriority === true) : 0)
      || (metric(b) ?? -1) - (metric(a) ?? -1) || (b.capUsd ?? -1) - (a.capUsd ?? -1) || a.mint.localeCompare(b.mint))
    .slice(0,100).map((row,index) => ({...row,rank:index+1}));
  const q = query.trim().toLowerCase();
  return {total:ranked.length, rows:ranked.filter(row => (!q || `${row.name} ${row.symbol} ${row.mint}`.toLowerCase().includes(q))
    && (stage === 'all' || row.stage === stage)
    && (tier === 'all' || (tier === 'listed' ? row.paidListing === true : row.tier === tier))
    && (!minCap || row.capUsd != null && row.capUsd >= minCap)
    && (!maxAge || row.ageHours != null && row.ageHours <= maxAge))};
}
