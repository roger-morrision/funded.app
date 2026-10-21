import { serviceStatus } from '../service-status.mjs';
import { automaticRewardStatus } from '../automatic-rewards.mjs';
import { buildProductionReadiness, isKeeperEnabled } from '../../production-readiness.js';
import { receiptWorkerStatus } from '../receipt-worker-status.mjs';
import { CREATOR_SUPPORT_VERSION } from '../../creator-support-model.js';
import { createReadCache } from '../read-cache.mjs';
import { Connection } from '@solana/web3.js';
import { verifyRecordedV3Settlements } from '../v3-settlement-status.mjs';
import { createSettlementStatusReader } from '../settlement-status-reader.mjs';
import { allocationAuditHash } from '../allocation-audit-hash.mjs';

export function createServiceStatusRoutes({
  store, solanaCluster, solanaRpcUrl, automaticRewardStore, launchPolicyConfig,
  keeperKeypair, v3RouterConfig, birdeyeApiKey, pumpApiUrl, xOAuthConfigured,
  readSolUsdQuote, requireAuthorized, respond, env = process.env,
  readSettlementEvidence, connectionFactory = (url, config) => new Connection(url, config),
}) {
  // Preserve the existing dependency-probe cache, but never use its lifetime to
  // hide a change in the collection, launch policy, or settlement inputs.
  const statusCache = createReadCache({ ttlMs: 60_000, maxEntries: 1 });
  const identity = () => ({ cluster:solanaCluster, build:env.FUNDED_BUILD_ID || CREATOR_SUPPORT_VERSION,
    rpcUrl:solanaRpcUrl, programId:env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,
    approvedHash:env.FUNDED_V3_PROGRAM_DATA_SHA256,
    enabled:env.FUNDED_V3_SETTLEMENT_ENABLED === 'true',
    programEvidenceRpcUrl:process.env.FUNDED_PROGRAM_EVIDENCE_RPC_URL || '' });
  const settlementStatus = createSettlementStatusReader({
    readSnapshot:async () => {
      const config = identity();
      return { identity:config, state:config.cluster === 'devnet' && config.enabled
        ? await store.read() : {} };
    },
    verify:async ({state,identity:config,signal}) => {
      if (readSettlementEvidence) return readSettlementEvidence({state,signal});
      if (config.cluster !== 'devnet' || !config.enabled)
        return { verified:false, scope:'all-recorded-v3-collections', recorded:0,
          checked:0, reason:'v3-settlement-disabled' };
      return verifyRecordedV3Settlements({state,
        connection:connectionFactory(config.rpcUrl, {commitment:'finalized',
          disableRetryOnRateLimit:true, fetch:(target,options) => fetch(target,{...options,
            signal:options?.signal ? AbortSignal.any([signal,options.signal]) : signal})}),
        programId:config.programId,approvedHash:config.approvedHash});
    },
  });
  const json = (...args) => { respond(...args); return true; };
  async function handleServiceStatus(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const config = identity();
      const [base, proof] = await Promise.all([statusCache(allocationAuditHash(config), () => serviceStatus({
        cluster: solanaCluster, build: config.build,
        database: () => store.health(),
        rpc: async () => {
          const response = await fetch(solanaRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] }), signal: AbortSignal.timeout(5000) });
          const data = await response.json();
          if (!response.ok || data.error || typeof data.result !== 'string') throw new Error('RPC unavailable');
          return data.result;
        },
      })), settlementStatus(config)]);
      const currentProof = base.status === 'operational' ? proof : {
        verified:false,scope:'all-recorded-v3-collections',recorded:proof.recorded,checked:0,
        status:'unavailable',reason:'dependencies-unavailable',
      };
      const report = {...base, respondedAt:new Date().toISOString(),
        settlementVerified:currentProof.verified === true, settlementEvidence:currentProof};
      return json(res, 200, report);
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const automaticRewards = automaticRewardStatus(new Date(), await automaticRewardStore.read());
      return json(res, 200, { ok: true, service: 'funded-api', launchPolicy: await launchPolicyConfig(), external: { solanaKeeper: isKeeperEnabled(process.env) && Boolean(keeperKeypair()), automaticRewards: automaticRewards.status === 'active', feeRouter: Boolean(v3RouterConfig()), birdeye: Boolean(birdeyeApiKey), pumpFun: Boolean(pumpApiUrl), xOAuth: xOAuthConfigured(req) } });
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
      const router = v3RouterConfig();
      const keeperConfigured = isKeeperEnabled(process.env) && Boolean(keeperKeypair());
      return json(res, 200, { cluster: solanaCluster, keeperConfigured, routerConfigured: Boolean(router),
        routerScope:'per-mint-v3', routerProgramId:router?.programId.toBase58() || null,
        routerAddress:null, status: router && keeperConfigured ? 'ready-to-verify-v3-router' : 'waiting-for-deployment-config' });
    }
    return false;
  }
  return { handleServiceStatus, handleOperationsStatus, handleKeeperStatus };
}
