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
      const x = { ready:false, reasons:['V3 X payout and claim require a finalized Devnet payment.'] };
      status.modes.x = 'unavailable';
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
