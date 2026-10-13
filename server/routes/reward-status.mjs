import { PublicKey } from '@solana/web3.js';
import { automaticRewardStatus } from '../automatic-rewards.mjs';
import { jackpotPreview } from '../jackpot-model.mjs';
import { rewardExperience } from '../reward-experience.mjs';

function pendingV3Buybacks(state) {
  return Object.values(state.v3Settlements || {}).flatMap(row => {
    const lamports = String(row.allocationPlan?.protocol?.buybackLamports || '0');
    if (row.status !== 'finalized' || !/^[1-9]\d*$/.test(lamports)
      || row.allocationPlan?.status !== 'allocated-not-funded') return [];
    return [{ mint:row.mint, sourceCollectionSignature:row.collectionSignature,
      amountLamports:lamports, status:'awaiting-v3-buyback-executor' }];
  });
}

// Dispatch after shared authorization and rate checks; preserve caller route order.
export function createRewardStatusRoutes({
  store, automaticRewardStore, solanaCluster, xFeeReadiness, readFinalizedEvidence, clientKey,
  respond,
}) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleRewardStatusRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/rewards/automatic') {
      const status = automaticRewardStatus(new Date(), await automaticRewardStore.read());
      const x = { ready:false, reasons:['V3 X payout and claim verification are pending activation.'] };
      status.modes.x = 'unavailable';
      const buybackState = await store.read();
      status.modes.buyback = 'accrual-only-execution-unavailable';
      status.routeReadiness = { x, community:{ ready:status.modes.community === 'verified-token-airdrop-cycle', reason:status.modes.community === 'verified-token-airdrop-cycle' ? null : 'A verified migration-time eligibility snapshot and payable funded cycle are required.' }, buyback:{ ready:false, devnetExecutorVerified:false, verifiedV3Burns:0, pending:pendingV3Buybacks(buybackState), reason:'V3 category 6 is locked until an audited purchase and burn path is deployed.' } };
      return json(res, 200, status);
    }
    if (req.method === 'GET' && url.pathname === '/api/buyback/status') {
      const state = await store.read();
      return json(res, 200, { cluster:solanaCluster, custody:'v3-mint-category-vault',
        executionReady:false, mainnetReady:false, pending:pendingV3Buybacks(state),
        receipts:[], historicalV2Receipts:Object.values(state.buybackOrders || {})
          .filter(row => row.status === 'finalized' && row.refundVerified)
          .map(({ signedTransaction, refundTransaction, ...row }) => row) });
    }
    if (req.method === 'GET' && url.pathname === '/api/jackpots/status') {
      if (solanaCluster !== 'devnet' || String(process.env.VITE_JACKPOT_ENABLED || '').toLowerCase() !== 'true')
        return json(res, 404, { error:'Jackpot preview is disabled.' });
      return json(res, 200, jackpotPreview(Math.floor(Date.now() / 1000), solanaCluster));
    }
    if (req.method === 'GET' && url.pathname === '/api/rewards/experience') {
      if (!await store.chargeRpcRate(`reward-experience:${clientKey(req)}`, 1, 30, Math.floor(Date.now() / 60_000) * 60_000))
        return json(res, 429, { error:'Reward proof request limit reached; retry shortly.' });
      let wallet = null, mint = null;
      try {
        if (url.searchParams.has('wallet')) wallet = new PublicKey(url.searchParams.get('wallet')).toBase58();
        if (url.searchParams.has('mint')) mint = new PublicKey(url.searchParams.get('mint')).toBase58();
      } catch { return json(res, 400, { error:'A valid Solana wallet and mint are required.' }); }
      const [state, rewards, evidence] = await Promise.all([store.read(), automaticRewardStore.read().catch(() => null), readFinalizedEvidence()]);
      return json(res, 200, rewardExperience(state, rewards, evidence, solanaCluster, wallet, mint));
    }
    return false;
  };
}
