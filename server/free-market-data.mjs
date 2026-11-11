// Free public market sources (DexScreener, Jupiter, GeckoTerminal) with a shared
// response cache, in-flight coalescing and per-host pacing. Callers fall back to
// the paid Birdeye API only when these return nothing.
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const WSOL = 'So11111111111111111111111111111111111111112';

export function createFreeMarketData({ fetch = (...args) => globalThis.fetch(...args), now = Date.now, timeoutMs = 8000 } = {}) {
  const cache = new Map(), inflight = new Map(), nextAt = new Map(), cooldownUntil = new Map();
  const spacing = { 'api.dexscreener.com': 220, 'lite-api.jup.ag': 120, 'api.geckoterminal.com': 2100 };
  async function pace(host) {
    const wait = (nextAt.get(host) || 0) - now();
    nextAt.set(host, Math.max(now(), nextAt.get(host) || 0) + (spacing[host] || 200));
    if (wait > 0) await new Promise(done => setTimeout(done, Math.min(wait, 5000)));
  }
  async function getJson(url, { ttlMs = 30_000, method = 'GET', body = null } = {}) {
    const key = method + ' ' + url + (body ? ' ' + JSON.stringify(body) : '');
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const host = new URL(url).hostname;
    if ((cooldownUntil.get(host) || 0) > now()) { if (hit) return hit.value; throw Error(`${host} is cooling down`); }
    const call = (async () => {
      await pace(host);
      const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.status === 429 || response.status >= 500) cooldownUntil.set(host, now() + 30_000);
      if (!response.ok) throw Error(`${host} request failed (${response.status})`);
      const value = await response.json();
      if (ttlMs > 0) {
        if (cache.size > 3000) for (const [k, row] of cache) if (row.expiresAt <= now()) cache.delete(k);
        cache.set(key, { value, expiresAt: now() + ttlMs });
      }
      return value;
    })();
    inflight.set(key, call);
    try { return await call; } catch (error) { if (hit) return hit.value; throw error; } finally { inflight.delete(key); }
  }
  const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
  const num = value => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

  // Best (deepest-liquidity) DexScreener pair for each mint.
  async function dexTokens(mints) {
    const result = new Map();
    for (const batch of chunks([...new Set(mints.filter(m => MINT.test(m)))], 30)) {
      let pairs = [];
      try { pairs = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(',')}`, { ttlMs: 30_000 }); } catch { continue; }
      for (const pair of Array.isArray(pairs) ? pairs : []) {
        const mint = pair?.baseToken?.address;
        if (!batch.includes(mint)) continue;
        const prior = result.get(mint);
        if (prior && (num(prior.liquidityUsd) || 0) >= (num(pair.liquidity?.usd) || 0)) continue;
        const info = pair.info || {}, social = type => info.socials?.find(row => row?.type === type)?.url || null;
        result.set(mint, { mint, name: String(pair.baseToken.name || '').slice(0, 80), symbol: String(pair.baseToken.symbol || '').slice(0, 20),
          pairAddress: pair.pairAddress || null, dexId: pair.dexId || null, url: pair.url || null,
          quoteMint: pair.quoteToken?.address || null, priceUsd: num(pair.priceUsd), priceNative: num(pair.priceNative),
          marketCapUsd: num(pair.marketCap ?? pair.fdv), liquidityUsd: num(pair.liquidity?.usd), volume24hUsd: num(pair.volume?.h24),
          buyCount24h: num(pair.txns?.h24?.buys), sellCount24h: num(pair.txns?.h24?.sells), priceChangePercent: num(pair.priceChange?.h24),
          pairCreatedAt: num(pair.pairCreatedAt), imageUri: typeof info.imageUrl === 'string' && info.imageUrl.startsWith('https://') ? info.imageUrl : null,
          headerUri: typeof info.header === 'string' && info.header.startsWith('https://') ? info.header : null,
          website: info.websites?.find(row => typeof row?.url === 'string')?.url || null, twitter: social('twitter'), telegram: social('telegram'), discord: social('discord') });
      }
    }
    return result;
  }
  // Jupiter price v3: price, decimals and liquidity for up to 50 mints per call.
  async function jupPrices(mints) {
    const result = new Map();
    for (const batch of chunks([...new Set(mints.filter(m => MINT.test(m)))], 50)) {
      try {
        const data = await getJson(`https://lite-api.jup.ag/price/v3?ids=${batch.join(',')}`, { ttlMs: 20_000 });
        for (const mint of batch) {
          const row = data?.[mint];
          if (row) result.set(mint, { mint, priceUsd: num(row.usdPrice), decimals: Number.isInteger(row.decimals) ? row.decimals : null,
            liquidityUsd: num(row.liquidity), priceChangePercent: num(row.priceChange24h), launchpad: row.launchpad || null });
        }
      } catch { /* The caller falls back to Birdeye. */ }
    }
    return result;
  }
  // GeckoTerminal candles: [time, open, high, low, close, volume] in USD.
  const GECKO_FRAMES = { '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4], '1d': ['day', 1] };
  async function geckoOhlcv(pool, frame = '15m', limit = 300) {
    const [unit, aggregate] = GECKO_FRAMES[frame] || GECKO_FRAMES['15m'];
    if (!MINT.test(pool)) return null;
    const data = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/${unit}?aggregate=${aggregate}&limit=${Math.min(limit, 1000)}&currency=usd`, { ttlMs: 60_000 });
    const list = data?.data?.attributes?.ohlcv_list;
    return Array.isArray(list) ? list.map(row => ({ time: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] }))
      .filter(row => [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite)).sort((a, b) => a.time - b.time) : null;
  }
  // GeckoTerminal recent pool trades (free): newest first, last 24h.
  async function geckoTrades(pool) {
    if (!MINT.test(pool)) return null;
    const data = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/trades`, { ttlMs: 30_000 });
    return Array.isArray(data?.data) ? data.data.map(row => row?.attributes).filter(Boolean) : null;
  }
  async function jupQuote({ inputMint, outputMint, amount, slippageBps }) {
    const query = new URLSearchParams({ inputMint, outputMint, amount: String(amount), slippageBps: String(slippageBps), restrictIntermediateTokens: 'true' });
    return getJson(`https://lite-api.jup.ag/swap/v1/quote?${query}`, { ttlMs: 0 });
  }
  async function jupSwapInstructions({ quoteResponse, userPublicKey }) {
    return getJson('https://lite-api.jup.ag/swap/v1/swap-instructions', { ttlMs: 0, method: 'POST', body: { quoteResponse, userPublicKey,
      wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 500_000, priorityLevel: 'medium' } } } });
  }
  return { getJson, dexTokens, jupPrices, geckoOhlcv, geckoTrades, jupQuote, jupSwapInstructions, GECKO_FRAMES };
}

// Market-activity shape used by the token page, built from DexScreener first.
export function dexMarketActivity(row, { cluster, now = Date.now } = {}) {
  if (!row || row.priceUsd == null) return null;
  const trades = row.buyCount24h != null && row.sellCount24h != null ? row.buyCount24h + row.sellCount24h : null;
  return { mint: row.mint, cluster, source: 'dexscreener', coverage: 'indexed', displayOnly: true, observedAt: new Date(now()).toISOString(),
    name: row.name, symbol: row.symbol, priceUsd: row.priceUsd, marketCapUsd: row.marketCapUsd, liquidityUsd: row.liquidityUsd,
    volume24hUsd: row.volume24hUsd, buyVolume24hUsd: null, sellVolume24hUsd: null, holders: null, tradeCount24h: trades,
    buyCount24h: row.buyCount24h, sellCount24h: row.sellCount24h, priceChangePercent: row.priceChangePercent, lastTradeUnixTime: null };
}
