import {isDeepStrictEqual} from 'node:util';
import {verifyMintPolicyV3Account,directedGrossUnits} from '../mint-router-v3.js';
import {rewardAddresses} from './automatic-reward-chain.mjs';
import {readFinalizedV3Allocations} from './v3-allocation-reconciliation.mjs';
import {loadFinalizedV3RewardFunding} from './v3-reward-funding-proof.mjs';
import {v3DisbursementId} from './v3-disbursement-id.mjs';
import {allocationAuditHash as bonusHash} from './allocation-audit-hash.mjs';
import {parseV3SourceKey,v3ResidualAllocation,residualDisbursementId} from './v3-residual-source.mjs';
import {reviewV3LegacyPreservation} from './v3-legacy-preservation.mjs';

const fields=['walletLamports','holderLamports','xLamports'];
const vector=plan=>fields.map(key=>BigInt(plan.creatorDirected[key]));

// Review is read-only. A residual plan is an obligation, never proof of a
// transfer. Original plans and all existing receipts remain untouched.
export async function reviewV3AllocationResiduals({verifyPolicy=verifyMintPolicyV3Account,
  loadFunding=loadFinalizedV3RewardFunding,ignorePendingResidual=null,...options}){
  const {state,launch,reviewed,proofConnection:connection}=await readFinalizedV3Allocations(options);
  const {mint}=options,programId=launch.pumpFeeRoute.programId,authority=launch.pumpFeeRoute.initialAuthority;
  const policy=await verifyPolicy({connection,programId,mint,creator:launch.creatorWallet,initialAuthority:authority,split:launch.pumpFeeRoute.protocolSplit});
  if(policy?.verified&&!policy.protectedPolicy)return reviewV3LegacyPreservation({state,launch,reviewed,connection,policy,loadFunding});
  if(!policy?.verified||!policy.protectedPolicy||!Array.isArray(policy.directedReleased)||policy.directedReleased.length!==3)
    throw new Error('Residual review requires a verified protected V3 policy and released beneficiary counters.');
  if(!isDeepStrictEqual(policy.directedUnits,directedGrossUnits(launch.feeDistribution?.creatorDirected?.shares)))
    throw new Error('The launch beneficiary shares differ from the immutable on-chain policy.');
  const paidTotals=[0n,0n,0n],targetTotals=[0n,0n,0n],sources=[];
  for(const item of reviewed){
    const original=item.row.allocationPlan,target=vector(item.next),paid=[0n,0n,0n];
    const residualReceipts=[];
    const wallet=state.v3CreatorWalletPayout?.[item.source],funded=state.v3CreatorRewardFunding?.[item.source];
    if(state.v3XClaims?.[item.source]&&!funded)throw new Error('An X claim lacks its original source funding; reconcile that proof first.');
    for(const [kind,receipt] of [['creator-wallet',wallet],['creator-reward',funded]]){
      if(!receipt)continue;
      if(receipt.status!=='finalized'||receipt.balanceDeltaVerified!==true||!receipt.signature)
        throw new Error('A prepared or uncertain legacy transfer must be finalized or proven expired before residual review.');
      const old=vector(original),amount=kind==='creator-wallet'?old[0]:old[1]+old[2];
      const recipient=kind==='creator-wallet'?launch.creatorWallet:rewardAddresses({programId,authority,mint}).vault.toBase58();
      const proof=await loadFunding({connection,signature:receipt.signature,programId,mint,authority,
        creator:launch.creatorWallet,initialAuthority:authority,withdrawalId:v3DisbursementId(kind,item.row.settlementSignature),
        category:0,amount,recipient,split:launch.pumpFeeRoute.protocolSplit,protectedPolicy:true,
        beneficiary:kind==='creator-wallet'?0:1,holderAmount:kind==='creator-wallet'?0n:old[1]});
      if(!proof?.balanceDeltaVerified||proof.signature!==receipt.signature||proof.amount!==String(amount)
        ||proof.mint!==mint||proof.category!==0||proof.recipient!==recipient
        ||receipt.mint!==mint||receipt.amount!==String(amount)||receipt.recipient!==recipient)
        throw new Error('A legacy transfer lacks exact finalized beneficiary and balance proof.');
      if(kind==='creator-wallet')paid[0]=old[0];else{paid[1]=old[1];paid[2]=old[2];}
    }
    for(const [bucket,kind] of [['v3CreatorWalletPayout','creator-wallet'],['v3CreatorRewardFunding','creator-reward']]){
      for(const [key,receipt] of Object.entries(state[bucket]||{})){
        if(!key.startsWith(`${item.source}:residual:`))continue;
        if(ignorePendingResidual?.bucket===bucket&&ignorePendingResidual.key===key
          &&ignorePendingResidual.signature===receipt.signature&&receipt.status==='verification-pending')continue;
        const identity=parseV3SourceKey(key),approved=v3ResidualAllocation({state,...identity,canonicalTarget:item.next});
        if(receipt.residualPlanHash!==identity.residualPlanHash||receipt.collectionSignature!==item.source
          ||receipt.status!=='finalized'||receipt.balanceDeltaVerified!==true)
          throw new Error('A residual transfer is uncertain or conflicts with its audited approval.');
        const amounts=vector(approved.allocation),amount=kind==='creator-wallet'?amounts[0]:amounts[1]+amounts[2];
        const recipient=kind==='creator-wallet'?launch.creatorWallet:rewardAddresses({programId,authority,mint}).vault.toBase58();
        const proof=await loadFunding({connection,signature:receipt.signature,programId,mint,authority,creator:launch.creatorWallet,
          initialAuthority:authority,withdrawalId:residualDisbursementId(kind,item.row.settlementSignature,identity.residualPlanHash),
          category:0,amount,recipient,split:launch.pumpFeeRoute.protocolSplit,protectedPolicy:true,
          beneficiary:kind==='creator-wallet'?0:1,holderAmount:kind==='creator-wallet'?0n:amounts[1]});
        if(amount<=0n||!proof?.balanceDeltaVerified||proof.signature!==receipt.signature||proof.amount!==String(amount)
          ||proof.mint!==mint||proof.category!==0||proof.recipient!==recipient||receipt.mint!==mint
          ||receipt.amount!==String(amount)||receipt.recipient!==recipient)
          throw new Error('A residual transfer lacks exact finalized beneficiary and balance proof.');
        if(kind==='creator-wallet')paid[0]+=amounts[0];else{paid[1]+=amounts[1];paid[2]+=amounts[2];}
        residualReceipts.push({key,kind,signature:receipt.signature,recipient,amount:String(amount)});
      }
    }
    if(target.some((amount,index)=>amount<paid[index]))
      throw new Error('A residual would be negative for an already funded beneficiary; no clawback or recipient reallocation is authorized.');
    target.forEach((amount,index)=>{targetTotals[index]+=amount;paidTotals[index]+=paid[index];});
    const unpaid=target.map((amount,index)=>amount-paid[index]);
    sources.push({collectionSignature:item.source,settlementSignature:item.row.settlementSignature,
      originalPlanHash:bonusHash(original),target:item.next,releasedLamports:paid.map(String),
      unreleasedLamports:unpaid.map(String),receiptHash:bonusHash({wallet:wallet||null,funding:funded||null,xClaim:state.v3XClaims?.[item.source]||null,residualReceipts}),
      verifiedTransfers:[wallet&&{kind:'creator-wallet',signature:wallet.signature,recipient:wallet.recipient,amount:wallet.amount},
        funded&&{kind:'reward-vault-funding',signature:funded.signature,recipient:funded.recipient,amount:funded.amount},...residualReceipts].filter(Boolean)});
  }
  if(BigInt(policy.settledLamports)!==reviewed.reduce((sum,item)=>sum+BigInt(item.proof.expectedLamports),0n)
    ||paidTotals.some((amount,index)=>amount!==BigInt(policy.directedReleased[index])))
    throw new Error('Current on-chain beneficiary counters contain missing or conflicting payout history.');
  const pool=BigInt(policy.paidLamports[0]),caps=policy.directedUnits.map((units,index)=>{
    const cumulative=policy.directedUnits.slice(0,index+1).reduce((sum,value)=>sum+value,0);
    return pool*BigInt(cumulative)/8000000n-pool*BigInt(cumulative-units)/8000000n;
  });
  if(caps.some((cap,index)=>cap!==targetTotals[index]))throw new Error('Residual targets do not match current on-chain beneficiary caps.');
  const plan={version:1,status:'reviewed-residual-not-paid',mint,programId,
    beneficiaries:{creatorWallet:launch.creatorWallet,rewardVault:rewardAddresses({programId,authority,mint}).vault.toBase58(),xUserId:launch.xUserId||null},
    evidenceScope:'protected-policy-withdrawals; holder/X vault funding is not a recipient payout',
    policySettledLamports:String(policy.settledLamports),directedUnits:policy.directedUnits,releasedLamports:paidTotals.map(String),
    targetLamports:targetTotals.map(String),unreleasedLamports:targetTotals.map((amount,index)=>String(amount-paidTotals[index])),sources};
  return {...plan,hash:bonusHash(plan)};
}

