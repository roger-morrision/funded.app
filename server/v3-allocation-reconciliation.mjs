import { isDeepStrictEqual } from 'node:util';
import { loadFinalizedV3Settlement } from './v3-settlement-proof.mjs';
import { v3AllocationPlan } from './v3-allocation-plan.mjs';
import { createFinalizedReadCache } from './finalized-read-cache.mjs';
import {approvedLegacyPreservation} from './v3-legacy-preservation.mjs';

const usage = (state,source) => [state.v3CreatorWalletPayout?.[source],
  state.v3CreatorRewardFunding?.[source],state.v3XClaims?.[source],
  ...['v3CreatorWalletPayout','v3CreatorRewardFunding','v3XClaims'].flatMap(bucket=>
    Object.entries(state[bucket]||{}).filter(([id])=>id.startsWith(`${source}:residual:`)).sort(([a],[b])=>a.localeCompare(b)))];

// Upgrade only unused creator allocations. Recorded transactions, enrolled
// holder pools and X claims retain their original amounts and source IDs.
export async function readFinalizedV3Allocations({store,connection,mint,loadSettlement=loadFinalizedV3Settlement}) {
  const state = await store.read(), launch = state.launches?.[mint];
  if (!launch?.onchainVerified || launch.cluster!=='devnet' || launch.mint!==mint
    || launch.pumpFeeRoute?.scope!=='per-mint-v3') throw new Error('A verified Devnet V3 launch is required.');
  const entries = Object.entries(state.v3Settlements || {}).filter(([,row])=>row.mint===mint && row.status==='finalized');
  const reviewed=[];
  // The default reader fetches each distinct finalized input once per pass.
  // N claims, T distinct transactions, B target blocks and P history pages
  // need at most T + N + B + P + 2 RPC reads (one policy and one snapshot).
  // Validators still inspect the complete history; no proof survives this pass.
  const proofConnection=createFinalizedReadCache(connection);
  for (const [source,row] of entries) {
    const collection=state.collections?.[source];
    if (!collection || collection.signature!==source || collection.mint!==mint
      || collection.status!=='collected' || collection.onchainVerified!==true
      || collection.cluster!=='devnet' || collection.scope!=='per-mint-v3'
      || collection.programId!==launch.pumpFeeRoute.programId || row.collectionSignature!==source)
      throw new Error('Cumulative allocation requires every matching finalized source collection.');
    const proof=await loadSettlement({connection:proofConnection,signature:row.settlementSignature,
      programId:launch.pumpFeeRoute.programId,mint,authority:launch.pumpFeeRoute.initialAuthority,
      creator:launch.creatorWallet,claimId:Buffer.from(collection.claimId,'hex'),
      expectedLamports:collection.collectedLamports,split:launch.pumpFeeRoute.protocolSplit,includePosition:true});
    if (!proof?.position || proof.signature!==row.settlementSignature
      || proof.claimId!==collection.claimId || proof.expectedLamports!==String(collection.collectedLamports))
      throw new Error('Finalized cumulative settlement evidence is unavailable.');
    const settlement={...proof,programId:launch.pumpFeeRoute.programId,collectionSignature:source,settlementSignature:row.settlementSignature};
    const next=v3AllocationPlan({launch,settlement});
    const original=v3AllocationPlan({launch,settlement:{...settlement,position:row.allocationPlan?.allocationVersion===2?proof.position:undefined}});
    if (!isDeepStrictEqual(original,row.allocationPlan)) throw new Error('The saved allocation differs from finalized source evidence.');
    const used=usage(state,source).some(Boolean);
    reviewed.push({source,row,proof,next,used,usage:usage(state,source)});
  }
  reviewed.sort((a,b)=>BigInt(a.proof.position.settledBeforeLamports)<BigInt(b.proof.position.settledBeforeLamports)?-1:1);
  let cursor=0n, observed=0n;
  for(const row of reviewed){
    const position=row.proof.position;
    if(BigInt(position.settledBeforeLamports)!==cursor)throw new Error('Cumulative allocation source history is incomplete.');
    cursor=BigInt(position.settledAfterLamports);
    observed=BigInt(position.policySettledLamports)>observed?BigInt(position.policySettledLamports):observed;
  }
  if(cursor!==observed)throw new Error('A finalized settlement is missing from the allocation ledger.');
  return {state,launch,reviewed,proofConnection};
}

export async function reconcileV3Allocations(options) {
  const {store,mint}=options;
  const {state,launch,reviewed}=await readFinalizedV3Allocations(options);
  const differences=reviewed.filter(row=>row.used&&!isDeepStrictEqual(row.row.allocationPlan.creatorDirected,row.next.creatorDirected));
  if(differences.length){
    const approvals=Object.values(state.v3AllocationResidualPlans||{}).some(row=>row.plan?.status==='reviewed-legacy-preservation-no-transfer');
    if(!approvals)throw new Error('A previously used legacy allocation needs reviewed rounding reconciliation. Its payment amounts were preserved.');
    const{reviewV3AllocationResiduals}=await import('./v3-allocation-residuals.mjs');
    const preservation=await reviewV3AllocationResiduals(options);
    for(const row of differences){
      const checked=preservation.sources.find(item=>item.collectionSignature===row.source);
      if(preservation.status!=='reviewed-legacy-preservation-no-transfer'||!checked
        ||!approvedLegacyPreservation(state,row.source,{...checked,mint,programId:launch.pumpFeeRoute.programId}))
        throw new Error('A used legacy allocation requires a matching audited preservation approval.');
    }
  }
  const changes=reviewed.filter(row=>!row.used&&!isDeepStrictEqual(row.row.allocationPlan,row.next));
  if(!changes.length)return state;
  await store.update(current=>{
    if(!isDeepStrictEqual(current.launches?.[mint],launch))throw new Error('The signed launch changed during allocation reconciliation.');
    for(const checked of reviewed)if(!isDeepStrictEqual(current.v3Settlements?.[checked.source],checked.row)
      || !isDeepStrictEqual(usage(current,checked.source),checked.usage))throw new Error('Allocation evidence changed during reconciliation.');
    for(const change of changes){
      const row=current.v3Settlements[change.source];
      row.allocationPlanRevisions ||= [];
      row.allocationPlanRevisions.push({plan:row.allocationPlan,reason:'finalized-cumulative-rounding-v2',at:new Date().toISOString()});
      row.allocationPlan=change.next;
    }
  });
  return store.read();
}
