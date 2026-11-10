import {top100Growth} from '../top100-growth.mjs';
import {top100CommunityCounts} from '../top100-community.mjs';
import { buildTerminalSignal } from '../../stonk-features.js';
import { PublicKey, Connection } from '@solana/web3.js';
import { SOLANA_GENESIS } from '../../solana-network.js';
import { readVerifiedListingMint } from '../token-metadata.mjs';
import { projectBurnBoard, walletBurnBoard } from '../leaderboard-burn-board.mjs';
import { LISTING_PRICE_USD, listingBurnTokens } from '../../listing-policy.js';
import { readServiceFees } from '../service-fees.mjs';
import { createPortfolioMetadataReader } from '../portfolio-token-metadata.mjs';
import {featuredTokens,FEATURED_WINDOW_MS} from '../../src/features/home/featured-data.js';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createDirectoryRoutes({
  store, solanaCluster, route, fundedTokenMint, currentLaunchTierPricing, solanaRpcUrl, walletKey,
  respond,
}) {

  const json = (...args) => { respond(...args); return true; };
  let metadataReader, communityCache;
  const readTokenMetadata=mint=>{
    metadataReader ||= createPortfolioMetadataReader({cluster:solanaCluster,connection:new Connection(solanaRpcUrl,{commitment:'finalized',disableRetryOnRateLimit:true,
      fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(8000)})})});
    return metadataReader(mint);
  };
  return async function handleDirectoryRoutes(req, res, url, requestId) {
    if (req.method === 'GET' && url.pathname === '/api/top100/metrics') {
      if (!communityCache || Date.now() - communityCache.at >= 15000) {
        const at=Date.now();
        const value=Promise.resolve().then(()=>store.read()).then(state=>({cluster:solanaCluster,...top100CommunityCounts(state.coinChats,at),growth:top100Growth(state.top100Snapshots,solanaCluster,at)}));
        communityCache={at,value};
        value.catch(()=>{if(communityCache?.value===value)communityCache=null;});
      }
      return json(res,200,await communityCache.value);
    }
    if (req.method === 'GET' && url.pathname === '/api/home/featured') {
      const state=await store.read(), now=Date.now();
      return json(res,200,{cluster:solanaCluster,checkedAt:new Date(now).toISOString(),windowHours:FEATURED_WINDOW_MS/3600000,
        items:featuredTokens({launches:Object.values(state.launches||{}),listings:Object.values(state.listings||{}),
          boosts:Object.values(state.boostReceipts||{}),cluster:solanaCluster,now})});
    }
    if (req.method === 'GET' && url.pathname === '/api/token-config') {
      return json(res, 200, {cluster:solanaCluster, fundedMint:fundedTokenMint || null});
    }
    if(req.method==='GET' && url.pathname==='/api/tokens/metadata'){
      let mints;
      try{mints=[...new Set(String(url.searchParams.get('mints')||'').split(',').map(mint=>new PublicKey(mint).toBase58()))];if(!mints.length||mints.length>8)throw Error();}
      catch{return json(res,400,{error:'Provide between 1 and 8 valid token mints.'});}
      const items=(await Promise.all(mints.map(readTokenMetadata))).filter(Boolean);
      return json(res,200,{cluster:solanaCluster,items});
    }
    if (req.method === 'GET' && url.pathname === '/api/terminal/signals') {
      const launches = (await store.readLaunches()).filter(item => item.onchainVerified
        && item.cluster === solanaCluster && item.pumpFeeRoute?.scope === 'per-mint-v3')
        .map(item => ({ ...item, ...buildTerminalSignal(item) }));
      return json(res, 200, { source: 'verified-Solana-launch-registry', cluster: solanaCluster, generatedAt: new Date().toISOString(), items: launches, status: launches.length ? 'ready' : 'waiting-for-indexer' });
    }
    const creatorProfileWallet = route(url.pathname, req.method, /^\/api\/creators\/([^/]+)$/);
    if (creatorProfileWallet) {
      return json(res, 410, { error:'Legacy wallet creator profiles are retired. Use V3 X creator profiles.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/launch-reviews') {
      const state = await store.read();
      return json(res, 200, Object.values(state.launchReviews || {}).map(item => ({ ...item, policy: undefined })));
    }
    if (req.method === 'GET' && url.pathname === '/api/alerts') {
      const wallet = String(url.searchParams.get('wallet') || '').trim();
      const state = await store.read();
      return json(res, 200, Object.values(state.alerts || {}).filter(item => !wallet || item.wallet === wallet));
    }
    if (req.method === 'GET' && url.pathname === '/api/indexer/status') {
      const state = await store.read();
      const indexed = Object.values(state.launches || {}).filter(item => item.pumpFeeRoute?.scope === 'per-mint-v3');
      // The legacy keeper route was the only writer of lastIndexedAt; verified V3
      // launches carry their own timestamps, so use the newest of either.
      const times = [state.lastIndexedAt, ...indexed.map(item => item.onchainVerifiedAt || item.updatedAt)].map(value => Date.parse(value)).filter(Number.isFinite);
      const lastIndexedAt = times.length ? new Date(Math.max(...times)).toISOString() : null;
      return json(res, 200, { provider: 'pump.fun', configured: true, indexedLaunches: indexed.length,
        lastIndexedAt, status: lastIndexedAt ? 'ready' : 'waiting-for-sync' });
    }
    if (req.method === 'GET' && url.pathname === '/api/launches') {
      const requestedLimit = url.searchParams.get('limit');
      const requestedOffset = url.searchParams.get('offset');
      if ((requestedLimit != null && !/^\d+$/.test(requestedLimit)) || (requestedOffset != null && !/^\d+$/.test(requestedOffset))) return json(res, 400, { error: 'limit and offset must be non-negative integers.' });
      const limit = requestedLimit == null ? null : Math.min(100, Number(requestedLimit));
      const offset = requestedOffset == null ? 0 : Math.min(100_000, Number(requestedOffset));
      const launches = (await store.readLaunches()).filter(item => item.pumpFeeRoute?.scope === 'per-mint-v3');
      return json(res, 200, limit == null ? launches : launches.slice(offset, offset + limit));
    }
    if (req.method === 'GET' && url.pathname === '/api/listings/config') {
      const fees = await readServiceFees(store);
      let pricing = null;
      try { pricing = await currentLaunchTierPricing(); } catch { /* A listing cannot be paid without a verified price. */ }
      const enabled = Object.hasOwn(SOLANA_GENESIS, solanaCluster) && Boolean(fundedTokenMint) && Boolean(pricing);
      return json(res, 200, { cluster: solanaCluster, enabled, fundedMint: fundedTokenMint || null,
        usd: fees.policy.listingUsd, burnTokens: enabled ? listingBurnTokens(pricing.tokenPriceUsd,fees.policy.listingUsd) : null,
        serviceFees:fees,
        tokenPriceUsd: enabled ? pricing.tokenPriceUsd : null, observedAt: enabled ? pricing.observedAt : null,
        paymentMethod: 'BurnChecked', status: enabled ? 'ready' : 'price-unavailable' });
    }
    const listingMintMatch = req.method === 'GET' ? /^\/api\/listings\/mint\/([^/]+)$/.exec(url.pathname) : null;
    if (listingMintMatch) {
      if (!Object.hasOwn(SOLANA_GENESIS, solanaCluster)) return json(res, 503, { error:'Listing mint checks require Solana.' });
      let listingMint;
      try { listingMint = new PublicKey(listingMintMatch[1]).toBase58(); }
      catch { return json(res, 400, { error:'A valid token mint is required.' }); }
      try {
        const trustedLaunch = await store.readLaunch(listingMint);
        // Inclusion is a saved launch entitlement. It does not depend on today's
        // metadata RPC, pool quote, or the paid-listing price being available.
        if (trustedLaunch?.onchainVerified === true && trustedLaunch.cluster === solanaCluster
          && trustedLaunch.pumpFeeRoute?.scope === 'per-mint-v3') {
          return json(res, 200, { cluster:solanaCluster, mint:listingMint, included:true,
            name:trustedLaunch.name || 'Funded launch', symbol:trustedLaunch.symbol || 'TOKEN',
            source:'verified-launch-registry', marketStatus:'not-requested' });
        }
        const rpc = new Connection(solanaRpcUrl, 'finalized');
        if (await rpc.getGenesisHash() !== SOLANA_GENESIS[solanaCluster]) return json(res, 503, { error:'Listing mint checks require a Solana RPC.' });
        const signedMetadata = await store.readMetadata(listingMint);
        return json(res, 200, { cluster:solanaCluster, included:Boolean(trustedLaunch?.onchainVerified && trustedLaunch.cluster===solanaCluster && trustedLaunch.pumpFeeRoute?.scope==='per-mint-v3'), ...(await readVerifiedListingMint(rpc, listingMint, { trustedLaunch, signedMetadata })) });
      } catch (error) { return json(res, 409, { error:error.message || 'Verified token metadata is unavailable.' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/listings') {
      const state = await store.read();
      return json(res, 200, { cluster: solanaCluster, listings: Object.values(state.listings || {})
        .filter(item => item.cluster === solanaCluster && item.onchainVerified === true)
        .sort((a, b) => String(b.listedAt).localeCompare(String(a.listedAt))) });
    }
    if (req.method === 'GET' && url.pathname === '/api/leaderboard/burn-board') {
      const state = await store.read();
      return json(res, 200, { cluster: solanaCluster, source: 'verified-burn-receipts', projects: projectBurnBoard(state, solanaCluster) });
    }
    if (req.method === 'GET' && url.pathname === '/api/leaderboard/burners') {
      const state = await store.read();
      return json(res, 200, { cluster: solanaCluster, source: 'verified-burn-receipts', wallets: walletBurnBoard(state, solanaCluster) });
    }
    if (req.method === 'GET' && url.pathname === '/api/burn-receipts') {
      let wallet;
      try { wallet = walletKey(url.searchParams.get('wallet')); } catch { return json(res, 400, { error: 'A valid wallet query parameter is required.' }); }
      const state = await store.read();
      const receipts = Object.values(state.burnReceipts || {}).filter(item => item.wallet === wallet)
        .sort((a, b) => String(b.verifiedAt).localeCompare(String(a.verifiedAt)));
      return json(res, 200, { wallet, cluster: solanaCluster, receipts });
    }
    return false;
  };
}
