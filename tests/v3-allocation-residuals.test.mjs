import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {v3AllocationPlan} from '../server/v3-allocation-plan.mjs';
import {reviewV3AllocationResiduals,recordV3AllocationResidualPlan} from '../server/v3-allocation-residuals.mjs';
import {rewardAddresses} from '../server/automatic-reward-chain.mjs';
import {residualSourceKey} from '../server/v3-residual-source.mjs';
function fixture(){
  const [mint,creator,authority,program]=Array.from({length:4},(_,n)=>Keypair.fromSeed(Buffer.alloc(32,n+110)).publicKey.toBase58());
  const launch={mint,onchainVerified:true,cluster:'devnet',creatorWallet:creator,
    pumpFeeRoute:{scope:'per-mint-v3',programId:program,initialAuthority:authority},
    feeDistribution:{creatorDirected:{shares:{creatorWalletPercent:70,holderAirdropPercent:10,solClaimPercent:0},recipients:{xAccount:''}}}};
  const state={launches:{[mint]:launch},collections:{},v3Settlements:{}},proofs={};
  for(let n=0;n<2;n++){
    const source=`source${n}`,signature=`settlement${n}`,claimId=String(n+1).repeat(64),pool=n?800002:800001;
    const proof={signature,mint,claimId,expectedLamports:'1000002',
      categoryLamports:n?['800002','80000','20000','6000','4000','40000','50000']:['800001','80000','20000','6000','4000','40000','50001'],
      position:{settledBeforeLamports:String(n*1000002),settledAfterLamports:String((n+1)*1000002),policySettledLamports:'2000004',
        creatorPoolBeforeLamports:n?'800001':'0',creatorPoolAfterLamports:String((n?800001:0)+pool)}};
    proofs[signature]=proof;
    state.collections[source]={signature:source,mint,status:'collected',onchainVerified:true,cluster:'devnet',scope:'per-mint-v3',programId:program,claimId,collectedLamports:1000002};
    state.v3Settlements[source]={mint,collectionSignature:source,settlementSignature:signature,status:'finalized',
      allocationPlan:v3AllocationPlan({launch,settlement:{...proof,position:undefined,programId:program,collectionSignature:source,settlementSignature:signature}})};
  }
  state.v3CreatorWalletPayout={source1:{status:'finalized',balanceDeltaVerified:true,signature:'wallet-payment',mint,amount:'700001',recipient:creator}};
  const policy={verified:true,protectedPolicy:true,settledLamports:2000004n,directedUnits:[7000000,1000000,0],
    paidLamports:[1600003n],directedReleased:[700001n,0n,0n]};
  const store={read:async()=>structuredClone(state),update:async fn=>{const next=structuredClone(state),result=fn(next);Object.assign(state,next);return result;}};
  const options={store,mint,connection:{},loadSettlement:async({signature})=>structuredClone(proofs[signature]),
    verifyPolicy:async()=>structuredClone(policy),loadFunding:async args=>({signature:args.signature,amount:String(args.amount),mint,category:0,recipient:args.recipient,balanceDeltaVerified:true})};
  return {state,policy,options,store,proofs};
}

test('review binds exact paid proof and cumulative caps without replacing used plans or receipts',async()=>{
  const f=fixture(),before=structuredClone(f.state),plan=await reviewV3AllocationResiduals(f.options);
  assert.deepEqual(f.state,before);assert.equal(plan.status,'reviewed-residual-not-paid');
  assert.deepEqual(plan.targetLamports,['1400002','200001','0']);
  assert.deepEqual(plan.releasedLamports,['700001','0','0']);
  assert.deepEqual(plan.sources[1].unreleasedLamports,['1','100000','0']);
  const record=await recordV3AllocationResidualPlan({...f.options,expectedHash:plan.hash,reason:'Reviewed exact finalized rounding residuals.',actor:'qa-admin'});
  assert.equal(record.executionStatus,'not-executed');
  assert.deepEqual(f.state.v3Settlements,before.v3Settlements);assert.deepEqual(f.state.v3CreatorWalletPayout,before.v3CreatorWalletPayout);
  assert.deepEqual(await recordV3AllocationResidualPlan({...f.options,expectedHash:plan.hash,reason:'Repeated reviewed residual approval.',actor:'qa-admin'}),record);
});

