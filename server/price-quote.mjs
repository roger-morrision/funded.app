export function createSolUsdQuoteReader({ fetchImpl = globalThis.fetch, now = Date.now, ttlMs = 60_000, retryMs = 10_000 } = {}) {
  let cached = null;
  let expiresAt = 0;
  let retryAt = 0;
  let pending = null;
  return async function read(configuredValue) {
    const configured = Number(configuredValue);
    if (Number.isFinite(configured) && configured > 0) {
      return { priceUsd: configured, source: 'server-config', fetchedAt: new Date(now()).toISOString() };
    }
    if (cached && expiresAt > now()) return cached;
    if (pending) return pending;
    // An expired quote is never returned for checkout.
    if (retryAt > now()) return null;
    pending = (async () => {
      try {
        const response = await fetchImpl('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
          headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000),
        });
        const data = await response.json();
        const priceUsd = Number(data?.solana?.usd);
        if (!response.ok || !Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error('Invalid price');
        cached = { priceUsd, source: 'coingecko', fetchedAt: new Date(now()).toISOString() };
        expiresAt = now() + ttlMs;
        retryAt = 0;
        return cached;
      } catch {
        retryAt = now() + retryMs;
        return null;
      } finally { pending = null; }
    })();
    return pending;
  };
}
