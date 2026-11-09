// Indexed market summaries are display data, never settlement or balance proof.
export function createBirdeyeMarketFallback({fetchBirdeye, cluster, now = Date.now}) {
  const cache = new Map(), pending = new Map();
  return async function read(mint) {
    if (cluster !== 'mainnet-beta') return null;
    const previous = cache.get(mint);
    if (previous && now() - previous.at < (previous.data ? 60_000 : 10_000)) return previous.data;
    if (pending.has(mint)) return pending.get(mint);
    if (pending.size >= 4) return null;
    const request = (async () => {
      let data = null;
      try {
        const response = await fetchBirdeye('/defi/token_overview', {address:mint, frames:'24h', ui_amount_mode:'raw'});
        const item = response.configured && response.data;
        if (item?.address === mint) {
          const number = (value, signed = false) => value != null && value !== '' && typeof value !== 'boolean'
            && Number.isFinite(Number(value)) && (signed || Number(value) >= 0) ? Number(value) : null;
          const count = value => Number.isSafeInteger(number(value)) ? number(value) : null;
          data = {mint, cluster, source:'birdeye', coverage:'indexed', displayOnly:true,
            observedAt:new Date(now()).toISOString(), name:String(item.name || '').slice(0,80), symbol:String(item.symbol || '').slice(0,20),
            priceUsd:number(item.price), marketCapUsd:number(item.marketCap), liquidityUsd:number(item.liquidity),
            volume24hUsd:number(item.v24hUSD), buyVolume24hUsd:number(item.vBuy24hUSD), sellVolume24hUsd:number(item.vSell24hUSD),
            holders:count(item.holder), tradeCount24h:count(item.trade24h), buyCount24h:count(item.buy24h), sellCount24h:count(item.sell24h),
            priceChangePercent:number(item.priceChange24hPercent,true), lastTradeUnixTime:number(item.lastTradeUnixTime)};
          if (data.priceUsd == null && data.volume24hUsd == null && data.holders == null) data = null;
        }
      } catch { /* Provider failures never expose headers, keys, or upstream bodies. */ }
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(mint,{at:now(),data});
      return data;
    })().finally(() => pending.delete(mint));
    pending.set(mint,request);
    return request;
  };
}
