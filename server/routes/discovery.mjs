import { Connection as SolanaConnection } from '@solana/web3.js';
import { normalizePumpToken, normalizeBirdeyeToken } from '../market-providers.mjs';
import { explorePagination } from '../explore-pagination.mjs';
import { sortDevnetLaunches } from '../explore-registry.mjs';
import { verifyPumpLaunch as verifyLaunch } from '../launch-verification.mjs';
import { createExploreAccountSnapshot } from '../explore-account-snapshot.mjs';

// Dispatch after shared authorization and rate checks; preserve caller route order.
export function createDiscoveryRoutes({
  store, solanaCluster, solanaRpcUrl, birdeyeChain, fetchBirdeye, fetchPump, clientKey,
  Connection = SolanaConnection, verifyPumpLaunch = verifyLaunch, respond,
  warmMarketActivity = () => 0,
  readAccountSnapshot = null,
}) {
  let devnetVerificationActive = 0;
  let snapshotConnection = null;
  const readSnapshot = readAccountSnapshot || createExploreAccountSnapshot({ getConnection: () => snapshotConnection ||= new Connection(solanaRpcUrl, 'confirmed') });
  const json = (...args) => { respond(...args); return true; };
  // Trade activity the market-activity route stored in the last five minutes,
  // so cards show volume with the feed instead of one request per coin.
  const readRecentActivity = async mints => {
    if (typeof store.readMarketActivity !== 'function') return {};
    const rows = await Promise.all(mints.map(mint => store.readMarketActivity(mint, 'devnet').catch(() => null)));
    return Object.fromEntries(rows.flatMap((row, index) => {
      const at = Date.parse(row?.observedAt || '');
      return Number.isFinite(at) && Date.now() - at < 5 * 60_000 && row.mint === mints[index] ? [[mints[index], row]] : [];
    }));
  };
  // Display-only Birdeye price and logo for wallet holdings; cached briefly per mint.
  const tokenMarketCache = new Map();
  const birdeyeRetry = (path, params) => fetchBirdeye(path, params)
    .catch(() => new Promise(done => setTimeout(done, 1300)).then(() => fetchBirdeye(path, params))).catch(() => null);
  async function readTokenMarkets(mints) {
    const now = Date.now(), missing = mints.filter(mint => !(tokenMarketCache.get(mint)?.expiresAt > now));
    if (missing.length) {
      const list = missing.join(',');
      const prices = await birdeyeRetry('/defi/multi_price', { list_address: list });
      const meta = await birdeyeRetry('/defi/v3/token/meta-data/multiple', { list_address: list });
      for (const mint of missing) {
        const price = Number(prices?.data?.[mint]?.value), info = meta?.data?.[mint];
        const logo = typeof info?.logo_uri === 'string' && /^https:\/\//.test(info.logo_uri) ? info.logo_uri : null;
        if (prices?.data || meta?.data) tokenMarketCache.set(mint, { expiresAt: now + 60_000, row: { mint,
          priceUsd: Number.isFinite(price) && price > 0 ? price : null, logoUri: logo,
          name: typeof info?.name === 'string' ? info.name.slice(0, 80) : null, symbol: typeof info?.symbol === 'string' ? info.symbol.slice(0, 20) : null } });
      }
      if (tokenMarketCache.size > 5000) for (const [key, value] of tokenMarketCache) if (value.expiresAt <= now) tokenMarketCache.delete(key);
    }
    return mints.flatMap(mint => tokenMarketCache.get(mint)?.row ? [tokenMarketCache.get(mint).row] : []);
  }
  return async function handleDiscoveryRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/tokens/market') {
      if (solanaCluster === 'devnet') return json(res, 200, { cluster: solanaCluster, items: [] });
      const mints = [...new Set(String(url.searchParams.get('mints') || '').split(',').map(value => value.trim()).filter(value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)))].slice(0, 50);
      if (!mints.length) return json(res, 400, { error: 'Provide up to 50 token mints.' });
      return json(res, 200, { cluster: solanaCluster, provider: 'birdeye', items: await readTokenMarkets(mints) });
    }
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
        const candidates = (await store.readLaunches()).filter(item => item?.mint
          && item?.chain === 'solana' && (item.cluster || 'devnet') === 'devnet'
          && item.pumpFeeRoute?.scope === 'per-mint-v3');
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
        const v3Mints = new Set(candidates.map(item => item.mint));
        const paidListings = Object.values((await store.read()).listings || {})
          .filter(item => (v3Mints.has(item.mint) || item.serviceFeeVersion === 1) && item.cluster === 'devnet' && item.onchainVerified === true)
          .map(item => ({ mint: item.mint, name: item.name || 'Paid listing', symbol: item.symbol || 'TOKEN',
            createdTimestamp: Math.floor(Date.parse(item.listedAt) / 1000), listingPayment: { signature: item.signature, amountTokens: item.amountTokens, verified: true } }));
        const launchItems = [...alreadyVerified, ...newlyVerified.filter(Boolean)].map(normalizePumpToken).filter(Boolean);
        const uniqueByMint = new Map(launchItems.map(item => [item.mint, item]));
        for (const item of paidListings.map(normalizePumpToken).filter(Boolean)) {
          const prior = uniqueByMint.get(item.mint);
          uniqueByMint.set(item.mint, prior ? { ...prior, listingPayment: item.listingPayment } : item);
        }
        const uniqueItems = [...uniqueByMint.values()];
        const page = sortDevnetLaunches(uniqueItems, sort).slice(offset, offset + limit);
        const [accountSnapshot, activity] = await Promise.all([
          readSnapshot(page.map(item => item.mint)).catch(() => null),
          readRecentActivity(page.map(item => item.mint)),
        ]);
        try { warmMarketActivity(page.map(item => item.mint).filter(mint => !activity[mint])); } catch {}
        return json(res, 200, { provider: 'funded.app-devnet-registry', chain: 'solana', cluster: 'devnet', fetchedAt: new Date().toISOString(), items: page, total:uniqueItems.length, ...(accountSnapshot ? { accountSnapshot } : {}), ...(Object.keys(activity).length ? { marketActivity: activity } : {}) });
      }
      let items;
      try { items = await fetchPump('/coins', { offset: String(offset), limit: String(limit), sort, order: 'DESC', includeNsfw: 'false' }); }
      catch {
        // Pump.fun's API refuses server reads behind its bot challenge. Birdeye's
        // launchpad-filtered meme list still returns Pump.fun mints.
        const memeSort = sort === 'created_timestamp' ? 'creation_time' : sort === 'market_cap' ? 'market_cap' : 'volume_24h_usd';
        const memeParams = { sort_by: memeSort, sort_type: 'desc', offset: String(offset), limit: String(Math.min(limit, 100)), source: 'pump_dot_fun' };
        // Birdeye calls are spaced ~1.1s apart; the parallel market read may hold the slot.
        const meme = await fetchBirdeye('/defi/v3/token/meme/list', memeParams)
          .catch(() => new Promise(done => setTimeout(done, 1300)).then(() => fetchBirdeye('/defi/v3/token/meme/list', memeParams))).catch(() => null);
        const rows = Array.isArray(meme?.data?.items) ? meme.data.items : null;
        if (!meme?.configured || !rows) return json(res, 503, { error:'Pump.fun discovery is temporarily unavailable.', provider:'pump.fun', items:[] });
        const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
        return json(res, 200, { provider: 'birdeye-pump', chain: 'solana', fetchedAt: new Date().toISOString(), items: rows.flatMap(row => {
          const mint = String(row?.address || '').trim(); if (!mint) return [];
          const ext = row.extensions || {};
          return [{ mint, name: String(row.name || 'Unnamed token').slice(0, 80), symbol: String(row.symbol || 'TOKEN').slice(0, 20), imageUri: row.logo_uri || null,
            marketCapUsd: number(row.market_cap), twitter: ext.twitter || null, website: ext.website || null, telegram: ext.telegram || null, discord: ext.discord || null,
            description: typeof ext.description === 'string' ? ext.description.slice(0, 500) : null, lastTradeTimestamp: number(row.last_trade_unix_time) }];
        }) });
      }
      return json(res, 200, { provider: 'pump.fun', chain: 'solana', fetchedAt: new Date().toISOString(), items: items.map(normalizePumpToken).filter(Boolean) });
    }
    return false;
  };
}
