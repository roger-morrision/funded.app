import { PublicKey } from '@solana/web3.js';
import { v3AutomaticRewardStatus } from '../v3-automatic-status.mjs';
import { jackpotPreview } from '../jackpot-model.mjs';
import { v3RewardExperience } from '../v3-reward-experience.mjs';

function pendingV3Buybacks(state) {
  return Object.values(state.v3Settlements || {}).flatMap(row => {
    const lamports = String(row.allocationPlan?.protocol?.buybackLamports || '0');
    if (row.status !== 'finalized' || !/^[1-9]\d*$/.test(lamports)
      || row.allocationPlan?.status !== 'allocated-not-funded') return [];
    const order=state.v3BuybackOrders?.[row.collectionSignature];
    const burned=order?.status==='finalized'&&order.finalized===true
      &&order.vaultDebitVerified===true&&order.burnInstructionVerified===true;
    const spent=burned ? BigInt(order.spentLamports||'0') : 0n;
    const residual=BigInt(lamports)-spent;
    if(residual<0n) return [{mint:row.mint,
      sourceCollectionSignature:row.collectionSignature,amountLamports:lamports,
      status:'inconsistent-v3-buyback-budget'}];
    return residual>0n ? [{ mint:row.mint,
      sourceCollectionSignature:row.collectionSignature,
      amountLamports:String(residual),
      status:burned?'verified-burn-residue':order?.status||'awaiting-v3-buyback-executor' }] : [];
  });
}

function recordedV3XPayments(state, rewards, programId) {
  if (!programId) return [];
  return Object.entries(state.v3XClaims || {}).flatMap(([source, claim]) => {
    const launch = state.launches?.[claim.mint];
    const collection = state.collections?.[source];
    const settlement = state.v3Settlements?.[source];
    const funding = state.v3CreatorRewardFunding?.[source];
    const plan = settlement?.allocationPlan?.creatorDirected;
    const schedule = rewards.schedules?.[`direct:x:${source}`];
    const payment = schedule?.payments?.[claim.wallet];
    if (claim.status !== 'paid' || !claim.wallet || !claim.payment
      || !launch?.onchainVerified || launch.cluster !== 'devnet'
      || launch.mint !== claim.mint
      || launch.pumpFeeRoute?.scope !== 'per-mint-v3'
      || launch.pumpFeeRoute.verified !== true
      || launch.pumpFeeRoute.programId !== programId
      || String(launch.xUserId) !== String(claim.xUserId)
      || collection?.signature !== source || collection.mint !== claim.mint
      || collection.cluster !== 'devnet' || collection.scope !== 'per-mint-v3'
      || collection.status !== 'collected'
      || collection.onchainVerified !== true || collection.programId !== programId
      || settlement?.status !== 'finalized' || settlement.cluster !== 'devnet'
      || settlement.mint !== claim.mint
      || settlement.collectionSignature !== source
      || String(plan?.xUserId) !== String(claim.xUserId)
      || !/^[1-9]\d*$/.test(String(plan?.xLamports || ''))
      || !/^\d+$/.test(String(plan?.holderLamports || ''))
      || claim.amountLamports !== plan.xLamports
      || funding?.status !== 'finalized' || funding.mint !== claim.mint
      || funding.balanceDeltaVerified !== true
      || funding.amount !== String(BigInt(plan.xLamports) + BigInt(plan.holderLamports))
      || claim.fundingSignature !== funding.signature
      || schedule?.kind !== 'x' || schedule.sourceId !== source
      || schedule.mint !== claim.mint || schedule.asset !== 'SOL'
      || schedule.fundingSignature !== funding.signature
      || schedule.status !== 'paid' || schedule.manifest?.totalAmount !== claim.amountLamports
      || schedule.manifest.leaves?.length !== 1
      || schedule.manifest.leaves[0].recipient !== claim.wallet
      || schedule.manifest.leaves[0].amount !== claim.amountLamports
      || payment?.status !== 'paid' || payment.amount !== claim.amountLamports
      || payment.finalized !== true || payment.balanceDeltaVerified !== true
      || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(payment.signature || ''))
      || claim.payment.signature !== payment.signature
      || claim.payment.amount !== claim.amountLamports
      || claim.payment.finalized !== true
      || claim.payment.balanceDeltaVerified !== true) return [];
    return [payment.signature];
  });
}

