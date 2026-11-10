import { createFreeMarketData, dexMarketActivity } from './free-market-data.mjs';
import { createTokenCache } from './token-cache.mjs';
import { createBirdeyeMarketFallback } from './birdeye-market-fallback.mjs';

// Free providers first (DexScreener/Jupiter/GeckoTerminal), paid Birdeye only as
// fallback, plus the discovered-token cache shared by every page.
export function createMarketDataServices({ fetchBirdeye, solanaCluster }) {
  const freeMarketData = createFreeMarketData();
  const tokenCache = createTokenCache({ cluster: solanaCluster });
  const readBirdeyeMarket = createBirdeyeMarketFallback({ fetchBirdeye, cluster: solanaCluster });
  const readMarketFallback = async mint => {
    if (solanaCluster !== 'mainnet-beta') return null;
    const dex = dexMarketActivity((await freeMarketData.dexTokens([mint]).catch(() => new Map())).get(mint), { cluster: solanaCluster });
    return dex || readBirdeyeMarket(mint);
  };
  return { freeMarketData, tokenCache, readBirdeyeMarket, readMarketFallback };
}
