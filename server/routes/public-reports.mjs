import { analyticsReceiptTotals } from '../analytics-summary.mjs';
import { CREATOR_SUPPORT_VERSION } from '../../creator-support-model.js';
import { rewardPaidTotals } from '../reward-paid-totals.mjs';
import { feePayoutStats } from '../fee-payout-stats.mjs';
import { homeFeeAllocationSummary } from '../home-dashboard-metrics.mjs';
import { creatorReputation } from '../../stonk-features.js';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createPublicReportsRoutes({
  publicState, store, readReceiptEvidence, readPaymentHistory, automaticRewardStore, readFinalizedEvidence, solanaCluster, databaseUrl,
  respond,
}) {

  const json = (...args) => { respond(...args); return true; };
  return async function handlePublicReportsRoutes(req, res, url, requestId) {
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, publicState(await store.readPublicBuckets()));
    if (req.method === 'GET' && url.pathname === '/api/evidence/receipts') return json(res, 200, await readReceiptEvidence());
    if (req.method === 'GET' && url.pathname === '/api/evidence/payment-history') return json(res, 200, await readPaymentHistory());
    if (req.method === 'GET' && url.pathname === '/api/analytics/summary') {
      const [state, rewards, evidence] = await Promise.all([store.read(), automaticRewardStore.read(), readFinalizedEvidence()]);
      const launches = Object.values(state.launches || {}).filter(row => row.cluster === solanaCluster && row.onchainVerified === true);
      const totals = analyticsReceiptTotals(state, evidence, solanaCluster);
      return json(res, 200, {
        cluster: solanaCluster,
        build: process.env.FUNDED_BUILD_ID || CREATOR_SUPPORT_VERSION,
        source: databaseUrl ? 'funded.app-postgresql' : 'funded.app-file-ledger',
        generatedAt: new Date().toISOString(),
        freshness: evidence.generatedAt || null,
        launches: launches.length,
        ...totals,
        rewardPaid: rewardPaidTotals(state, rewards, evidence, solanaCluster),
        feePayoutStats: feePayoutStats(state, rewards, evidence, solanaCluster),
        homeFeeAllocations: homeFeeAllocationSummary(state, evidence, solanaCluster),
        creatorProfiles: creatorReputation(launches).length,
      });
    }
    return false;
  };
}
