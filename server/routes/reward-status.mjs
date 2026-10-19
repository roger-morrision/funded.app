import { Connection, PublicKey } from '@solana/web3.js';
import { v3AutomaticRewardStatus } from '../v3-automatic-status.mjs';
import { jackpotPreview } from '../jackpot-model.mjs';
import { v3RewardExperience } from '../v3-reward-experience.mjs';
import { readV3BuybackDashboard } from '../v3-buyback-dashboard.mjs';
import { buybackTriggerLamports } from '../devnet-qa-minimums.mjs';
import { v3BuybackNextOrder, v3BuybackSourceSpent } from '../v3-buyback-orders.mjs';
import { onchainBuybackSource } from '../v3-buyback-cycle.mjs';
import { v3BuybackPendingStatus, shouldAttemptV3Buyback,
  MIN_V3_BUYBACK_ORDER_LAMPORTS } from '../v3-buyback-worker-policy.mjs';
import { workerHeartbeatHealth } from '../worker-readiness.mjs';

function pendingV3Buybacks(state, programId) {
  if (!programId) return [];
  return Object.values(state.v3Settlements || {}).flatMap(row => {
    const launch = state.launches?.[row.mint];
    const collection = state.collections?.[row.collectionSignature];
    const lamports = String(row.allocationPlan?.protocol?.buybackLamports || '0');
    if (row.status !== 'finalized' || !/^[1-9]\d*$/.test(lamports)
      || row.allocationPlan?.status !== 'allocated-not-funded'
      || !launch?.onchainVerified || launch.cluster !== 'devnet'
      || launch.pumpFeeRoute?.scope !== 'per-mint-v3'
      || launch.pumpFeeRoute.programId !== programId
      || collection?.signature !== row.collectionSignature
      || collection.mint !== row.mint || collection.status !== 'collected'
      || collection.onchainVerified !== true
      || collection.programId !== programId) return [];
    const order=v3BuybackNextOrder(state, row.collectionSignature);
    const spent=v3BuybackSourceSpent(state,row.collectionSignature,programId);
    const residual=BigInt(lamports)-spent;
    if(residual<0n) return [{mint:row.mint,
      sourceCollectionSignature:row.collectionSignature,amountLamports:lamports,
      status:'inconsistent-v3-buyback-budget'}];
    return residual>0n ? [{ mint:row.mint,
      sourceCollectionSignature:row.collectionSignature,
      amountLamports:String(residual),
      status:v3BuybackPendingStatus(order.row,residual,order.previous
        ? 'verified-burn-residue' : 'awaiting-v3-buyback-executor') }] : [];
  });
}

