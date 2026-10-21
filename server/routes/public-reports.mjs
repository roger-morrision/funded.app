import { CREATOR_SUPPORT_VERSION } from '../../creator-support-model.js';
import { homeFeeAllocationSummary } from '../home-dashboard-metrics.mjs';
import { creatorReputation } from '../../stonk-features.js';
import { v3PublicMetrics, v3ReceiptEvidence } from '../v3-public-metrics.mjs';
import { createAnalyticsSummaryReader } from '../analytics-summary-reader.mjs';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createPublicReportsRoutes({
  publicState, store, readReceiptEvidence, readPaymentHistory, automaticRewardStore, readFinalizedEvidence, solanaCluster, databaseUrl,
  respond,
}) {
  const readSummary = createAnalyticsSummaryReader([
    () => store.read(), () => automaticRewardStore.read(),
    () => readFinalizedEvidence(), () => readPaymentHistory(),
  ]);

  const json = (...args) => { respond(...args); return true; };
  return async function handlePublicReportsRoutes(req, res, url, requestId) {
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, publicState(await store.readPublicBuckets()));
    if (req.method === 'GET' && url.pathname === '/api/evidence/receipts') {
      const [state, evidence] = await Promise.all([store.read(), readFinalizedEvidence()]);
      return json(res, 200, v3ReceiptEvidence(state, evidence, solanaCluster));
    }
    if (req.method === 'GET' && url.pathname === '/api/evidence/payment-history') return json(res, 200, await readPaymentHistory());
    if (req.method === 'GET' && url.pathname === '/api/analytics/summary') {
      const input = await readSummary();
      if (!input.available) return json(res, 503, { status:'unavailable', retryable:true,
        error:'Analytics is temporarily unavailable. Please try again shortly.' });
      const [state, rewards, evidence, history] = input.values;
      const launches = Object.values(state.launches || {}).filter(row => row.cluster === solanaCluster
        && row.onchainVerified === true && row.pumpFeeRoute?.scope === 'per-mint-v3');
      const { v3Evidence, ...totals } = v3PublicMetrics(state, evidence, history, rewards, solanaCluster);
      return json(res, 200, {
        cluster: solanaCluster,
        build: process.env.FUNDED_BUILD_ID || CREATOR_SUPPORT_VERSION,
        source: databaseUrl ? 'funded.app-postgresql' : 'funded.app-file-ledger',
        generatedAt: new Date().toISOString(),
        freshness: evidence.generatedAt || null,
        launches: launches.length,
        ...totals,
        homeFeeAllocations: homeFeeAllocationSummary(state, v3Evidence, solanaCluster),
        creatorProfiles: creatorReputation(launches).length,
      });
    }
    return false;
  };
}
