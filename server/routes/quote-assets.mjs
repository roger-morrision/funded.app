import { quoteAssetCatalog } from '../../stonk-features.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createQuoteAssetsRoutes({
  configuredQuoteAssets, solanaRpcUrl, solanaCluster,
  respond,
}) {
  let verifiedQuoteAssetsCache = null;
  const json = (...args) => { respond(...args); return true; };
  return async function handleQuoteAssetsRoutes(req, res, url, requestId) {
    if (req.method === 'GET' && url.pathname === '/api/quote-assets') {
      if (verifiedQuoteAssetsCache?.expiresAt > Date.now()) return json(res, 200, verifiedQuoteAssetsCache.data);
      const catalog = quoteAssetCatalog(configuredQuoteAssets);
      const rpc = new Connection(solanaRpcUrl, 'confirmed');
      const checked = await Promise.all(catalog.map(async item => {
        if (item.id === 'sol' && item.category === 'native') return { ...item, source: 'Solana native asset', cluster: solanaCluster };
        try {
          const mint = await rpc.getParsedAccountInfo(new PublicKey(item.mint), 'confirmed');
          const validOwner = mint.value?.owner?.equals(TOKEN_PROGRAM_ID) || mint.value?.owner?.equals(TOKEN_2022_PROGRAM_ID);
          return validOwner && mint.value?.data?.parsed?.type === 'mint' ? { ...item, source: 'Solana RPC mint', cluster: solanaCluster } : null;
        } catch { return null; }
      }));
      const data = { chain: 'solana', cluster: solanaCluster, assets: checked.filter(Boolean), status: 'onchain-verified-catalog' };
      verifiedQuoteAssetsCache = { data, expiresAt: Date.now() + 60_000 };
      return json(res, 200, data);
    }
    return false;
  };
}
