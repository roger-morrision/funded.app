import {requireSolanaCluster} from '../solana-network.js';
export function automaticV3Actions(state,cluster='devnet') {
  requireSolanaCluster(cluster);
  const actions=[];
  for(const [source,settled] of Object.entries(state.v3Settlements||{})){
    const launch=state.launches?.[settled.mint],plan=settled.allocationPlan;
    if(settled.status!=='finalized'||launch?.archivedAt||launch?.onchainVerified!==true
      ||launch.cluster!==cluster||(settled.cluster||'devnet')!==cluster||(plan?.cluster||'devnet')!==cluster||plan?.status!=='allocated-not-funded')continue;
    const rows=[['creator-reward-funding','v3CreatorRewardFunding',String(BigInt(plan.creatorDirected?.holderLamports||0)+BigInt(plan.creatorDirected?.xLamports||0))],
      ['community-funding','v3CommunityFunding',plan.protocol?.communityLamports],
      ['operations-payout','v3OperationsPayout',plan.protocol?.operationsLamports]];
    for(const [action,ledger,amount,level] of rows){
      const key=level?`${source}:${level}`:source;
      if(!/^[1-9]\d*$/.test(String(amount||''))||state[ledger]?.[key])continue;
      actions.push({mint:settled.mint,collectionSignature:source,action,...(level?{level}:{})});
    }
  }
  return actions;
}
