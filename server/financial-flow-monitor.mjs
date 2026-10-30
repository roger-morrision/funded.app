import {v3BuybackSourceSpent} from './v3-buyback-orders.mjs';

const quantity=value=>/^(0|[1-9]\d*)$/.test(String(value))?BigInt(value):null;
const finalized=row=>row?.status==='finalized'&&row.balanceDeltaVerified===true;
// This is a ledger monitor, not a replacement for finalized RPC verification.
export function financialFlowMonitor(state,rewards,{now=Date.now(),programId}={}) {
  const flows=[],alerts=[];
  for(const collection of Object.values(state.collections||{})) {
    const source=collection.signature,launch=state.launches?.[collection.mint];
    if(collection.scope!=='per-mint-v3'||collection.cluster!=='devnet'||!collection.onchainVerified
      ||!launch?.onchainVerified||launch.pumpFeeRoute?.programId!==programId||collection.programId!==programId)continue;
    const settled=state.v3Settlements?.[source];
    if(settled?.status!=='finalized') {
      flows.push({mint:collection.mint,source,kind:'settlement',stage:'awaiting-creator-approval',
        since:collection.recordedAt||null});continue;
    }
    const plan=settled.allocationPlan;
    if(plan?.status!=='allocated-not-funded')continue;
    const kinds=[['creator',plan.creatorDirected?.walletLamports,state.v3CreatorWalletPayout?.[source]],
      ['holder-and-x',String((quantity(plan.creatorDirected?.holderLamports)||0n)+(quantity(plan.creatorDirected?.xLamports)||0n)),state.v3CreatorRewardFunding?.[source]],
      ['bonus',plan.protocol?.communityLamports,state.v3CommunityFunding?.[source]],
      ['operations',plan.protocol?.operationsLamports,state.v3OperationsPayout?.[source]]];
    for(let level=1;level<=3;level++)if(settled.referralUpline?.[level-1])kinds.push([`referral-${level}`,plan.protocol?.referralLamports?.[level-1],
      state.v3ReferralPayouts?.[`${source}:${level}`]]);
    for(const [kind,raw,receipt] of kinds) {
      const amount=quantity(raw);if(amount===null||amount<=0n)continue;
      const stage=finalized(receipt)?(['bonus','holder-and-x'].includes(kind)?'funded':'finalized-recorded')
        :receipt?.signature?'verification-pending':'awaiting-creator-approval';
      flows.push({mint:collection.mint,source,kind,stage,amountLamports:String(amount),
        since:receipt?.startedAt||settled.finalizedAt||collection.recordedAt||null});
    }
    const allocated=quantity(plan.protocol?.buybackLamports);
    if(allocated!==null){
      const spent=v3BuybackSourceSpent(state,source,programId);
      if(spent>allocated)alerts.push({code:'buyback-accounting-conflict',mint:collection.mint,source});
      else if(allocated>spent)flows.push({mint:collection.mint,source,kind:'buyback',
        stage:allocated-spent<10000n?'below-minimum-order':'reserved',amountLamports:String(allocated-spent),
        since:settled.finalizedAt||collection.recordedAt||null});
    }
  }
  for(const schedule of Object.values(rewards.schedules||{})) {
    if(schedule.status==='paid')continue;
    const funded=['prepared','distributing'].includes(schedule.status);
    const due=Number(schedule.payoutAt)*1000;
    if(funded&&Number.isFinite(due)&&now-due>10*60_000)
      alerts.push({code:'funded-payout-overdue',mint:schedule.mint,scheduleId:schedule.id,
        overdueSeconds:Math.floor((now-due)/1000),stage:schedule.status});
  }
  for(const flow of flows){
    const since=Date.parse(flow.since),age=Number.isFinite(since)?Math.max(0,Math.floor((now-since)/1000)):null;
    flow.waitingSeconds=age;
    if(flow.stage==='verification-pending'&&age>600)
      alerts.push({code:'signature-needs-reconciliation',mint:flow.mint,source:flow.source,kind:flow.kind});
  }
  return {scope:'recorded-v3-ledger-monitor',checkedAt:new Date(now).toISOString(),
    status:alerts.length?'attention-required':'observed',counts:{flows:flows.length,alerts:alerts.length},
    flows,alerts,verification:'Each execution must independently reverify finalized on-chain evidence.'};
}

export function startFinancialFlowMonitor({store,automaticRewardStore,env=process.env,logger=console,
  scheduleInterval=setInterval}) {
  let running=false,lastAlertKey='';
  const tick=async()=>{
    if(running)return;running=true;
    try{
      const [state,rewards]=await Promise.all([store.read(),automaticRewardStore.read()]);
      const report=financialFlowMonitor(state,rewards,{programId:env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID});
      const alertKey=JSON.stringify(report.alerts.map(({code,mint,source,scheduleId})=>({code,mint,source,scheduleId})));
      if(alertKey!==lastAlertKey&&report.alerts.length)logger.warn(JSON.stringify({event:'financial_flow_attention',
        count:report.alerts.length,codes:[...new Set(report.alerts.map(row=>row.code))]}));
      lastAlertKey=alertKey;
      await automaticRewardStore.transaction(current=>{current.financialFlowHealth={status:report.status,
        checkedAt:report.checkedAt,counts:report.counts,alerts:report.alerts.slice(0,100),
        oldestApprovalSeconds:Math.max(0,...report.flows.filter(row=>row.stage==='awaiting-creator-approval').map(row=>row.waitingSeconds||0))};});
    }catch{logger.error(JSON.stringify({event:'financial_flow_monitor_unavailable'}));}
    finally{running=false;}
  };
  const timer=scheduleInterval(()=>{void tick();},60_000);timer.unref?.();void tick();
  return {tick,stop:()=>clearInterval(timer)};
}