test('uncertain, forged, missing and negative paid evidence fails closed without writing',async()=>{
  const pending=fixture();pending.state.v3CreatorWalletPayout.source1.status='verification-pending';
  await assert.rejects(reviewV3AllocationResiduals(pending.options),/uncertain legacy transfer/);
  const forged=fixture();forged.options.loadFunding=async()=>null;
  await assert.rejects(reviewV3AllocationResiduals(forged.options),/exact finalized/);
  const missing=fixture();missing.policy.directedReleased[0]++;
  await assert.rejects(reviewV3AllocationResiduals(missing.options),/missing or conflicting payout history/);
  const negative=fixture(),launch=negative.state.launches[negative.options.mint];
  const vault=rewardAddresses({programId:launch.pumpFeeRoute.programId,authority:launch.pumpFeeRoute.initialAuthority,mint:launch.mint}).vault.toBase58();
  negative.state.v3CreatorRewardFunding={source1:{status:'finalized',signature:'funding',balanceDeltaVerified:true,
    mint:negative.options.mint,amount:'100001',recipient:vault}};
  await assert.rejects(reviewV3AllocationResiduals(negative.options),/residual would be negative/);
  assert.equal(pending.state.v3AllocationResidualPlans,undefined);
  const cap=fixture();cap.policy.paidLamports[0]++;
  await assert.rejects(reviewV3AllocationResiduals(cap.options),/on-chain beneficiary caps/);
  const shares=fixture();shares.policy.directedUnits=[6000000,2000000,0];
  await assert.rejects(reviewV3AllocationResiduals(shares.options),/beneficiary shares differ/);
});

test('changed reviewed evidence and concurrent payment preparation reject audit commit atomically',async()=>{
  const f=fixture(),reviewed=await reviewV3AllocationResiduals(f.options);
  await assert.rejects(recordV3AllocationResidualPlan({...f.options,expectedHash:'a'.repeat(64),reason:'The operator reviewed a stale hash.',actor:'qa-admin'}),/changed after review/);
  const normal=f.store.update;
  f.store.update=async fn=>{f.state.v3CreatorRewardFunding={source0:{status:'verification-pending'}};return normal(fn);};
  await assert.rejects(recordV3AllocationResidualPlan({...f.options,expectedHash:reviewed.hash,reason:'A source was reserved during review.',actor:'qa-admin'}),/changed before audit/);
  assert.equal(f.state.v3AllocationResidualPlans,undefined);
});

test('finalized supplemental transfers consume the reviewed residual and unknown pending attempts block new approvals',async()=>{
  const f=fixture(),source='7'.repeat(64),old='source1';
  const launch=f.state.launches[f.options.mint],row=f.state.v3Settlements[old],proof=f.proofs[row.settlementSignature];
  f.state.collections[source]={...f.state.collections[old],signature:source};delete f.state.collections[old];
  row.collectionSignature=source;row.allocationPlan=v3AllocationPlan({launch,settlement:{...proof,position:undefined,
    programId:launch.pumpFeeRoute.programId,collectionSignature:source,settlementSignature:row.settlementSignature}});
  f.state.v3Settlements[source]=row;delete f.state.v3Settlements[old];
  f.state.v3CreatorWalletPayout[source]=f.state.v3CreatorWalletPayout[old];delete f.state.v3CreatorWalletPayout[old];
  const reviewed=await reviewV3AllocationResiduals(f.options);
  await recordV3AllocationResidualPlan({...f.options,expectedHash:reviewed.hash,reason:'Review the exact one-lamport supplemental payout.',actor:'qa-admin'});
  const key=residualSourceKey(source,reviewed.hash),receipt={status:'finalized',balanceDeltaVerified:true,
    collectionSignature:source,residualPlanHash:reviewed.hash,signature:'residual-payment',amount:'1',mint:launch.mint,recipient:launch.creatorWallet};
  f.state.v3CreatorWalletPayout[key]=receipt;f.policy.directedReleased[0]++;
  const after=await reviewV3AllocationResiduals(f.options);
  assert.equal(after.sources.find(row=>row.collectionSignature===source).unreleasedLamports[0],'0');
  assert.equal(after.releasedLamports[0],'700002');
  receipt.status='verification-pending';
  await assert.rejects(reviewV3AllocationResiduals(f.options),/uncertain or conflicts/);
  f.policy.directedReleased[0]--;
  const retry=await reviewV3AllocationResiduals({...f.options,ignorePendingResidual:{bucket:'v3CreatorWalletPayout',key,signature:receipt.signature}});
  assert.equal(retry.sources.find(row=>row.collectionSignature===source).unreleasedLamports[0],'1');
});
