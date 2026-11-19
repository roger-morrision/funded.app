import { Connection as SolanaConnection } from '@solana/web3.js';
import { normalizePumpToken, normalizeBirdeyeToken } from '../market-providers.mjs';
import { explorePagination } from '../explore-pagination.mjs';
import { sortDevnetLaunches } from '../explore-registry.mjs';
import { verifyPumpLaunch as verifyLaunch } from '../launch-verification.mjs';
import { createExploreAccountSnapshot } from '../explore-account-snapshot.mjs';
import { createVolumeChangeTracker } from '../volume-change.mjs';

// Dispatch after shared authorization and rate checks; preserve caller route order.
// Jupiter reports the 24h holder change as a percentage of its own holder count;
// convert it to a net wallet change against that same count.
export function holderChange24h(token) {
  const count = Number(token?.holderCount), percent = Number(token?.stats24h?.holderChange);
  if (!Number.isSafeInteger(count) || count <= 0 || !Number.isFinite(percent) || percent <= -100) return null;
  return Math.round(count - count / (1 + percent / 100));
}

export function createDiscoveryRoutes({
  store, solanaCluster, solanaRpcUrl, birdeyeChain, fetchBirdeye, fetchPump, clientKey, tokenCache = null, freeMarketData = null,
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
  // Provider queues own cooldowns. Do not retry authentication/rate-limit errors
  // here; retain the last known display data with its observation time instead.
  const birdeyeRetry = (path, params) => fetchBirdeye(path, params).catch(() => null);
  async function readTokenMarkets(mints) {
    const now = Date.now();
    let missing = mints.filter(mint => !(tokenMarketCache.get(mint)?.expiresAt > now));
    if (missing.length && freeMarketData) {
      // Free first: Jupiter prices and DexScreener logos/names.
      const [prices, dex] = await Promise.all([freeMarketData.jupPrices(missing).catch(() => new Map()), freeMarketData.dexTokens(missing).catch(() => new Map())]);
      for (const mint of missing) {
        const price = prices.get(mint)?.priceUsd ?? dex.get(mint)?.priceUsd ?? null, d = dex.get(mint);
        if (price != null && d?.imageUri) tokenMarketCache.set(mint, { expiresAt: now + 60_000, row: { mint, priceUsd: price, logoUri: d.imageUri, name: d.name || null, symbol: d.symbol || null } });
        else if (price != null || d) tokenMarketCache.set(mint, { expiresAt: now + 60_000, partial: true, row: { mint, priceUsd: price, logoUri: d?.imageUri || null, name: d?.name || null, symbol: d?.symbol || null } });
      }
      void tokenCache?.upsert([...dex.values()]);
      missing = missing.filter(mint => !tokenMarketCache.get(mint) || tokenMarketCache.get(mint).partial);
    }
    if (missing.length) {
      const list = missing.join(',');
      const prices = await birdeyeRetry('/defi/multi_price', { list_address: list });
      const meta = await birdeyeRetry('/defi/v3/token/meta-data/multiple', { list_address: list });
      for (const mint of missing) {
        const price = Number(prices?.data?.[mint]?.value), info = meta?.data?.[mint];
        const logo = typeof info?.logo_uri === 'string' && /^https:\/\//.test(info.logo_uri) ? info.logo_uri : null;
        const prior = tokenMarketCache.get(mint)?.row;
        if (prices?.data || meta?.data) tokenMarketCache.set(mint, { expiresAt: now + 60_000, row: { mint,
          stale: Boolean(prices?.stale || meta?.stale), fetchedAt: prices?.fetchedAt || meta?.fetchedAt || new Date(now).toISOString(),
          priceUsd: Number.isFinite(price) && price > 0 ? price : prior?.priceUsd ?? null, logoUri: logo || prior?.logoUri || null,
          // Birdeye metadata can be missing; keep the free-source identity rather than erase it.
          name: typeof info?.name === 'string' ? info.name.slice(0, 80) : prior?.name ?? null,
          symbol: typeof info?.symbol === 'string' ? info.symbol.slice(0, 20) : prior?.symbol ?? null } });
      }
      if (tokenMarketCache.size > 5000) for (const [key, value] of tokenMarketCache) if (value.expiresAt <= now) tokenMarketCache.delete(key);
    }
    // A small lookup (such as a pasted mint in search) still lacking a name gets
    // its identity from Jupiter's free token search.
    if (freeMarketData?.jupToken && mints.length <= 3) await Promise.all(mints.map(async mint => {
      const cached = tokenMarketCache.get(mint);
      if (cached?.row?.symbol) return;
      const token = await freeMarketData.jupToken(mint).catch(() => null);
      if (!token?.symbol) return;
      const icon = typeof token.icon === 'string' && token.icon.startsWith('https://') ? token.icon : null;
      const row = cached?.row || { mint, priceUsd: Number.isFinite(Number(token.usdPrice)) ? Number(token.usdPrice) : null, logoUri: null };
      tokenMarketCache.set(mint, { expiresAt: now + 60_000, row: { ...row, logoUri: row.logoUri || icon,
        name: String(token.name || token.symbol).slice(0, 80), symbol: String(token.symbol).slice(0, 20) } });
    }));
    return mints.flatMap(mint => {
      const entry = tokenMarketCache.get(mint);
      return entry?.row ? [{ ...entry.row, stale: Boolean(entry.row.stale || entry.expiresAt <= Date.now()), fetchedAt: entry.row.fetchedAt || new Date(entry.expiresAt - 60_000).toISOString() }] : [];
    });
  }
  // Mainnet Explore lists only Richpad tokens: verified app launches and
  // verified paid listings on this cluster, with market fields from the free
  // DexScreener batch (falling back to the discovered-token cache).
  let registryCache = null;
  const registryFlights = new Map();
  const registryHolders = new Map(), registryHolderChange = new Map(), registryChangePercent = new Map(), registryDexPaid = new Map(), registryAth = new Map(), athCheckedAt = new Map(), holdersCheckedAt = new Map();
  const volumeChange = createVolumeChangeTracker({ store, cluster: solanaCluster });
  let holdersRefresh = null;
  function refreshRegistryHolders(mints) {
    const due = mints.filter(mint => Date.now() - (holdersCheckedAt.get(mint) || 0) > 30 * 60_000);
    if (!due.length || holdersRefresh) return holdersRefresh;
    const positive = value => Number.isSafeInteger(value) && value > 0 ? value : null;
    holdersRefresh = (async () => {
      for (const mint of due) {
        holdersCheckedAt.set(mint, Date.now());
        const jup = await freeMarketData?.jupToken?.(mint).catch(() => null);
        const count = positive(jup?.holderCount) ?? positive((await freeMarketData?.geckoTokenInfo?.(mint).catch(() => null))?.holders?.count);
        if (count != null) registryHolders.set(mint, count);
        const change = holderChange24h(jup);
        if (change != null) registryHolderChange.set(mint, change); else registryHolderChange.delete(mint);
        // Jupiter's 24h holder change as a percentage, for the card's holder figure.
        const percent = Number(jup?.stats24h?.holderChange);
        registryChangePercent.set(mint, { holders: jup?.stats24h?.holderChange != null && Number.isFinite(percent) ? percent : null });
        // "DEX paid": an approved DexScreener token profile order.
        const orders = await freeMarketData?.getJson?.(`https://api.dexscreener.com/orders/v1/solana/${mint}`, { ttlMs: 86_400_000 }).catch(() => null);
        if (Array.isArray(orders?.orders)) registryDexPaid.set(mint, orders.orders.some(order => order?.type === 'tokenProfile' && order?.status === 'approved'));
      }
      registryCache = null;
    })().finally(() => { holdersRefresh = null; });
    return holdersRefresh;
  }
  // All-time-high market cap: the highest daily candle of the coin's main pool
  // (GeckoTerminal, free) times its supply (current market cap / price).
  // Refreshed every 6 hours in the background; never below the current cap.
  let athRefresh = null;
  function refreshRegistryAth(rows) {
    const due = rows.filter(row => row.pairAddress && Date.now() - (athCheckedAt.get(row.mint) || 0) > 6 * 3_600_000);
    if (!due.length || athRefresh || typeof freeMarketData?.geckoOhlcv !== 'function') return athRefresh;
    athRefresh = (async () => {
      for (const row of due) {
        athCheckedAt.set(row.mint, Date.now());
        const candles = await freeMarketData.geckoOhlcv(row.pairAddress, '1d', 1000).catch(() => null);
        const high = Array.isArray(candles) ? Math.max(...candles.map(candle => candle.high)) : NaN;
        const supply = Number(row.marketCapUsd) / Number(row.priceUsd);
        if (Number.isFinite(high) && high > 0 && Number.isFinite(supply) && supply > 0) registryAth.set(row.mint, high * supply);
      }
      registryCache = null;
    })().finally(() => { athRefresh = null; });
    return athRefresh;
  }
  async function buildRegistry(pageOptions) {
    const pageKey = JSON.stringify(pageOptions);
    if (registryCache?.key === pageKey && Date.now() - registryCache.at < 15_000) return registryCache.result;
    const registry = typeof store.readDiscoveryRegistry === 'function' ? await store.readDiscoveryRegistry(solanaCluster, pageOptions) : null;
    const state = registry?.state || await store.read();
    const launches = Object.values(state.launches || {}).filter(item => item?.mint && item.cluster === solanaCluster && item.onchainVerified === true);
    const listings = Object.values(state.listings || {}).filter(item => item?.mint && item.cluster === solanaCluster && item.onchainVerified === true);
    const byMint = new Map();
    for (const item of launches) byMint.set(item.mint, { ...item, registry: 'launch', createdTimestamp: item.createdTimestamp || Math.floor(Date.parse(item.createdAt || item.launchedAt || 0) / 1000) || null });
    // Paired launches made on richpad.fun (verified on-chain when recorded).
    for (const item of Object.values(state.pairLaunches || {}).filter(row => row?.mint && row.cluster === solanaCluster))
      if (!byMint.has(item.mint)) byMint.set(item.mint, { mint: item.mint, name: item.name || null, symbol: item.symbol || null, creator: item.creator, registry: 'pair-launch',
        quoteMint: item.quoteMint, quoteSymbol: item.quoteSymbol, createdTimestamp: item.blockTime || Math.floor(Date.parse(item.recordedAt) / 1000) || null });
    for (const item of listings) {
      const listingPayment = item.adminListing ? { signature: null, admin: true, adminSignature: item.adminSignature || null, verified: true }
        : { signature: item.signature, amountTokens: item.amountTokens, verified: true };
      const prior = byMint.get(item.mint);
      byMint.set(item.mint, prior ? { ...prior, listingPayment } : { mint: item.mint, name: item.name || 'Paid listing', symbol: item.symbol || 'TOKEN',
        imageUri: item.imageUri || null, registry: 'listing', createdTimestamp: Math.floor(Date.parse(item.listedAt) / 1000) || null, listingPayment });
    }
    const mints = [...byMint.keys()];
    const [dex, cached] = await Promise.all([freeMarketData && mints.length ? freeMarketData.dexTokens(mints).catch(() => new Map()) : new Map(),
      tokenCache && mints.length ? tokenCache.read(mints).catch(() => new Map()) : new Map()]);
    const fresh = [];
    // Holder counts (GeckoTerminal, else Jupiter) refresh in the background every
    // 30 minutes; the list answers immediately with the last known counts.
    const holders = registryHolders;
    const items = mints.map(mint => {
      const base = byMint.get(mint), market = dex.get(mint) || cached.get(mint) || {};
      if (dex.get(mint)) fresh.push({ ...(cached.get(mint) || {}), ...dex.get(mint), mint });
      const ath = registryAth.get(mint), cap = Number(market.marketCapUsd);
      return { ...base, mint, name: base.name || market.name || 'Unnamed token', symbol: base.symbol || market.symbol || 'TOKEN',
        imageUri: base.imageUri || market.imageUri || null, priceUsd: market.priceUsd ?? null, marketCapUsd: market.marketCapUsd ?? null,
        liquidityUsd: market.liquidityUsd ?? null, volume24hUsd: market.volume24hUsd ?? null, priceChange24hPercent: market.priceChangePercent ?? market.priceChange24hPercent ?? null,
        website: base.website || market.website || null, twitter: base.twitter || market.twitter || null, telegram: base.telegram || market.telegram || null, discord: base.discord || market.discord || null,
        pairAddress: market.pairAddress || null, pairCreatedAt: Number(market.pairCreatedAt) > 0 ? Number(market.pairCreatedAt) : null, dexId: market.dexId || null,
        quoteMint: base.quoteMint || market.quoteMint || null, quoteSymbol: base.quoteSymbol || market.quoteSymbol || null,
        buyCount24h: Number.isSafeInteger(market.buyCount24h) ? market.buyCount24h : null, sellCount24h: Number.isSafeInteger(market.sellCount24h) ? market.sellCount24h : null,
        holderCount: Number.isSafeInteger(holders.get(mint)) ? holders.get(mint) : null,
        holderChange24h: Number.isSafeInteger(registryHolderChange.get(mint)) ? registryHolderChange.get(mint) : null,
        holderChange24hPercent: registryChangePercent.get(mint)?.holders ?? null, dexPaid: registryDexPaid.get(mint) ?? null,
        athMarketCapUsd: Number.isFinite(ath) ? Math.max(ath, Number.isFinite(cap) ? cap : 0) : null };
    });
    await Promise.all(items.map(async item => {
      item.volumeChange24hPercent = await volumeChange.change(item.mint, item.volume24hUsd).catch(() => null);
      void volumeChange.record(item.mint, item.volume24hUsd).catch(() => {});
    }));
    if (fresh.length) void tokenCache?.upsert(fresh);
    const result = { items, total: registry?.total ?? items.length, paged: Boolean(registry), mints: registry?.mints };
    registryCache = { at: Date.now(), key: pageKey, result };
    return result;
  }
  async function mainnetRegistry(options) {
    const key = JSON.stringify(options);
    if (!registryFlights.has(key)) registryFlights.set(key, buildRegistry(options).finally(() => registryFlights.delete(key)));
    return registryFlights.get(key);
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
      const registry = await mainnetRegistry({ limit, offset, sort });
      const { items } = registry;
      const key = sort === 'market_cap' ? 'marketCapUsd' : sort === 'created_timestamp' ? 'createdTimestamp' : 'volume24hUsd';
      const sorted = registry.paged ? registry.mints.map(mint => items.find(item => item.mint === mint)).filter(Boolean)
        : [...items].sort((x, y) => (Number(y[key]) || 0) - (Number(x[key]) || 0));
      const visible = registry.paged ? sorted : sorted.slice(offset, offset + limit);
      void refreshRegistryHolders(visible.map(item => item.mint));
      void refreshRegistryAth(visible);
      return json(res, 200, { provider: 'richpad-registry', chain: 'solana', cluster: solanaCluster, fetchedAt: new Date().toISOString(),
        items: visible, total: registry.total, directoryComplete: offset + limit >= registry.total });
    }
    return false;
  };
}