// Dispatch after shared authorization and rate checks; preserve caller route order.
export function createRewardStatusRoutes({
  store, automaticRewardStore, solanaCluster, xFeeReadiness, readFinalizedEvidence, clientKey,
  respond, env = process.env,
}) {
  const json = (...args) => { respond(...args); return true; };
  const verifiedV3Burns = state => Object.values(state.v3BuybackOrders || {}).filter(row =>
    row.status === 'finalized' && row.finalized === true
    && row.vaultDebitVerified === true && row.burnInstructionVerified === true);
  const currentDevnetBurns = state => solanaCluster === 'devnet'
    && env.FUNDED_V3_BUYBACK_ENABLED === 'true'
    && env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID
    && /^[a-f0-9]{64}$/i.test(String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || ''))
    ? verifiedV3Burns(state).filter(row =>
      row.programId === env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID
      && row.approvedHash === env.FUNDED_V3_PROGRAM_DATA_SHA256.toLowerCase()) : [];
  return async function handleRewardStatusRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/rewards/automatic') {
      const [buybackState, rewards] = await Promise.all([store.read(), automaticRewardStore.read()]);
      const status = v3AutomaticRewardStatus(buybackState, rewards);
      const xPayments = solanaCluster === 'devnet'
        && env.FUNDED_V3_X_CLAIMS_ENABLED === 'true'
        && /^[a-f0-9]{64}$/i.test(String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || ''))
        ? recordedV3XPayments(buybackState, rewards,
          env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID) : [];
      const x = { ready:xPayments.length > 0, verifiedV3Payments:xPayments.length,
        reasons:xPayments.length ? [] : ['V3 X payout and claim require a finalized Devnet payment.'] };
      status.modes.x = x.ready ? 'v3-x-payout-recorded' : 'unavailable';
      const recordedBurns = verifiedV3Burns(buybackState);
      const currentBurns = currentDevnetBurns(buybackState);
      const buybackReady = currentBurns.length > 0;
      status.modes.buyback = buybackReady ? 'verified-v3-devnet-execution' : 'accrual-only-execution-unavailable';
      status.routeReadiness = { x, community:{ ready:status.modes.community === 'verified-token-airdrop-cycle', reason:status.modes.community === 'verified-token-airdrop-cycle' ? null : 'A verified migration-time eligibility snapshot and payable funded cycle are required.' }, buyback:{ ready:buybackReady, devnetExecutorVerified:buybackReady, verifiedV3Burns:currentBurns.length, recordedV3Burns:recordedBurns.length, pending:pendingV3Buybacks(buybackState), reason:buybackReady ? null : 'No finalized V3 buyback and burn matches the enabled Devnet program.' } };
      return json(res, 200, status);
    }
    if (req.method === 'GET' && url.pathname === '/api/buyback/status') {
      const state = await store.read();
      return json(res, 200, { cluster:solanaCluster, custody:'v3-mint-category-vault',
        executionReady:currentDevnetBurns(state).length > 0, mainnetReady:false, pending:pendingV3Buybacks(state),
        receipts:verifiedV3Burns(state)
          .map(({preparedTransaction,signedTransaction,pumpData,pumpKeys,...row})=>row) });
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
      const [state, rewards] = await Promise.all([store.read(), automaticRewardStore.read().catch(() => null)]);
      return json(res, 200, v3RewardExperience(state, rewards, solanaCluster, wallet, mint));
    }
    return false;
  };
}
