import test from 'node:test';
import assert from 'node:assert/strict';
import { v3AllocationPlan } from '../server/v3-allocation-plan.mjs';
import { reconcileV3Allocations } from '../server/v3-allocation-reconciliation.mjs';
const launch={mint:'mint',onchainVerified:true,cluster:'devnet',creatorWallet:'creator',pumpFeeRoute:{scope:'per-mint-v3',programId:'program',initialAuthority:'authority'},feeDistribution:{creatorDirected:{shares:{creatorWalletPercent:70,holderAirdropPercent:10,solClaimPercent:0},recipients:{xAccount:''}}}};
function fixture(){
 const state={launches:{mint:launch},collections:{},v3Settlements:{}};const proofs={};
 for(let i=0;i<2;i++){
  const source=`source${i}`,signature=`settlement${i}`,claimId=String(i+1).repeat(64),pool=i?800002:800001;
  const proof={signature,mint:'mint',claimId,expectedLamports:'1000002',categoryLamports:i?['800002','80000','20000','6000','4000','40000','50000']:['800001','80000','20000','6000','4000','40000','50001'],
    position:{settledBeforeLamports:String(i*1000002),settledAfterLamports:String((i+1)*1000002),policySettledLamports:'2000004',creatorPoolBeforeLamports:i?'800001':'0',creatorPoolAfterLamports:String((i?800001:0)+pool)}};
  proofs[signature]=proof;
  state.collections[source]={signature:source,mint:'mint',status:'collected',onchainVerified:true,cluster:'devnet',scope:'per-mint-v3',programId:'program',claimId,collectedLamports:1000002};
  state.v3Settlements[source]={mint:'mint',collectionSignature:source,settlementSignature:signature,status:'finalized',allocationPlan:v3AllocationPlan({launch,settlement:{...proof,position:undefined,programId:'program',collectionSignature:source,settlementSignature:signature}})};
 }
 const store={read:async()=>structuredClone(state),update:async fn=>{const next=structuredClone(state),result=fn(next);Object.assign(state,next);return result;}};
 return{state,store,args:{store,connection:{},mint:'mint',loadSettlement:async({signature})=>structuredClone(proofs[signature])}};
}
test('repeated settlement allocations exactly reach cumulative contract caps and retain prior paid sources',async()=>{
 const f=fixture();f.state.v3CreatorRewardFunding={source0:{status:'finalized',amount:'100001'}};
 const prior=structuredClone(f.state.v3Settlements.source0);
 await reconcileV3Allocations(f.args);
 const plans=Object.values(f.state.v3Settlements).map(row=>row.allocationPlan);
 assert.equal(plans.reduce((sum,row)=>sum+BigInt(row.creatorDirected.holderLamports),0n),200001n);
 assert.equal(plans.reduce((sum,row)=>sum+BigInt(row.creatorDirected.walletLamports),0n),1400002n);
 assert.deepEqual(f.state.v3Settlements.source0,prior);
 assert.equal(plans[1].creatorDirected.holderLamports,'100000');assert.equal(plans[1].allocationVersion,2);
 assert.equal(f.state.v3Settlements.source1.allocationPlanRevisions.length,1);
 await reconcileV3Allocations(f.args);assert.equal(f.state.v3Settlements.source1.allocationPlanRevisions.length,1);
});
test('a prepared divergent legacy payment is preserved and blocks automatic plan changes',async()=>{
 const f=fixture();f.state.v3CreatorWalletPayout={source1:{status:'verification-pending'}};
 const before=structuredClone(f.state);await assert.rejects(reconcileV3Allocations(f.args),/previously used legacy allocation/);assert.deepEqual(f.state,before);
});
test('missing source history and concurrent receipt preparation block reconciliation atomically',async()=>{
 const f=fixture();delete f.state.v3Settlements.source0;
 await assert.rejects(reconcileV3Allocations(f.args),/source history is incomplete/);
 const g=fixture();g.store.update=async fn=>{g.state.v3CreatorRewardFunding={source0:{status:'verification-pending'}};return fn(g.state);};
 await assert.rejects(reconcileV3Allocations(g.args),/evidence changed/);assert.equal(g.state.v3Settlements.source1.allocationPlan.allocationVersion,undefined);
});
