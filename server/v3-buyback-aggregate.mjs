import {isDeepStrictEqual} from 'node:util';
import {v3AllocationPlan} from './v3-allocation-plan.mjs';
import {v3BuybackSourceSpent} from './v3-buyback-orders.mjs';

export const aggregateBuybackSource=mint=>`aggregate:${mint}`;
export function activeAggregateOrder(state,mint) {
  return Object.values(state.v3BuybackOrders||{}).find(row=>row.mint===mint
    &&row.sourceKind==='aggregate-collections'&&row.status!=='finalized'&&row.signature);
}
export function aggregatePendingBuybacks(state,rows,programId,enabled) {
  if(!enabled)return rows;
  const result=[...rows],mints=new Set(rows.map(row=>row.mint));
  for(const mint of mints){
    const active=activeAggregateOrder(state,mint);
    if(active){result.push({mint,sourceCollectionSignature:'aggregate',amountLamports:null,status:'verification-pending'});continue;}
    const budget=aggregateSourceBudget(state,mint,programId);
    if(budget.sources.length<2||budget.sources.length>32||budget.total<10000n)continue;
    if(Object.values(state.v3BuybackOrders||{}).some(row=>row.mint===mint&&row.signature&&row.status!=='finalized'))continue;
    for(let i=result.length-1;i>=0;i--)if(result[i].mint===mint)result.splice(i,1);
    result.push({mint,sourceCollectionSignature:'aggregate',amountLamports:String(budget.total),
      sourceCount:budget.sources.length,status:'awaiting-v3-buyback-executor'});
  }
  return result;
}
export function aggregateSourceBudget(state,mint,programId) {
  const sources=[];
  for(const [source,row] of Object.entries(state.v3Settlements||{})) {
    if(row.mint!==mint||row.status!=='finalized')continue;
    const collected=state.collections?.[source];
    if(!collected?.onchainVerified||collected.status!=='collected'||collected.mint!==mint
      ||collected.programId!==programId||row.collectionSignature!==source)throw new Error('Aggregate source identity is unavailable.');
    const allocated=BigInt(row.allocationPlan?.protocol?.buybackLamports||0);
    const remaining=allocated-v3BuybackSourceSpent(state,source,programId);
    if(remaining<0n)throw new Error('Aggregate source accounting conflicts.');
    if(remaining>0n)sources.push({source,amountLamports:String(remaining)});
  }
  sources.sort((a,b)=>a.source.localeCompare(b.source));
  return {sources,total:sources.reduce((sum,row)=>sum+BigInt(row.amountLamports),0n)};
}
export async function verifyAggregateSources({state,mint,programId,connection,loadSettlement}) {
  const launch=state.launches?.[mint];
  if(!launch?.onchainVerified||launch.cluster!=='devnet'||launch.mint!==mint
    ||launch.pumpFeeRoute?.scope!=='per-mint-v3'||launch.pumpFeeRoute.programId!==programId)
    throw new Error('A verified V3 aggregate launch is required.');
  const budget=aggregateSourceBudget(state,mint,programId);
  if(budget.sources.length<2||budget.sources.length>32)throw new Error('Aggregate buyback requires two to 32 remaining sources.');
  for(const {source} of budget.sources) {
    const row=state.v3Settlements[source],collected=state.collections[source];
    const proof=await loadSettlement({connection,signature:row.settlementSignature,programId,mint,
      authority:launch.pumpFeeRoute.initialAuthority,creator:launch.creatorWallet,
      claimId:Buffer.from(collected.claimId,'hex'),expectedLamports:collected.collectedLamports,
      split:launch.pumpFeeRoute.protocolSplit,includePosition:row.allocationPlan?.allocationVersion===2});
    if(!proof||proof.signature!==row.settlementSignature||proof.claimId!==collected.claimId
      ||String(proof.expectedLamports)!==String(collected.collectedLamports))throw new Error('Aggregate settlement proof is unavailable.');
    const plan=v3AllocationPlan({launch,settlement:{...proof,programId,collectionSignature:source,
      settlementSignature:row.settlementSignature}});
    if(!isDeepStrictEqual(plan,row.allocationPlan))throw new Error('Aggregate allocation proof conflicts.');
  }
  return {...budget,launch};
}