function pendingUnindexedV3Buybacks(state, dashboard, programId) {
  if (!programId) return [];
  const verified = dashboard.unindexedStatus === 'verified'
    ? (dashboard.unindexedVaults || []).flatMap(vault => {
    if (vault.status !== 'verified' || !/^[1-9]\d*$/.test(String(vault.pendingLamports || ''))
      || Object.values(state.v3Settlements || {}).some(row => row.mint === vault.mint)) return [];
    const source = onchainBuybackSource(vault.mint);
    const order = v3BuybackNextOrder(state, source);
    return [{ mint:vault.mint, sourceCollectionSignature:'onchain',
      amountLamports:vault.pendingLamports,
      status:v3BuybackPendingStatus(order.row,vault.pendingLamports,order.previous
        ? 'verified-burn-residue' : 'awaiting-v3-buyback-executor') }];
    }) : [];
  const known = new Set(verified.map(row => row.mint));
  const reconciling = Object.values(state.v3BuybackOrders || {}).filter(row =>
    row.sourceKind === 'onchain-policy' && row.programId === programId
    && row.signature && row.status !== 'finalized' && !known.has(row.mint)
    && !Object.values(state.v3Settlements || {}).some(settlement => settlement.mint === row.mint))
    .map(row => ({ mint:row.mint, sourceCollectionSignature:'onchain',
      amountLamports:null, status:'verification-pending' }));
  return [...verified, ...reconciling];
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
  store, automaticRewardStore, solanaCluster, readFinalizedEvidence, clientKey,
  respond, env = process.env, solanaRpcUrl = '',
  connectionFactory = url => new Connection(url, 'finalized'),
  readBuybackDashboard = readV3BuybackDashboard,
  readXCapability, readProgramReadiness, requireAuthorized,
  now = () => Date.now(), statusTimeoutMs = 10_000,
}) {
  const json = (...args) => { respond(...args); return true; };
  let buybackSnapshot = null;
  const buybackReads = new Map();
  let programSnapshot = null, programRead = null;
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
  async function currentProgram() {
    if (programSnapshot && now()-programSnapshot.at<15_000) return programSnapshot.value;
    if (!programRead) programRead = (async () => {
      let value;
      try { value = await readProgramReadiness?.(); }
      catch { /* Current program or RPC verification failed closed. */ }
      const matched = value?.ready === true
        && value.programId === env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID;
      const result = { ready:matched,
        programId:value?.programId || null, checkedAt:new Date(now()).toISOString(),
        reasons:matched ? [] : value?.reasons?.length ? value.reasons
          : value?.ready === true ? ['Current V3 program does not match this deployment.']
            : ['Current V3 program and RPC readiness are unavailable.'] };
      programSnapshot = {at:now(),value:result};
      return result;
    })().finally(() => { programRead = null; });
    return programRead;
  }
  async function buybackDashboard(state, thresholdLamports) {
    let dashboard = { status:'unavailable', thresholdLamports:String(thresholdLamports),
      collectedLamports:null, observedLamports:null, triggerReached:false,
      vaults:[], lastBurn:null };
    if (solanaCluster !== 'devnet' || !solanaRpcUrl || !env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID)
      return dashboard;
    const cacheKey=`${env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID}:${thresholdLamports}`;
    if (buybackSnapshot?.key===cacheKey && now()-buybackSnapshot.at<20_000)
      return buybackSnapshot.value;
    try {
      let pending = buybackReads.get(cacheKey);
      if (!pending) {
        pending = (async () => {
          let timer;
          try {
            const deadline = new Promise((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error('Buyback verification timed out.')), 25_000);
              timer.unref?.();
            });
            const value = await Promise.race([readBuybackDashboard({ state,
              programId:env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,thresholdLamports,
              connection:connectionFactory(solanaRpcUrl) }), deadline]);
            value.checkedAt = new Date(now()).toISOString();
            buybackSnapshot = {key:cacheKey,at:now(),value};
            return value;
          } finally { clearTimeout(timer); }
        })();
        buybackReads.set(cacheKey, pending);
      }
      try { dashboard = await pending; }
      finally { if (buybackReads.get(cacheKey) === pending) buybackReads.delete(cacheKey); }
    } catch { /* An unavailable scan cannot establish current execution readiness. */ }
    return dashboard;
  }
  async function currentBuyback(rewards, dashboard, pending, program) {
    const checkedAt = new Date(now()).toISOString();
    const reasons = [];
    if (solanaCluster !== 'devnet') reasons.push('Buyback execution requires Devnet.');
    if (env.FUNDED_V3_BUYBACK_ENABLED !== 'true') reasons.push('V3 buyback execution is disabled.');
    const worker = workerHeartbeatHealth(rewards.buybackWorkerHeartbeat,
      {now:now(),maxAgeMs:180_000,expectedCluster:'devnet'});
    if (!worker.healthy) reasons.push(...worker.reasons.map(reason=>`Buyback worker: ${reason}.`));
    if (program.ready !== true) reasons.push(...program.reasons);
    if (dashboard.status !== 'verified' || dashboard.unindexedStatus !== 'verified')
      reasons.push('Fresh buyback custody and RPC verification are unavailable.');
    if (dashboard.triggerReached !== true) reasons.push('Verified buyback funding is below the execution threshold.');
    if (!pending.some(row => row.status !== 'verification-pending'
      && shouldAttemptV3Buyback(row,{triggerReached:dashboard.triggerReached,now:now()})))
      reasons.push('No verified executable buyback allocation is currently available.');
    return { ready:reasons.length === 0, checkedAt, programCheckedAt:program.checkedAt,
      workerCheckedAt:worker.checkedAt,
      custodyCheckedAt:dashboard.checkedAt || null, reasons:[...new Set(reasons)] };
  }
  async function automaticGates(state) {
    let timer;
    let program={ready:false,checkedAt:null,reasons:['Current V3 program and RPC readiness are unavailable.']};
    let dashboard={status:'unavailable',triggerReached:false};
    try {
      await Promise.race([
        Promise.all([currentProgram().then(value=>{program=value;}),
          buybackDashboard(state,buybackTriggerLamports(solanaCluster,env)).then(value=>{dashboard=value;})]),
        new Promise(resolve=>{timer=setTimeout(resolve,statusTimeoutMs);timer.unref?.();}),
      ]);
    } finally { clearTimeout(timer); }
    return {program,dashboard};
  }
  return async function handleRewardStatusRoutes(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/buyback/worker-heartbeat') {
      if (!requireAuthorized) return json(res, 503, { error:'Worker authorization is unavailable.' });
      if (!requireAuthorized(req,res)) return true;
      if (solanaCluster !== 'devnet') return json(res, 403, { error:'Buyback worker is Devnet-only.' });
      const status = url.searchParams.get('status');
      if (!['ready','degraded','failed'].includes(status))
        return json(res, 400, { error:'A valid worker state is required.' });
      await automaticRewardStore.transaction(state => { state.buybackWorkerHeartbeat = {
        status, cluster:'devnet', at:new Date(now()).toISOString() }; });
      return json(res, 200, { recorded:true });
    }
    if (req.method === 'GET' && url.pathname === '/api/rewards/automatic') {
      const [buybackState, rewards] = await Promise.all([store.read(), automaticRewardStore.read()]);
      const status = v3AutomaticRewardStatus(buybackState, rewards);
      const xPayments = recordedV3XPayments(buybackState, rewards,
        env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID);
      const {program,dashboard} = await automaticGates(buybackState);
      let xCapability;
      try { xCapability = await readXCapability?.(req,program); }
      catch { /* Current authorization or network readiness failed closed. */ }
      const xReasons = [
        ...(program.ready ? [] : program.reasons),
        ...(xCapability?.ready === true ? []
          : xCapability?.reasons?.length ? xCapability.reasons : ['Current X execution gates are unavailable.'])];
      const x = { ready:xReasons.length === 0, executionReady:xReasons.length === 0,
        historicalExecutionVerified:xPayments.length > 0, verifiedV3Payments:xPayments.length,
        checkedAt:new Date(now()).toISOString(), programCheckedAt:program.checkedAt,
        reasons:[...new Set(xReasons)] };
      status.modes.x = xPayments.length ? 'v3-x-payout-recorded' : 'unavailable';
      const recordedBurns = verifiedV3Burns(buybackState);
      const currentBurns = currentDevnetBurns(buybackState);
      const pendingBuybacks = [...pendingV3Buybacks(buybackState,env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID),
        ...pendingUnindexedV3Buybacks(buybackState,dashboard,env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID)];
      const buybackCurrent = await currentBuyback(rewards,dashboard,pendingBuybacks,program);
      status.modes.buyback = currentBurns.length ? 'verified-v3-devnet-execution' : 'accrual-only-execution-unavailable';
      const migrationReady = status.modes.community === 'verified-token-airdrop-cycle';
      const qaClaimReady = status.modes.community === 'v3-community-qa-claim-recorded';
      const communityReason = 'Fresh migration eligibility, funded cycle and claim-worker readiness have not been verified.';
      status.routeReadiness = { x, community:{ ready:false, executionReady:false,
        historicalExecutionVerified:migrationReady || qaClaimReady,
        checkedAt:new Date(now()).toISOString(), reasons:[communityReason],
        qaClaimVerified:qaClaimReady, reason:communityReason },
      buyback:{ ...buybackCurrent, executionReady:buybackCurrent.ready,
        historicalExecutionVerified:recordedBurns.length > 0,
        devnetExecutorVerified:currentBurns.length > 0,
        verifiedV3Burns:currentBurns.length, recordedV3Burns:recordedBurns.length,
        pending:pendingBuybacks,
        reason:buybackCurrent.reasons[0] || null } };
      return json(res, 200, status);
    }
    if (req.method === 'GET' && url.pathname === '/api/buyback/status') {
      const [state,rewards] = await Promise.all([store.read(),automaticRewardStore?.read?.() || {}]);
      const thresholdLamports = buybackTriggerLamports(solanaCluster, env);
      const dashboard = await buybackDashboard(state,thresholdLamports);
      const pending = [...pendingV3Buybacks(state,env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID),
        ...pendingUnindexedV3Buybacks(state,dashboard,env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID)];
      const current = await currentBuyback(rewards,dashboard,pending,await currentProgram());
      return json(res, 200, { cluster:solanaCluster, custody:'v3-mint-category-vault',
        minimumOrderLamports:String(MIN_V3_BUYBACK_ORDER_LAMPORTS),
        executionReady:current.ready, executionCheckedAt:current.checkedAt,
        executionReasons:current.reasons, workerCheckedAt:current.workerCheckedAt,
        historicalExecutionVerified:verifiedV3Burns(state).length > 0,
        automationEnabled:solanaCluster==='devnet'&&env.FUNDED_V3_BUYBACK_ENABLED==='true',
        mainnetReady:false, pending,
        dashboard,
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
