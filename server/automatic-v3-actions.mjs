import { creatorFeeLock } from './launch-protections.mjs';
export function automaticV3Actions(state, now = Date.now()) {
  const actions=[];
  for(const [source,settled] of Object.entries(state.v3Settlements||{})){
    const launch=state.launches?.[settled.mint],plan=settled.allocationPlan;
    if(settled.status!=='finalized'||launch?.archivedAt||launch?.onchainVerified!==true
      ||launch.cluster!=='devnet'||plan?.status!=='allocated-not-funded')continue;
    const rows=[['creator-wallet-payout','v3CreatorWalletPayout',plan.creatorDirected?.walletLamports],
      ['creator-reward-funding','v3CreatorRewardFunding',String(BigInt(plan.creatorDirected?.holderLamports||0)+BigInt(plan.creatorDirected?.xLamports||0))],
      ['community-funding','v3CommunityFunding',plan.protocol?.communityLamports],
      ['operations-payout','v3OperationsPayout',plan.protocol?.operationsLamports]];
    for(let level=1;level<=3;level++)if(settled.referralUpline?.[level-1])rows.push(
      ['referral-payout','v3ReferralPayouts',plan.protocol?.referralLamports?.[level-1],level]);
    for(const [action,ledger,amount,level] of rows){
      if (action === 'creator-wallet-payout' && creatorFeeLock(launch, now).locked) continue;
      const key=level?`${source}:${level}`:source;
      if(!/^[1-9]\d*$/.test(String(amount||''))||state[ledger]?.[key])continue;
      actions.push({mint:settled.mint,collectionSignature:source,action,...(level?{level}:{})});
    }
  }
  return actions;
}
