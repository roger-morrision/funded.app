import { serviceStatus } from '../service-status.mjs';
import { automaticRewardStatus } from '../automatic-rewards.mjs';
import { buildProductionReadiness, isKeeperEnabled } from '../../production-readiness.js';
import { receiptWorkerStatus } from '../receipt-worker-status.mjs';
import { CREATOR_SUPPORT_VERSION } from '../../creator-support-model.js';
import { createReadCache } from '../read-cache.mjs';

export function createServiceStatusRoutes({
  store, solanaCluster, solanaRpcUrl, automaticRewardStore, launchPolicyConfig,
  keeperKeypair, feeRouterConfig, birdeyeApiKey, pumpApiUrl, xOAuthConfigured,
  readSolUsdQuote, requireAuthorized, respond,
}) {
  const statusCache = createReadCache({ ttlMs: 15_000, maxEntries: 1 });
  const json = (...args) => { respond(...args); return true; };
  async function handleServiceStatus(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const report = await statusCache('service-status', () => serviceStatus({
        cluster: solanaCluster, build: process.env.FUNDED_BUILD_ID || CREATOR_SUPPORT_VERSION,
        database: () => store.health(),
        rpc: async () => {
          const response = await fetch(solanaRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] }), signal: AbortSignal.timeout(5000) });
          const data = await response.json();
          if (!response.ok || data.error || typeof data.result !== 'string') throw new Error('RPC unavailable');
          return data.result;
        },
      }));
      return json(res, 200, report);
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const automaticRewards = automaticRewardStatus(new Date(), await automaticRewardStore.read());
      return json(res, 200, { ok: true, service: 'funded-api', launchPolicy: launchPolicyConfig(), external: { solanaKeeper: isKeeperEnabled(process.env) && Boolean(keeperKeypair()), automaticRewards: automaticRewards.status === 'active', feeRouter: Boolean(feeRouterConfig()), birdeye: Boolean(birdeyeApiKey), pumpFun: Boolean(pumpApiUrl), xOAuth: xOAuthConfigured(req) } });
    }
    if (req.method === 'GET' && url.pathname === '/api/market/sol-usd') {
      const quote = await readSolUsdQuote();
      if (!quote) return json(res, 503, { error: 'SOL/USD quote is currently unavailable.', provider: 'coingecko' });
      return json(res, 200, quote);
    }
    return false;
  }
  async function handleOperationsStatus(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/readiness') return json(res, 200, buildProductionReadiness(process.env));
    if (req.method === 'GET' && url.pathname === '/api/ops/receipt-worker') {
      res.setHeader('cache-control','no-store');
      if(!requireAuthorized(req,res))return true;
      if(solanaCluster!=='devnet')return json(res,503,{error:'Receipt worker monitoring is unavailable for this configuration.'});
      return json(res,200,receiptWorkerStatus(await store.readReceiptBackfillStatus('devnet')));
    }
    return false;
  }
  async function handleKeeperStatus(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/keeper/status') {
      const router = feeRouterConfig();
      const keeperConfigured = isKeeperEnabled(process.env) && Boolean(keeperKeypair());
      return json(res, 200, { cluster: solanaCluster, keeperConfigured, routerConfigured: Boolean(router), routerAddress: router?.address?.toBase58() || null, status: router && keeperConfigured ? 'ready-to-verify-router' : 'waiting-for-deployment-config' });
    }
    return false;
  }
  return { handleServiceStatus, handleOperationsStatus, handleKeeperStatus };
}
