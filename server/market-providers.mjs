import { createProviderQueue, retryAfterMs } from './provider-queue.mjs';
// Created once by the server composition layer; state belongs to this instance.
export function createMarketProviders({
  birdeyeApiKey,
  birdeyeBaseUrl,
  birdeyeChain,
  birdeyeTimeoutMs,
  pumpApiUrl,
  fetch = (...args) => globalThis.fetch(...args),
  now = Date.now,
  sleep,
}) {
  const queue = createProviderQueue({ gapMs: 1100, now, sleep });
  // Shared response cache and in-flight coalescing: identical Birdeye reads from
  // any visitor reuse one upstream call while fresh, saving API credits.
  const birdeyeCache = new Map(), birdeyeInflight = new Map();
  const counters = { cacheHits:0, coalesced:0, staleHits:0 };
  const birdeyeTtlMs = path => /meta-data/.test(path) ? 3_600_000 : /multi_price|price/.test(path) ? 30_000 : 60_000;
  async function fetchBirdeye(path, params = {}) {
    const key = path + '?' + new URLSearchParams(Object.entries(params).sort(([a], [b]) => a < b ? -1 : 1));
    const hit = birdeyeCache.get(key);
    if (hit && hit.expiresAt > now()) { counters.cacheHits++; return hit.value; }
    if (birdeyeInflight.has(key)) { counters.coalesced++; return birdeyeInflight.get(key); }
    const call = (async () => {
      const value = await queue.run(() => fetchBirdeyeUpstream(path, params));
      if (value?.configured) {
        if (birdeyeCache.size >= 2_000) birdeyeCache.delete(birdeyeCache.keys().next().value);
        birdeyeCache.set(key, { value, expiresAt: now() + birdeyeTtlMs(path) });
      }
      return value;
    })();
    birdeyeInflight.set(key, call);
    try { return await call; } catch (error) {
      if (hit && now() - hit.expiresAt < birdeyeTtlMs(path)) { counters.staleHits++; return { ...hit.value, stale: true, fetchedAt: new Date(hit.expiresAt - birdeyeTtlMs(path)).toISOString() }; }
      throw error;
    } finally { birdeyeInflight.delete(key); }
  }
  async function fetchBirdeyeUpstream(path, params = {}) {
    if (!birdeyeApiKey) return { configured: false, data: null };
    // Keep credentials on the official HTTPS origin, including on redirects.
    if (new URL(birdeyeBaseUrl).origin !== 'https://public-api.birdeye.so' || !path.startsWith('/defi/'))
      throw new Error('Invalid Birdeye endpoint.');
    const query = new URLSearchParams(params);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), birdeyeTimeoutMs);
    try {
      const response = await fetch(`${birdeyeBaseUrl}${path}?${query}`, { redirect:'error', headers: { accept: 'application/json', 'X-API-KEY': birdeyeApiKey, 'x-chain': birdeyeChain }, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success !== true) {
        const cooldown = [401,403].includes(response.status) ? 300_000 : retryAfterMs(response.headers?.get('retry-after'), now());
        queue.cooldown(cooldown);
        throw Object.assign(new Error(`Birdeye request failed (${response.status}).`), { status: response.status, retryAt: now() + cooldown });
      }
      return { configured: true, data: payload.data || null };
    } finally { clearTimeout(timeout); }
  }

  async function fetchPump(path, params = {}) {
    const query = new URLSearchParams(params);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), birdeyeTimeoutMs);
    try {
      const response = await fetch(`${pumpApiUrl}${path}?${query}`, { headers: { accept: 'application/json' }, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Pump.fun request failed (${response.status}).`);
      return Array.isArray(payload) ? payload : Array.isArray(payload.coins) ? payload.coins : Array.isArray(payload.data) ? payload.data : [];
    } finally { clearTimeout(timeout); }
  }

  return { fetchBirdeye, fetchPump, providerStats: () => ({ ...queue.stats(), ...counters, billedCredits:null }) };
}

export function normalizePumpToken(item) {
  const mint = String(item?.mint || item?.address || '').trim();
  if (!mint) return null;
  const marketCap = item.usd_market_cap ?? item.marketCapUsd;
  return {
    mint,
    name: String(item.name || 'Unnamed Pump coin').slice(0, 80),
    symbol: String(item.symbol || 'TOKEN').slice(0, 20),
    creator: String(item.creator || '').trim() || null,
    description: item.description || null,
    imageUri: item.imageUri || item.image_uri || item.image || null,
    metadataUri: item.metadataUri || item.metadata_uri || item.uri || null,
    website: item.website || null,
    twitter: item.twitter || item.x || null,
    telegram: item.telegram || null,
    discord: item.discord || null,
    marketCapUsd: marketCap != null && Number.isFinite(Number(marketCap)) ? Number(marketCap) : null,
    complete: Boolean(item.complete),
    bondingCurve: item.bonding_curve || null,
    raydiumPool: item.raydium_pool || null,
    virtualSolReserves: item.virtual_sol_reserves ?? null,
    virtualTokenReserves: item.virtual_token_reserves ?? null,
    realSolReserves: item.real_sol_reserves ?? null,
    realTokenReserves: item.real_token_reserves ?? null,
    createdTimestamp: item.created_timestamp ?? item.createdTimestamp ?? null,
    lastTradeTimestamp: item.last_trade_timestamp ?? item.lastTradeTimestamp ?? null,
    replyCount: item.reply_count ?? null,
    listingPayment: item.listingPayment || null,
  };
}

export function normalizeBirdeyeToken(item) {
  const address = String(item?.address || '').trim();
  if (!address) return null;
  return {
    address,
    name: String(item.name || 'Unnamed token').slice(0, 80),
    symbol: String(item.symbol || 'TOKEN').slice(0, 20),
    logoUri: item.logo_uri || item.logoURI || null,
    decimals: Number.isInteger(item.decimals) ? item.decimals : null,
    priceUsd: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
    marketCapUsd: Number.isFinite(Number(item.market_cap)) ? Number(item.market_cap) : null,
    liquidityUsd: Number.isFinite(Number(item.liquidity)) ? Number(item.liquidity) : null,
    volume24hUsd: Number.isFinite(Number(item.volume_24h_usd)) ? Number(item.volume_24h_usd) : null,
    priceChange24hPercent: Number.isFinite(Number(item.price_change_24h_percent)) ? Number(item.price_change_24h_percent) : null,
    holders: Number.isFinite(Number(item.holder)) ? Number(item.holder) : null,
    lastTradeUnixTime: Number.isFinite(Number(item.last_trade_unix_time)) ? Number(item.last_trade_unix_time) : null,
  };
}