// This records operator approval only. It deliberately does not replace an
// original allocation or make a signed transfer through the legacy route.
export async function recordV3AllocationResidualPlan({expectedHash,reason,actor,...options}){
  if(!/^[a-f0-9]{64}$/.test(String(expectedHash))||typeof reason!=='string'||reason.trim().length<10||!actor)
    throw new Error('Residual approval requires a reviewed hash, authenticated operator and audit reason.');
  const before=await options.store.read(),plan=await reviewV3AllocationResiduals(options);
  if(plan.hash!==expectedHash)throw new Error('Residual evidence changed after review.');
  return options.store.update(state=>{
    if(!isDeepStrictEqual(state.launches?.[options.mint],before.launches?.[options.mint])
      ||!isDeepStrictEqual(state.collections,before.collections)
      ||!isDeepStrictEqual(state.v3Settlements,before.v3Settlements)
      ||!isDeepStrictEqual(state.v3CreatorWalletPayout,before.v3CreatorWalletPayout)
      ||!isDeepStrictEqual(state.v3CreatorRewardFunding,before.v3CreatorRewardFunding)
      ||!isDeepStrictEqual(state.v3XClaims,before.v3XClaims))throw new Error('Residual history changed before audit commit.');
    state.v3AllocationResidualPlans||={};
    const existing=state.v3AllocationResidualPlans[plan.hash];
    if(existing)return existing;
    return state.v3AllocationResidualPlans[plan.hash]={plan,actor,reason:reason.trim().slice(0,500),approvedAt:new Date().toISOString(),executionStatus:'not-executed'};
  });
}
