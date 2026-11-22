import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalPayoutFixture,PAYOUT_ASSETS} from './reward-payout-fixture.mjs';
import {expiryExecutionStore} from './reward-expiry-execution-fixture.mjs';
for(const asset of PAYOUT_ASSETS)for(const self of [false,true])for(const changedFee of [false,true]){
 test(asset.name+' self='+self+' feeChanged='+changedFee+' requires exact native accounting',async t=>{
  const f=historicalPayoutFixture({...asset,self}),{store}=await expiryExecutionStore(t,f);f.proofAvailable=false;
  await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}),/exact finalized reconciliation/);
  if(changedFee)f.payoutTransaction.meta.fee++;
  const m=f.payoutTransaction.meta,nativeDifference=m.preBalances.reduce((n,b,i)=>n+BigInt(b)-BigInt(m.postBalances[i]),0n);
  f.proofAvailable=true;let result,error;
  try{result=await f.chain().submitLeaf(f.plan,f.leaf,{store});}catch(e){error=e.message;}
  const state=(await store.read()).schedules[f.plan.id].payoutAttempts[f.leaf.recipient].state;
  console.log(JSON.stringify({asset:asset.name,self,changedFee,reportedFee:m.fee,nativeDifference:String(nativeDifference),accepted:result?.payoutTransactionVerified===true,stored:state,error,blockhashes:f.latestCalls,broadcasts:f.sends}));
  if(changedFee){assert.equal(result?.payoutTransactionVerified===true,false,'Inconsistent fee must not verify');assert.equal(state,'prepared');}
  else{assert.equal(result?.payoutTransactionVerified,true);assert.equal(state,'verified');}
  assert.equal(f.latestCalls,1);assert.equal(f.sends,1);
 });
}
