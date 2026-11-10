// Market data for tokens launched outside Richpad (other launchpads and DEX pools).
// DexScreener's public API only covers Mainnet, so other clusters report
// "unsupported-cluster" and the token page shows on-chain facts only.
const DEXSCREENER_ORIGIN = 'https://api.dexscreener.com';
const CACHE_MS = 60_000;
const MAX_CACHE = 500;

const finite = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const httpsUrl = value => {
  try { const url = new URL(String(value)); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
};

// Pick the deepest pool where this mint is the base token and summarize it.
export function summarizeDexPairs(pairs, mint) {
  const rows = (Array.isArray(pairs) ? pairs : [])
    .filter(pair => pair?.chainId === 'solana' && pair?.baseToken?.address === mint);
  if (!rows.length) return null;
  rows.sort((a, b) => (finite(b.liquidity?.usd) ?? 0) - (finite(a.liquidity?.usd) ?? 0));
  const best = rows[0];
  const volume24hUsd = rows.reduce((sum, pair) => sum + (finite(pair.volume?.h24) ?? 0), 0);
  const trades24h = rows.reduce((sum, pair) => sum + (finite(pair.txns?.h24?.buys) ?? 0) + (finite(pair.txns?.h24?.sells) ?? 0), 0);
  const socials = (Array.isArray(best.info?.socials) ? best.info.socials : [])
    .map(item => ({ type: String(item?.type || '').slice(0, 20), url: httpsUrl(item?.url) }))
    .filter(item => item.type && item.url).slice(0, 6);
  const websites = (Array.isArray(best.info?.websites) ? best.info.websites : [])
    .map(item => httpsUrl(item?.url)).filter(Boolean).slice(0, 3);
  return {
    name: String(best.baseToken?.name || '').slice(0, 64) || null,
    symbol: String(best.baseToken?.symbol || '').slice(0, 20) || null,
    imageUrl: httpsUrl(best.info?.imageUrl),
    priceUsd: finite(best.priceUsd),
    priceNative: finite(best.priceNative),
    marketCapUsd: finite(best.marketCap) ?? finite(best.fdv),
    liquidityUsd: finite(best.liquidity?.usd),
    volume24hUsd,
    trades24h,
    priceChange24h: finite(best.priceChange?.h24),
    pairCreatedAt: finite(best.pairCreatedAt),
    dex: String(best.dexId || '').slice(0, 32) || null,
    pairAddress: String(best.pairAddress || '').slice(0, 64) || null,
    pairUrl: httpsUrl(best.url),
    quoteSymbol: String(best.quoteToken?.symbol || '').slice(0, 20) || null,
    poolCount: rows.length,
    socials,
    websites,
  };
}

export function createExternalTokenMarketReader({ solanaCluster, fetch = (...args) => globalThis.fetch(...args), now = Date.now, timeoutMs = 8000 }) {
  const cache = new Map();
  const inflight = new Map();
  return async function readExternalTokenMarket(mint) {
    if (solanaCluster !== 'mainnet-beta') return { mint, cluster: solanaCluster, status: 'unsupported-cluster', market: null };
    const cached = cache.get(mint);
    if (cached && now() - cached.at < CACHE_MS) return cached.data;
    if (!inflight.has(mint)) {
      const pending = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(`${DEXSCREENER_ORIGIN}/tokens/v1/solana/${encodeURIComponent(mint)}`, { redirect: 'error', headers: { accept: 'application/json' }, signal: controller.signal });
          if (!response.ok) throw new Error(`DEX market request failed (${response.status}).`);
          const market = summarizeDexPairs(await response.json(), mint);
          const data = { mint, cluster: solanaCluster, status: market ? 'available' : 'no-pools', market, source: 'DexScreener', observedAt: new Date(now()).toISOString() };
          if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
          cache.set(mint, { at: now(), data });
          return data;
        } finally { clearTimeout(timer); }
      })().finally(() => inflight.delete(mint));
      inflight.set(mint, pending);
    }
    return inflight.get(mint);
  };
}
