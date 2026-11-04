import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {requireNativeRewardRecipient,nativeRecipientFundingPending} from '../server/native-reward-recipient.mjs';
import {createRewardScheduler} from '../server/reward-scheduler.mjs';

test('empty recipients defer small SOL rewards and can resume after funding without a subsidy',async()=>{
 const connection={getMinimumBalanceForRentExemption:async(size,commitment)=>{assert.equal(size,0);assert.equal(commitment,'finalized');return 890880;}};
 let pending;try{await requireNativeRewardRecipient(connection,'recipient','23763',0);}catch(error){pending=error;}
 assert.equal(pending.code,'RECIPIENT_RENT_REQUIRED');assert.equal(pending.minimumFundingLamports,'890880');
 assert.equal(nativeRecipientFundingPending(pending).status,'awaiting-recipient-funding');
 await requireNativeRewardRecipient(connection,'recipient','23763',890880);
 await requireNativeRewardRecipient(connection,'recipient','890880',0);
 assert.equal(nativeRecipientFundingPending(Error('network unavailable')),null);
 await assert.rejects(requireNativeRewardRecipient(connection,'recipient','1',NaN),/verified recipient balance/);
});

test('scheduler retains the exact X entitlement while funding is missing and pays it once after funding',async()=>{
 const wallet=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58();
 const data={},store={read:async()=>structuredClone(data),transaction:async fn=>fn(data)};
 let funded=false,payments=0;
 const chain={readiness:async()=>({constrainedPayouts:true}),ensureCycle:async()=>({address:'cycle'}),
  submitLeaf:async(_plan,leaf)=>{if(!funded)await requireNativeRewardRecipient({getMinimumBalanceForRentExemption:async()=>890880},leaf.recipient,leaf.amount,0);
   payments++;return{signature:'verified-payment',payment:'receipt',amountReceived:leaf.amount,finalized:true,balanceDeltaVerified:true};}};
 const scheduler=createRewardScheduler({store,chain,indexer:{}});
 const plan=await scheduler.recordDirectFunded({kind:'x',id:'fixed-claim',mint,recipient:wallet,asset:'SOL',amount:'23763',fundingSignature:'funded-source',balanceDeltaVerified:true,fundedAt:1});
 const manifest=structuredClone(plan.manifest);await scheduler.execute(2,[plan.id]);
 assert.equal(data.schedules[plan.id].payments[wallet].status,'awaiting-recipient-funding');assert.equal(payments,0);
 assert.deepEqual(data.schedules[plan.id].manifest,manifest);
 funded=true;await scheduler.execute(3,[plan.id]);await scheduler.execute(4,[plan.id]);
 assert.equal(data.schedules[plan.id].status,'paid');assert.equal(payments,1);assert.deepEqual(data.schedules[plan.id].manifest,manifest);
});
