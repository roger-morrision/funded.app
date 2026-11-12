import {exploreSocialLinks} from '../../../explore-social-links.js';
import {verifiedPromotionBadge} from '../../../promotion-badge.js';
import {activeBoostMultiplier,activeBoostPackages} from '../../../boost-offer.js';
import {withMarketWindow} from '../../../market-intelligence.js';

const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const featuredKeys = [row=>row.boost||0,row=>Number(row.paidListing===true),row=>Number(row.tier==='premier'),row=>Number(row.tier==='pro'),
  row=>row.capGrowthUsd,row=>row.volumeUsd,row=>row.holderGrowth,row=>row.communityCount,row=>row.socialChannels,row=>row.trades];
const nonnegative = value => { const n = number(value); return n != null && n >= 0 ? n : null; };
export function top100Records(assets, {boosts = {}, solUsd = null, policies = [], community = null, cluster = 'devnet', now = Date.now()} = {}) {
  const rate = number(solUsd), unique = new Map();
  const fresh=at=>Number.isFinite(at)&&now>=at&&now-at<300000;
  const communityReady=community?.cluster===cluster&&community.scope==='retained-visible-posts-24h'&&fresh(community.observedAt)&&community.items!=null&&typeof community.items==='object'&&!Array.isArray(community.items);
  const growthReady = community?.cluster===cluster && community?.growth?.scope==='net-change-24h' && fresh(community.growth.observedAt);
  const growthDelta = value => {
    const from=number(value?.from), to=number(value?.to);
    return value && fresh(to) && from!=null && from<=now-86400000 && now-86400000-from<=600000 ? number(value.delta) : null;
  };
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
    const paidListing = asset.listingPayment?.verified === true && (asset.listingPayment.admin === true || /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(asset.listingPayment.signature || ''));
    const boost = activeBoostMultiplier(boosts[mint], now), packs = activeBoostPackages(boosts[mint], now);
    const expiries = packs.map(pack => Date.parse(pack.expiresAt));
    const boostNextExpiry = boost > 0 ? expiries.length ? Math.min(...expiries) : Date.parse(boosts[mint].nextExpiry || boosts[mint].expiresAt) : null;
    const boostExpiresAt = boost > 0 ? expiries.length ? Math.max(...expiries) : Date.parse(boosts[mint].expiresAt) : null;
    const growth=growthReady?community.growth.items?.[mint]:null, posts=communityReady?community.items[mint]:null;
    const capGrowthUsd=growthDelta(growth?.marketCapUsd), holderDelta=growthDelta(growth?.holders);
    const holderGrowth=Number.isSafeInteger(holderDelta)?holderDelta:null;
    const communityCount=communityReady ? posts==null?0:Number.isSafeInteger(posts.total)&&posts.total>=0?posts.total:null : null;
    const socialChannels=new Set(exploreSocialLinks(asset,policy).filter(link=>{
      const host=new URL(link.href).hostname.toLowerCase().replace(/^www\./,'');
      return link.icon==='socialX'?['x.com','twitter.com'].includes(host)
        :link.icon==='telegram'?['t.me','telegram.me'].includes(host)
        :link.icon==='discord'?['discord.gg','discord.com','discordapp.com'].includes(host):false;
    }).map(link=>link.icon)).size;
    const record = {...asset, mint, capUsd, capSol, paidListing, boost, boostNextExpiry, boostExpiresAt,
      capGrowthUsd,holderGrowth,communityCount,socialChannels,
      tier:promotion?.tier || (policy ? 'standard' : 'external'), paidPriority:['premier','pro'].includes(promotion?.tier) || paidListing,
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
  const metric = row => sort === 'boosted' ? row.boost : sort === 'volume' ? row.volumeUsd : sort === 'trades' ? row.trades : row.capGrowthUsd;
  const ranked = records.filter(row => sort !== 'boosted' || row.boost > 0)
    .filter(row => sort === 'featured' || metric(row) != null)
    .sort((a,b) => {
      if(sort==='featured') {
        for(const key of featuredKeys){const order=(key(b)??-Infinity)-(key(a)??-Infinity);if(order)return order;}
        return a.mint.localeCompare(b.mint);
      }
      return (metric(b)??-1)-(metric(a)??-1)||(b.capUsd??-1)-(a.capUsd??-1)||a.mint.localeCompare(b.mint);
    })
    .slice(0,100).map((row,index) => ({...row,rank:index+1}));
  const q = query.trim().toLowerCase();
  return {total:ranked.length, rows:ranked.filter(row => (!q || `${row.name} ${row.symbol} ${row.mint}`.toLowerCase().includes(q))
    && (stage === 'all' || row.stage === stage)
    && (tier === 'all' || (tier === 'listed' ? row.paidListing === true : row.tier === tier))
    && (!minCap || row.capUsd != null && row.capUsd >= minCap)
    && (!maxAge || row.ageHours != null && row.ageHours <= maxAge))};
}
