import { invalidRequest } from '../http-policy.mjs';
import { settleCreatorFeeClaim } from '../../distribution-policy.js';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createSettlementRoutes({
  body,
  store,
  solanaCluster,
  walletKey,
  referralUplineForWallet,
  queueAutomaticSettlementRewards,
  respond,
}) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleSettlementRoutes(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/settlements/claims') {
      const input = await body(req); const signature = String(input.claimSignature || '').trim(); if (!signature) return json(res, 400, { error: 'claimSignature is required.' });
      const result = await store.update(state => {
        if (state.settlements[signature]) return state.settlements[signature];
        const collection = state.collections?.[signature];
        if (!collection || collection.signature !== signature || collection.status !== 'collected' || collection.attribution !== 'mint-verified'
          || collection.cluster !== solanaCluster || !collection.mint || !Number.isSafeInteger(Number(collection.collectedLamports))
          || Number(collection.collectedLamports) <= 0) throw invalidRequest('A positive, mint-verified collection on the configured cluster is required.');
        const launch = state.launches?.[collection.mint];
        const shares = launch?.feeDistribution?.creatorDirected?.shares;
        if (!launch?.onchainVerified || launch.cluster !== solanaCluster || !launch.creatorWallet || !shares) throw invalidRequest('A verified launch with an immutable fee policy is required.');
        const creatorWallet = walletKey(launch.creatorWallet);
        const policy = { ...shares, xRecipient: launch.feeDistribution.creatorDirected.recipients?.xAccount || null };
        const grossCreatorFees = Number(collection.collectedLamports) / 1_000_000_000;
        const referralRecipients = referralUplineForWallet(state, creatorWallet);
        const settlement = settleCreatorFeeClaim({ claimSignature: signature, grossCreatorFees, asset: 'SOL', claimedAt: collection.recordedAt }, policy, { referralRecipients, fixedFunded: launch.feeDistribution.fixedFunded });
        settlement.creatorWallet = creatorWallet;
        settlement.referralResolution = { source: 'server-referral-graph', directInviter: referralRecipients[0] || null, depth: referralRecipients.length };
        state.settlements[signature] = settlement;
        settlement.fundedApp.referralClaims = settlement.fundedApp.referralLevels
          .filter(level => level.recipient && level.status === 'claimable')
          .map(level => ({ level: level.level, recipient: level.recipient, amount: level.amount, status: 'claimable' }));
        return settlement;
      });
      let automaticRewards = { status:'queued' };
      try { await queueAutomaticSettlementRewards(result); }
      catch (error) { automaticRewards = { status:'queue-failed', reason:String(error.message || error) }; }
      return json(res, 201, { ...result, automaticRewards });
    }
    return false;
  };
}
