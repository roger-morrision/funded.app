import { v3RewardExperience } from './v3-reward-experience.mjs';
// Recorded timestamps measure processing latency; they do not replace receipt verification.
export function financialProcessingMetrics(state, cluster, now = Date.now(), {rewards={},bonusEvents=[]}={}) {
  const approvals = [], waiting = [], payouts = [], holders=[],bonuses=[];
  const elapsed = (from, to) => {
    const start = Date.parse(from), end = Date.parse(to);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start && end <= now ? Math.round((end - start) / 1000) : null;
  };
  for (const source of Object.values(state.collections || {})) {
    const launch = state.launches?.[source.mint];
    if (source.status !== 'collected' || source.onchainVerified !== true || source.cluster !== cluster
      || source.scope !== 'per-mint-v3' || !launch?.onchainVerified || launch.cluster !== cluster
      || launch.pumpFeeRoute?.programId !== source.programId || launch.pumpFeeRoute?.router !== source.router) continue;
    const settlement = state.v3Settlements?.[source.signature];
    if (settlement?.status === 'finalized' && settlement.mint === source.mint) {
      const seconds = elapsed(source.recordedAt, settlement.finalizedAt); if (seconds != null) approvals.push(seconds);
    } else { const seconds = elapsed(source.recordedAt, new Date(now).toISOString()); if (seconds != null) waiting.push(seconds); }
  }
  const verified = new Set(v3RewardExperience(state, {}, cluster).events
    .filter(row => row.kind === 'x-paid' && row.feeSourceVerified).map(row => row.signature));
  const counted = new Set();
  for (const [key, claim] of Object.entries(state.v3XClaims || {})) {
    const funding = state.v3CreatorRewardFunding?.[key];
    if (!verified.has(claim.payment?.signature) || counted.has(claim.payment.signature) || funding?.status !== 'finalized' || funding.balanceDeltaVerified !== true) continue;
    const seconds = elapsed(funding.finalizedAt, claim.paidAt); if (seconds != null) { payouts.push(seconds); counted.add(claim.payment.signature); }
  }
  const holderProof=new Set(v3RewardExperience(state,rewards,cluster).events.filter(row=>row.kind==='holder-paid'&&row.feeSourceVerified).map(row=>`${row.mint}:${row.signature}`));
  const countedHolder=new Set(),countedBonus=new Set();
  for(const schedule of Object.values(rewards?.schedules||{})){
    const ids=Array.isArray(schedule.poolIds)?schedule.poolIds:[];
    if(schedule.kind!=='holder'||schedule.asset!=='SOL'||!ids.length||ids.some(id=>!id.startsWith('v3:')))continue;
    const funding=ids.map(id=>state.v3CreatorRewardFunding?.[id.slice(3)]);
    if(funding.some(row=>row?.status!=='finalized'||row.balanceDeltaVerified!==true||!Number.isFinite(Date.parse(row.finalizedAt))))continue;
    const start=funding.map(row=>row.finalizedAt).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1);
    for(const payment of Object.values(schedule.payments||{})){
      const key=`${schedule.mint}:${payment.signature}`;
      if(!holderProof.has(key)||countedHolder.has(key))continue;
      const seconds=elapsed(start,payment.paidAt);if(seconds!=null){holders.push(seconds);countedHolder.add(key);}
    }
  }
  for(const event of bonusEvents){
    const funding=state.v3CommunityFunding?.[event.sourceSignature];
    if(event.kind!=='bonus-paid'||event.feeSourceVerified!==true||funding?.status!=='finalized'||funding.balanceDeltaVerified!==true||countedBonus.has(event.signature))continue;
    const seconds=elapsed(funding.finalizedAt,event.at);if(seconds!=null){bonuses.push(seconds);countedBonus.add(event.signature);}
  }
  const summary = values => {
    values.sort((a,b) => a - b);
    return { samples:values.length, medianSeconds:values.length ? values[Math.floor((values.length - 1) / 2)] : null,
      p95Seconds:values.length ? values[Math.ceil(values.length * .95) - 1] : null };
  };
  return { scope:'recorded-v3-timestamps', collectionToSettlement:summary(approvals),
    approvalBacklog:{ count:waiting.length, oldestSeconds:waiting.length ? waiting.reduce((max, value) => Math.max(max, value), 0) : null },
    fundedToVerifiedXPayment:summary(payouts),
    fundedToVerifiedHolderPayment:summary(holders),fundedToVerifiedBonusPayment:summary(bonuses),
    coverage:'X and holder timing use the latest 100-event V3 projection. Bonus timing uses validated immutable bonus receipts when supplied. Funding-to-payment includes eligibility waiting time; missing or inconsistent timestamps are excluded.' };
}
