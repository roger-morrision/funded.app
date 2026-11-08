import {verifiedPromotionBadge} from '../../../promotion-badge.js';
import {verifiedPaidListings} from './paid-listings.js';
import {boostPackage,activeBoostPackages} from '../../../boost-offer.js';
import {currentFeaturedTokens} from './featured-placement.js';
import {projectBoostReceipts} from '../../../boost-timeline.js';

export const FEATURED_WINDOW_MS = 48 * 60 * 60 * 1000;
const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const signature = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

// Use payment/launch timestamps, never mutable metadata update times. Read the
// whole verified registry so paid placements are not limited by market-feed size.
export function featuredTokens({launches=[],listings=[],boosts=[],cluster,now=Date.now()}) {
  const known = new Map(), featured = new Map(), launchTimes = new Map();
  const recent = time => Number.isFinite(time) && time <= now && time > now-FEATURED_WINDOW_MS;
  for (const launch of launches) if (launch.onchainVerified === true && launch.cluster === cluster && address.test(launch.mint)) {known.set(launch.mint,launch);const at=Number(launch.blockTime)*1000;if(Number.isFinite(at)&&at>0&&at<=now)launchTimes.set(launch.mint,at);}
  const paid = verifiedPaidListings(listings,cluster);
  for (const listing of paid) if (!known.has(listing.mint)) known.set(listing.mint,listing);
  const add = (mint,time,label,proof,end=time+FEATURED_WINDOW_MS) => {
    const token=known.get(mint);
    if (!token || !(label==='Paid boost'?Number.isFinite(time)&&time<=now:recent(time)) || !signature.test(proof||'') || !Number.isFinite(end) || end<=now) return;
    const previous=featured.get(mint);
    const placement={label,signature:proof,featuredAt:time,expiresAt:label==='Paid boost'?end:Math.min(end,time+FEATURED_WINDOW_MS)};
    if (previous) {previous.placements.push(placement);return;}
    featured.set(mint,{mint,name:token.name||'Token',symbol:token.symbol||'TOKEN',
      imageUri:token.imageUri||null,bannerUri:verifiedPromotionBadge(token)?token.bannerUri||null:null,
      createdAt:launchTimes.get(mint)||null,placements:[placement]});
  };
  for (const launch of known.values()) {
    const promotion=verifiedPromotionBadge(launch);
    if (promotion) add(launch.mint,Number(launch.blockTime)*1000,`${promotion.tier === 'premier' ? 'Premier' : promotion.tier === 'pro' ? 'Pro' : 'Boost'} promotion`,promotion.signature);
  }
  for (const listing of paid) add(listing.mint,Date.parse(listing.listedAt),'Paid listing',listing.signature);
  const packagesByMint=new Map(),seenBoosts=new Set();
  for (const boost of projectBoostReceipts(boosts,{cluster,now})) if (boost.cluster===cluster && boost.status==='finalized'
    && boostPackage(boost.packageId)?.multiplier===boost.multiplier && signature.test(boost.signature||'') && !seenBoosts.has(boost.signature)) {
    seenBoosts.add(boost.signature);
    add(boost.mint,Date.parse(boost.startsAt),'Paid boost',boost.signature,Date.parse(boost.expiresAt));
    const packs=packagesByMint.get(boost.mint)||[];
    packs.push({packageId:boost.packageId,multiplier:boost.multiplier,startsAt:boost.startsAt,expiresAt:boost.expiresAt});
    packagesByMint.set(boost.mint,packs);
  }
  for(const item of featured.values()) item.boost={packages:activeBoostPackages({packages:packagesByMint.get(item.mint)||[]},now)};
  return currentFeaturedTokens([...featured.values()],now);
}
