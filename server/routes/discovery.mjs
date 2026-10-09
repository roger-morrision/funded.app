import { Connection as SolanaConnection } from '@solana/web3.js';
import { normalizePumpToken, normalizeBirdeyeToken } from '../market-providers.mjs';
import { explorePagination } from '../explore-pagination.mjs';
import { sortDevnetLaunches } from '../explore-registry.mjs';
import { verifyPumpLaunch as verifyLaunch } from '../launch-verification.mjs';

// Dispatch after shared authorization and rate checks; preserve caller route order.
export function createDiscoveryRoutes({
  store, solanaCluster, solanaRpcUrl, birdeyeChain, fetchBirdeye, fetchPump, clientKey,
  Connection = SolanaConnection, verifyPumpLaunch = verifyLaunch, respond,
}) {
  let devnetVerificationActive = 0;
  const json = (...args) => { respond(...args); return true; };
  return async function handleDiscoveryRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/birdeye/explore') {
      const { limit, offset } = explorePagination(url.searchParams);
      const sortBy = ['volume_24h_usd', 'market_cap', 'recent_listing_time', 'price_change_24h_percent'].includes(url.searchParams.get('sort_by')) ? url.searchParams.get('sort_by') : 'volume_24h_usd';
      if (solanaCluster === 'devnet') return json(res, 503, { error: 'Birdeye market discovery is disabled for Solana. Use the verified Solana launch registry.', provider: 'birdeye', chain: 'solana', cluster: 'devnet', configured: false });
      const result = await fetchBirdeye('/defi/v3/token/list', { sort_by: sortBy, sort_type: 'desc', offset: String(offset), limit: String(limit), min_liquidity: '100' });
      if (!result.configured) return json(res, 503, { error: 'Birdeye is not configured.', provider: 'birdeye', configured: false });
      return json(res, 200, { provider: 'birdeye', chain: birdeyeChain, fetchedAt: new Date().toISOString(), items: Array.isArray(result.data?.items) ? result.data.items.map(normalizeBirdeyeToken).filter(Boolean) : [] });
    }
    if (req.method === 'GET' && url.pathname === '/api/pump/explore') {
      const { limit, offset } = explorePagination(url.searchParams);
      const sort = ['market_cap', 'created_timestamp', 'last_trade_timestamp'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'market_cap';
      if (solanaCluster === 'devnet') {
        const connection = new Connection(solanaRpcUrl, 'confirmed');
        const candidates = (await store.readLaunches()).filter(item => item?.mint && item?.chain === 'solana' && (item.cluster || 'devnet') === 'devnet');
        const alreadyVerified = candidates.filter(item => item.onchainVerified);
        const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
        const mayVerify = candidates.some(item => !item.onchainVerified) && await store.chargeRpcRate(`explore:${clientKey(req)}`, 1, 10, windowStart);
        const pending = mayVerify ? candidates.filter(item => !item.onchainVerified).slice(0, Math.max(0, 4 - devnetVerificationActive)) : [];
        const newlyVerified = await Promise.all(pending.map(async item => {
          devnetVerificationActive += 1;
          try {
            const proof = await verifyPumpLaunch({ connection, mint: item.mint, signature: item.signature || item.pumpFeeRoute?.transaction });
            const updated = { ...item, ...proof, cluster: 'devnet' };
            await store.update(state => { state.launches[item.mint] = updated; return updated; });
            return updated;
          } catch { return null; }
          finally { devnetVerificationActive -= 1; }
        }));
        const paidListings = Object.values((await store.read()).listings || {})
          .filter(item => item.cluster === 'devnet' && item.onchainVerified === true)
          .map(item => ({ mint: item.mint, name: item.name || 'Paid listing', symbol: item.symbol || 'TOKEN',
            createdTimestamp: Math.floor(Date.parse(item.listedAt) / 1000), listingPayment: { signature: item.signature, amountTokens: item.amountTokens, verified: true } }));
        const launchItems = [...alreadyVerified, ...newlyVerified.filter(Boolean)].map(normalizePumpToken).filter(Boolean);
        const uniqueByMint = new Map(launchItems.map(item => [item.mint, item]));
        for (const item of paidListings.map(normalizePumpToken).filter(Boolean)) {
          const prior = uniqueByMint.get(item.mint);
          uniqueByMint.set(item.mint, prior ? { ...prior, listingPayment: item.listingPayment } : item);
        }
        const uniqueItems = [...uniqueByMint.values()];
        const sorted = sortDevnetLaunches(uniqueItems, sort);
        return json(res, 200, { provider: 'funded.app-devnet-registry', chain: 'solana', cluster: 'devnet', fetchedAt: new Date().toISOString(), items: sorted.slice(offset, offset + limit) });
      }
      const items = await fetchPump('/coins', { offset: String(offset), limit: String(limit), sort, order: 'DESC', includeNsfw: 'false' });
      return json(res, 200, { provider: 'pump.fun', chain: 'solana', fetchedAt: new Date().toISOString(), items: items.map(normalizePumpToken).filter(Boolean) });
    }
    return false;
  };
}
