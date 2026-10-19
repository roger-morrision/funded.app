import {allocationAuditHash as bonusHash} from './allocation-audit-hash.mjs';
import {isDeepStrictEqual} from 'node:util';
import {rewardAddresses} from './automatic-reward-chain.mjs';
import {v3DisbursementId} from './v3-disbursement-id.mjs';

// Old unprotected V3 accounts enforced only category-zero totals. Preserve
// their independently verified, already-funded v1 beneficiary rounding. This
// approval cannot create a residual transfer or rewrite an original receipt.
export async function reviewV3LegacyPreservation({state,launch,reviewed,connection,policy,loadFunding}){
  if(!policy.verified||policy.protectedPolicy)throw new Error('Legacy preservation requires the original unprotected V3 policy.');
  const mint=launch.mint,programId=launch.pumpFeeRoute.programId,authority=launch.pumpFeeRoute.initialAuthority;
  const fields=['walletLamports','holderLamports','xLamports'],sources=[];let released=0n;
  for(const item of reviewed){
    const original=item.row.allocationPlan,old=original.creatorDirected,receipts=[];
    for(const[kind,bucket]of[['creator-wallet','v3CreatorWalletPayout'],['creator-reward','v3CreatorRewardFunding']]){
      const row=state[bucket]?.[item.source];if(!row)continue;
      const amount=kind==='creator-wallet'?BigInt(old.walletLamports):BigInt(old.holderLamports)+BigInt(old.xLamports);
      const recipient=kind==='creator-wallet'?launch.creatorWallet:rewardAddresses({programId,authority,mint}).vault.toBase58();
      if(row.status!=='finalized'||row.balanceDeltaVerified!==true||row.mint!==mint||row.amount!==String(amount)||row.recipient!==recipient)
        throw new Error('An uncertain or changed legacy transfer must be reconciled before preservation.');
      const proof=await loadFunding({connection,signature:row.signature,programId,mint,authority,creator:launch.creatorWallet,initialAuthority:authority,
        withdrawalId:v3DisbursementId(kind,item.row.settlementSignature),category:0,amount,recipient,
        split:launch.pumpFeeRoute.protocolSplit,protectedPolicy:false,beneficiary:kind==='creator-wallet'?0:1,
        holderAmount:kind==='creator-wallet'?0n:BigInt(old.holderLamports)});
      if(!proof?.balanceDeltaVerified||proof.signature!==row.signature||proof.amount!==String(amount)||proof.recipient!==recipient||proof.mint!==mint||proof.category!==0)
        throw new Error('Legacy preservation requires exact finalized transfer and balance proof.');
      released+=amount;receipts.push({kind,signature:row.signature,recipient,amount:String(amount)});
    }
    const claim=state.v3XClaims?.[item.source],funding=state.v3CreatorRewardFunding?.[item.source];
    if(claim&&(claim.mint!==mint||claim.fundingSignature!==funding?.signature
      ||claim.amountLamports!==old.xLamports||String(claim.xUserId)!==String(old.xUserId)))
      throw new Error('The old X claim differs from its frozen original allocation.');
    if(!item.used||original.allocationVersion===2||isDeepStrictEqual(old,item.next.creatorDirected))continue;
    if(!receipts.length)throw new Error('Used legacy allocation lacks finalized source funding.');
    const row={collectionSignature:item.source,settlementSignature:item.row.settlementSignature,
      originalPlanHash:bonusHash(original),cumulativeTargetHash:bonusHash(item.next),transferFingerprint:bonusHash(receipts),
      originalCreatorDirected:old,cumulativeRoundingDelta:fields.map(field=>String(BigInt(item.next.creatorDirected[field])-BigInt(old[field]))),
      // No corrective transfer is approved; ordinary unpaid original obligations
      // retain their own creator-signature workflow and unchanged amount.
      unreleasedLamports:['0','0','0'],verifiedTransfers:receipts};
    sources.push(row);
  }
  if(released!==BigInt(policy.withdrawnLamports[0])
    ||BigInt(policy.settledLamports)!==reviewed.reduce((sum,item)=>sum+BigInt(item.proof.expectedLamports),0n))
    throw new Error('Legacy category counters contain missing or conflicting transfer history.');
  if(!sources.length)throw new Error('No used legacy rounding difference requires preservation.');
  const plan={version:1,status:'reviewed-legacy-preservation-no-transfer',mint,programId,
    beneficiaries:{creatorWallet:launch.creatorWallet},sources,
    reason:'Preserve originally funded v1 rounding; do not claw back X funds or reassign them to holders.',
    evidenceScope:'Finalized category transfers; reward-vault funding is not a holder/X recipient payment.'};
  return{...plan,hash:bonusHash(plan)};
}

export function approvedLegacyPreservation(state,source,current){
  for(const[hash,approval]of Object.entries(state.v3AllocationResidualPlans||{})){
    const plan=approval.plan;if(plan?.status!=='reviewed-legacy-preservation-no-transfer')continue;
    const{hash:saved,...frozen}=plan;
    if(!approval.actor||!approval.approvedAt||saved!==hash||bonusHash(frozen)!==hash)continue;
    const row=plan.sources.find(row=>row.collectionSignature===source);
    if(row&&plan.mint===current.mint&&plan.programId===current.programId
      &&row.originalPlanHash===current.originalPlanHash&&row.cumulativeTargetHash===current.cumulativeTargetHash
      &&row.transferFingerprint===current.transferFingerprint)return true;
  }
  return false;
}
