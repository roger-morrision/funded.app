// Free public market sources (DexScreener, Jupiter, GeckoTerminal) with a shared
// response cache, in-flight coalescing and per-host pacing. Callers fall back to
// the paid Birdeye API only when these return nothing.
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const WSOL = 'So11111111111111111111111111111111111111112';

export function createFreeMarketData({ fetch = (...args) => globalThis.fetch(...args), now = Date.now, timeoutMs = 8000, jupiterApiKey = '', jupiterRps = 0 } = {}) {
  // Swap quotes use api.jup.ag with the Jupiter API key (portal.jup.ag) when one
  // is configured and fall back to the keyless lite-api lane (a separate limit)
  // when the keyed lane is busy. Price and token lookups always use lite-api so
  // they never spend the key's swap budget. JUPITER_RPS sets the keyed pace.
  const JUP = jupiterApiKey ? 'https://api.jup.ag' : 'https://lite-api.jup.ag';
  const jupHeaders = jupiterApiKey ? { 'x-api-key': jupiterApiKey } : {};
  const swapGapMs = Math.max(50, Math.round(1000 / (Number(jupiterRps) > 0 ? Number(jupiterRps) : 0.9)));
  const cache = new Map(), inflight = new Map(), nextAt = new Map(), cooldownUntil = new Map();
  const spacing = { 'api.dexscreener.com': 220, 'lite-api.jup.ag': 120, 'api.jup.ag': 120, 'api.geckoterminal.com': 2100 };
  async function pace(host) {
    const wait = (nextAt.get(host) || 0) - now();
    nextAt.set(host, Math.max(now(), nextAt.get(host) || 0) + (spacing[host] || 200));
    if (wait > 0) await new Promise(done => setTimeout(done, Math.min(wait, 5000)));
  }
  // Fresh hits return at once; an expired entry inside its stale window is
  // returned immediately while one background request refreshes it, so page
  // loads never wait on upstream once a token has been seen.
  // Swap calls get their own paced lane (~55/min, Jupiter's free limit) and wait
  // briefly for a slot or a short cooldown instead of failing the user's quote.
  const laneNext = new Map();
  // Swap calls use a rolling 10 s budget (rate × 10 calls) instead of a fixed gap,
  // so a quote and its swap instructions run back to back while the API limit holds.
  const laneCalls = new Map();
  async function paceLane(key, gapMs, maxWaitMs = 8_000) {
    const cool = (cooldownUntil.get(key) || 0) - now();
    if (cool > 0 && cool <= 5_000) await new Promise(done => setTimeout(done, cool));
    const budget = Math.max(1, Math.round(10_000 / gapMs));
    const calls = (laneCalls.get(key) || []).filter(at => at > now() - 10_000).sort((a, b) => a - b);
    const at = calls.length < budget ? now() : calls[calls.length - budget] + 10_000;
    if (at - now() > maxWaitMs) throw Error(`${key} is busy`);
    calls.push(at); laneCalls.set(key, calls);
    if (at > now()) await new Promise(done => setTimeout(done, at - now()));
  }
  const lane = url => { const u = new URL(url); return u.hostname + u.pathname.split('/').slice(0, 3).join('/'); };
  async function getJson(url, { ttlMs = 30_000, method = 'GET', body = null, staleMs = ttlMs * 6, priority = false } = {}) {
    const key = method + ' ' + url + (body ? ' ' + JSON.stringify(body) : '');
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.value;
    const host = new URL(url).hostname;
    const refresh = () => {
      if (inflight.has(key)) return inflight.get(key);
      if (!priority && (cooldownUntil.get(lane(url)) || 0) > now()) return Promise.reject(Error(`${lane(url)} is cooling down`));
      const call = (async () => {
        // Swap quotes skip the shared queue so background price reads never delay a trade.
        if (priority) await paceLane(lane(url), swapGapMs); else await pace(host);
        const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: 'application/json', ...(host === 'api.jup.ag' ? jupHeaders : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        if (response.status === 429 || response.status >= 500) {
          const retry = Number(response.headers.get('retry-after'));
          cooldownUntil.set(lane(url), now() + (Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 60_000) : priority ? 3_000 : 15_000));
        }
        if (!response.ok) {
          const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
          const failure = Error(`${host} request failed (${response.status})${detail ? ': ' + detail : ''}`); failure.status = response.status; throw failure;
        }
        const value = await response.json();
        if (ttlMs > 0) {
          if (cache.size > 3000) for (const [k, row] of cache) if (row.staleUntil <= now()) cache.delete(k);
          cache.set(key, { value, expiresAt: now() + ttlMs, staleUntil: now() + ttlMs + staleMs });
        }
        return value;
      })().finally(() => inflight.delete(key));
      inflight.set(key, call);
      return call;
    };
    if (hit && ttlMs > 0 && hit.staleUntil > now()) { refresh().catch(() => {}); return hit.value; }
    try { return await refresh(); } catch (error) { if (hit) return hit.value; throw error; }
  }
  const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
  const num = value => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

  // Best (deepest-liquidity) DexScreener pair for each mint.
  async function dexTokens(mints) {
    const result = new Map();
    for (const batch of chunks([...new Set(mints.filter(m => MINT.test(m)))], 30)) {
      let pairs = [];
      try { pairs = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(',')}`, { ttlMs: 10_000 }); } catch { continue; }
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
          buyCount24h: num(pair.txns?.h24?.buys), sellCount24h: num(pair.txns?.h24?.sells),
          windows: Object.fromEntries([['5m', 'm5'], ['1h', 'h1'], ['6h', 'h6'], ['24h', 'h24']].map(([key, field]) =>
            [key, { buys: num(pair.txns?.[field]?.buys), sells: num(pair.txns?.[field]?.sells), volumeUsd: num(pair.volume?.[field]) }])), priceChangePercent: num(pair.priceChange?.h24),
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
        const data = await getJson(`https://lite-api.jup.ag/price/v3?ids=${batch.join(',')}`, { ttlMs: 30_000 });
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
    const data = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/${unit}?aggregate=${aggregate}&limit=${Math.min(limit, 1000)}&currency=usd`, { ttlMs: unit === 'minute' ? 20_000 : 60_000 });
    const list = data?.data?.attributes?.ohlcv_list;
    return Array.isArray(list) ? list.map(row => ({ time: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] }))
      .filter(row => [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite)).sort((a, b) => a.time - b.time) : null;
  }
  // GeckoTerminal recent pool trades (free): newest first, last 24h.
  async function geckoTrades(pool) {
    if (!MINT.test(pool)) return null;
    const data = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/trades`, { ttlMs: 8_000 });
    return Array.isArray(data?.data) ? data.data.map(row => row?.attributes).filter(Boolean) : null;
  }
  // Jupiter token search (free): icon, name, symbol, decimals and holder count.
  async function jupToken(mint) {
    if (!MINT.test(mint)) return null;
    const rows = await getJson(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, { ttlMs: 600_000 });
    return Array.isArray(rows) ? rows.find(row => row?.id === mint) || null : null;
  }
  // GeckoTerminal token info (free): holder count and identity.
  async function geckoTokenInfo(mint) {
    if (!MINT.test(mint)) return null;
    const data = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/info`, { ttlMs: 600_000 });
    return data?.data?.attributes || null;
  }
  async function jupQuote({ inputMint, outputMint, amount, slippageBps }) {
    const query = restrict => new URLSearchParams({ inputMint, outputMint, amount: String(amount), slippageBps: String(slippageBps), restrictIntermediateTokens: String(restrict) });
    // Identical quotes within 4 s (refreshes, several viewers) share one call.
    const read = (base, restrict = true) => getJson(`${base}/swap/v1/quote?${query(restrict)}`, { ttlMs: 4_000, staleMs: 0, priority: true });
    // "No route" from one Jupiter host is often transient or caused by the
    // intermediate-token restriction, so try the other host, then an unrestricted route.
    const attempts = [[JUP, true], ...(jupiterApiKey ? [['https://lite-api.jup.ag', true]] : []), [JUP, false]];
    let last;
    for (const [base, restrict] of attempts) {
      try { const quote = await read(base, restrict); if (quote?.outAmount && !quote.error) return quote; last = Object.assign(Error(`no route: ${quote?.error || 'empty quote'}`), { status: 400 }); }
      catch (error) { last = error; }
    }
    throw last;
  }
  async function jupSwapInstructions({ quoteResponse, userPublicKey }) {
    const read = base => getJson(`${base}/swap/v1/swap-instructions`, { ttlMs: 0, priority: true, method: 'POST', body: { quoteResponse, userPublicKey,
      wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 500_000, priorityLevel: 'medium' } } } });
    if (!jupiterApiKey) return read(JUP);
    try { return await read(JUP); } catch (error) { if (error?.status === 400) throw error; return read('https://lite-api.jup.ag'); }
  }
  return { getJson, dexTokens, jupPrices, geckoOhlcv, geckoTrades, geckoTokenInfo, jupToken, jupQuote, jupSwapInstructions, GECKO_FRAMES };
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
