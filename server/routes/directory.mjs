import { buildTerminalSignal, creatorReputation } from '../../stonk-features.js';
import { PublicKey, Connection } from '@solana/web3.js';
import { DEVNET_GENESIS_HASH } from '../automatic-reward-chain.mjs';
import { readVerifiedListingMint } from '../token-metadata.mjs';
import { projectBurnBoard, walletBurnBoard } from '../leaderboard-burn-board.mjs';
import { LISTING_PRICE_USD, listingBurnTokens } from '../../listing-policy.js';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createDirectoryRoutes({
  store, solanaCluster, route, fundedTokenMint, currentLaunchTierPricing, solanaRpcUrl, walletKey,
  respond,
}) {

  const json = (...args) => { respond(...args); return true; };
  return async function handleDirectoryRoutes(req, res, url, requestId) {
    if (req.method === 'GET' && url.pathname === '/api/terminal/signals') {
      const launches = (await store.readLaunches()).filter(item => item.onchainVerified && item.cluster === solanaCluster).map(item => ({ ...item, ...buildTerminalSignal(item) }));
      return json(res, 200, { source: 'verified-Solana-launch-registry', cluster: solanaCluster, generatedAt: new Date().toISOString(), items: launches, status: launches.length ? 'ready' : 'waiting-for-indexer' });
    }
    const creatorProfileWallet = route(url.pathname, req.method, /^\/api\/creators\/([^/]+)$/);
    if (creatorProfileWallet) {
      const state = await store.read();
      const wallet = decodeURIComponent(creatorProfileWallet);
      const profile = creatorReputation(state.launches, state.settlements).find(item => item.wallet === wallet);
      return profile ? json(res, 200, profile) : json(res, 404, { error: 'Creator profile not found.' });
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
      return json(res, 200, { provider: 'pump.fun', configured: true, indexedLaunches: Object.keys(state.launches).length, lastIndexedAt: state.lastIndexedAt || null, status: state.lastIndexedAt ? 'ready' : 'waiting-for-sync' });
    }
    if (req.method === 'GET' && url.pathname === '/api/launches') {
      const requestedLimit = url.searchParams.get('limit');
      const requestedOffset = url.searchParams.get('offset');
      if ((requestedLimit != null && !/^\d+$/.test(requestedLimit)) || (requestedOffset != null && !/^\d+$/.test(requestedOffset))) return json(res, 400, { error: 'limit and offset must be non-negative integers.' });
      const limit = requestedLimit == null ? null : Math.min(100, Number(requestedLimit));
      const offset = requestedOffset == null ? 0 : Math.min(100_000, Number(requestedOffset));
      return json(res, 200, await store.readLaunches({ limit, offset }));
    }
    if (req.method === 'GET' && url.pathname === '/api/listings/config') {
      let pricing = null;
      try { pricing = await currentLaunchTierPricing(); } catch { /* A listing cannot be paid without a verified price. */ }
      const enabled = solanaCluster === 'devnet' && Boolean(fundedTokenMint) && Boolean(pricing);
      return json(res, 200, { cluster: solanaCluster, enabled, fundedMint: fundedTokenMint || null,
        usd: LISTING_PRICE_USD, burnTokens: enabled ? listingBurnTokens(pricing.tokenPriceUsd) : null,
        tokenPriceUsd: enabled ? pricing.tokenPriceUsd : null, observedAt: enabled ? pricing.observedAt : null,
        paymentMethod: 'BurnChecked', status: enabled ? 'ready' : 'price-unavailable' });
    }
    const listingMintMatch = req.method === 'GET' ? /^\/api\/listings\/mint\/([^/]+)$/.exec(url.pathname) : null;
    if (listingMintMatch) {
      if (solanaCluster !== 'devnet') return json(res, 503, { error:'Listing mint checks require Solana.' });
      let listingMint;
      try { listingMint = new PublicKey(listingMintMatch[1]).toBase58(); }
      catch { return json(res, 400, { error:'A valid token mint is required.' }); }
      try {
        const rpc = new Connection(solanaRpcUrl, 'finalized');
        if (await rpc.getGenesisHash() !== DEVNET_GENESIS_HASH) return json(res, 503, { error:'Listing mint checks require a Solana RPC.' });
        const [trustedLaunch, signedMetadata] = await Promise.all([store.readLaunch(listingMint), store.readMetadata(listingMint)]);
        return json(res, 200, { cluster:'devnet', ...(await readVerifiedListingMint(rpc, listingMint, { trustedLaunch, signedMetadata })) });
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
