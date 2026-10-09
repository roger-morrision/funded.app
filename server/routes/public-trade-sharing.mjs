import { Connection } from '@solana/web3.js';
import { publicTradeShareConfig, createPublicTradeConsent } from '../x-public-trade-consent.mjs';
import { createXProfitVerifier } from '../x-profit-proof.mjs';
import { readJsonBody } from '../request-body.mjs';

// Public endpoints keep their own exact-origin, rate, and consent checks.
export function createPublicTradeSharingRoutes({ store, solanaCluster, solanaRpcUrl, clientKey, respond }) {
  const publicTradeConfig = publicTradeShareConfig(process.env, solanaCluster);
  const publicTradeConsent = createPublicTradeConsent({ store, config: publicTradeConfig,
    verifyTrade: publicTradeConfig.enabled ? createXProfitVerifier({
      connection: new Connection(solanaRpcUrl, { commitment: 'finalized', disableRetryOnRateLimit: true,
        fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) }),
      publicOrigin: publicTradeConfig.origin, xAccount: publicTradeConfig.account,
      appFeeRecipient: process.env.FUNDED_TRADE_FEE_OWNER || process.env.VITE_FUNDED_TRADE_FEE_OWNER || null,
    }) : async () => { throw new Error('Disabled'); } });

  const json = (...args) => { respond(...args); return true; };
  return async function handlePublicTradeSharing(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/x-public-trade-shares/config') return json(res, 200, publicTradeConfig);
    if (req.method === 'POST' && ['/api/x-public-trade-shares/challenge', '/api/x-public-trade-shares/consent'].includes(url.pathname)) {
      if (!publicTradeConfig.enabled) return json(res, 404, { error: 'Public trade sharing is unavailable.' });
      const origin = String(req.headers.origin || '');
      if (origin !== publicTradeConfig.origin) return json(res, 403, { error: 'Open trade sharing from the configured app origin.' });
      const minute = Math.floor(Date.now() / 60000) * 60000;
      if (!await store.chargeRpcRate(`x-public-share:${clientKey(req)}`, 1, 6, minute)
        || !await store.chargeRpcRate('x-public-share:global', 1, 60, minute)) return json(res, 429, { error: 'Please wait before requesting another public share.' });
      const input = await readJsonBody(req, { maxBytes: 4096, timeoutMs: 5000 });
      if (url.pathname.endsWith('/challenge')) return json(res, 201, await publicTradeConsent.prepare(input, origin));
      const result = await publicTradeConsent.accept(input, origin);
      return json(res, result.created ? 201 : 200, result.share);
    }
    return false;
  };
}
