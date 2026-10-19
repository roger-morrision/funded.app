import {isDeepStrictEqual} from 'node:util';
import {bonusHash} from './daily-bonus.mjs';
import {v3DisbursementId} from './v3-disbursement-id.mjs';

const signature=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
export function parseV3SourceKey(value){
  const parts=String(value).split(':residual:');
  if(!signature.test(parts[0])||parts.length>2||parts.length===2&&!/^[a-f0-9]{64}$/.test(parts[1]))
    throw new Error('A valid V3 source and residual identity are required.');
  return {collectionSignature:parts[0],residualPlanHash:parts[1]||null,ledgerKey:String(value)};
}
export function residualSourceKey(source,hash){return parseV3SourceKey(`${source}:residual:${hash}`).ledgerKey;}

// Verify a saved operator approval and retain its original allocation identity.
// Financial callers must additionally reconstruct target from finalized chain
// history and verify released beneficiary counters before a new transfer.
export function v3ResidualAllocation({state,collectionSignature,residualPlanHash,canonicalTarget}){
  const approval=state.v3AllocationResidualPlans?.[residualPlanHash],plan=approval?.plan;
  if(!plan||!approval.actor||!approval.approvedAt)throw new Error('An audited residual approval is required.');
  const {hash,...frozen}=plan;
  if(hash!==residualPlanHash||bonusHash(frozen)!==hash||plan.version!==1||plan.status!=='reviewed-residual-not-paid')
    throw new Error('The approved residual plan changed.');
  const row=plan.sources.find(row=>row.collectionSignature===collectionSignature);
  const settled=state.v3Settlements?.[collectionSignature],original=settled?.allocationPlan;
  if(!row||settled?.status!=='finalized'||row.originalPlanHash!==bonusHash(original)
    ||row.settlementSignature!==settled.settlementSignature||row.target.mint!==settled.mint
    ||plan.mint!==settled.mint||plan.programId!==original.programId
    ||!isDeepStrictEqual(row.target.protocol,original.protocol)
    ||canonicalTarget&&!isDeepStrictEqual(row.target,canonicalTarget))
    throw new Error('The residual approval differs from finalized source allocation.');
  const fields=['walletLamports','holderLamports','xLamports'];
  if(!Array.isArray(row.releasedLamports)||!Array.isArray(row.unreleasedLamports)
    ||row.releasedLamports.length!==3||row.unreleasedLamports.length!==3)
    throw new Error('Residual beneficiary accounting is incomplete.');
  for(let n=0;n<3;n++){
    if(!/^(0|[1-9]\d*)$/.test(row.releasedLamports[n])||!/^(0|[1-9]\d*)$/.test(row.unreleasedLamports[n])
      ||BigInt(row.releasedLamports[n])+BigInt(row.unreleasedLamports[n])!==BigInt(row.target.creatorDirected[fields[n]]))
      throw new Error('Residual beneficiary amounts do not balance.');
  }
  return {approval,source:row,ledgerKey:residualSourceKey(collectionSignature,residualPlanHash),
    allocation:{...row.target,creatorDirected:{...row.target.creatorDirected,
      ...Object.fromEntries(fields.map((field,n)=>[field,row.unreleasedLamports[n]]))}}};
}
export const residualDisbursementId=(kind,settlement,hash)=>v3DisbursementId(`${kind}-residual-${hash}`,settlement);

export function v3SourceAllocation(state,key){
  const identity=key.includes(':residual:')?parseV3SourceKey(key):{collectionSignature:key,ledgerKey:key,residualPlanHash:null};
  const allocation=identity.residualPlanHash?v3ResidualAllocation({state,...identity}).allocation
    :state.v3Settlements?.[identity.collectionSignature]?.allocationPlan;
  return {...identity,allocation};
}

export function v3DisplayAllocation(state,source){
  let reviewed=null;
  for(const [hash,approval] of Object.entries(state.v3AllocationResidualPlans||{})){
    if(!approval.plan?.sources?.some(row=>row.collectionSignature===source))continue;
    const target=v3ResidualAllocation({state,collectionSignature:source,residualPlanHash:hash}).source.target;
    if(reviewed&&!isDeepStrictEqual(reviewed,target))throw new Error('Audited residual targets conflict.');
    reviewed=target;
  }
  return reviewed||state.v3Settlements?.[source]?.allocationPlan;
}
