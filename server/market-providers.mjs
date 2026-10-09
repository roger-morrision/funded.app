// Created once by the server composition layer; state belongs to this instance.
export function createMarketProviders({
  birdeyeApiKey,
  birdeyeBaseUrl,
  birdeyeChain,
  birdeyeTimeoutMs,
  pumpApiUrl,
  fetch = (...args) => globalThis.fetch(...args),
}) {
  async function fetchBirdeye(path, params = {}) {
    if (!birdeyeApiKey) return { configured: false, data: null };
    const query = new URLSearchParams(params);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), birdeyeTimeoutMs);
    try {
      const response = await fetch(`${birdeyeBaseUrl}${path}?${query}`, { headers: { accept: 'application/json', 'X-API-KEY': birdeyeApiKey, 'x-chain': birdeyeChain }, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.message || `Birdeye request failed (${response.status}).`);
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

  return { fetchBirdeye, fetchPump };
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
