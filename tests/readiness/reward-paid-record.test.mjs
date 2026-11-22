import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalPayoutFixture} from './reward-payout-fixture.mjs';
import {expiryExecutionStore} from './reward-expiry-execution-fixture.mjs';
import {createRewardScheduler} from '../../server/reward-scheduler.mjs';
import {recoverSavedRewardPayouts} from '../../server/reward-payout-recovery.mjs';

test('matching verified completed payment preserves custom metadata without any recovery write',async t=>{
  const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);
  await createRewardScheduler({store,chain:f.chain(),indexer:{},cluster:'devnet'}).execute(200010,[f.plan.id]);
  await store.transaction(s=>{s.schedules[f.plan.id].payments[f.leaf.recipient].note='retained';});
  const before=(await store.read()).schedules[f.plan.id].payments;
  const readonly={read:store.read,transaction:async()=>{throw Error('Completed recovery must not write');}};
  assert.equal(await recoverSavedRewardPayouts({store:readonly,chain:f.chain()}),0);
  assert.deepEqual((await store.read()).schedules[f.plan.id].payments,before);assert.equal(f.sends,1);
});

test('incomplete paid metadata is enriched once while original timestamp and mode survive',async t=>{
  const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);const result=await f.chain().submitLeaf(f.plan,f.leaf,{store});
  await store.transaction(s=>{s.schedules[f.plan.id].payments[f.leaf.recipient]={status:'paid',amount:f.leaf.amount,index:f.leaf.index,
    signature:result.signature,payment:result.payment,bitmap:false,paidAt:'2026-11-01T00:00:00.000Z',note:'keep'};});
  assert.equal(await recoverSavedRewardPayouts({store,chain:f.chain()}),1);
  const paid=(await store.read()).schedules[f.plan.id].payments[f.leaf.recipient];
  assert.equal(paid.payoutTransactionVerified,true);assert.equal(paid.bitmap,false);assert.equal(paid.paidAt,'2026-11-01T00:00:00.000Z');assert.equal(paid.note,'keep');
  assert.equal(await recoverSavedRewardPayouts({store,chain:f.chain()}),0);assert.deepEqual((await store.read()).schedules[f.plan.id].payments[f.leaf.recipient],paid);assert.equal(f.sends,1);
});

test('conflicting paid financial identity is retained for review without overwrite or new submission',async t=>{
  const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);await f.chain().submitLeaf(f.plan,f.leaf,{store});
  await store.transaction(s=>{s.schedules[f.plan.id].payments[f.leaf.recipient]={status:'paid',amount:'201',signature:'conflicting',note:'review'};});
  const before=(await store.read()).schedules[f.plan.id].payments[f.leaf.recipient];assert.equal(await recoverSavedRewardPayouts({store,chain:f.chain()}),0);
  const row=(await store.read()).schedules[f.plan.id];assert.deepEqual(row.payments[f.leaf.recipient],before);assert.match(row.payoutRecoveryError,/conflicts/);assert.equal(f.sends,1);
});

test('cached payout fee payer and amount facts remain bound to the authenticated signed attempt',async t=>{
  for(const [name,value] of [['feeLamports','5001'],['feePayer','wrong'],['amount','201']]){
    const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);await f.chain().submitLeaf(f.plan,f.leaf,{store});
    assert.equal((await f.chain().submitLeaf(f.plan,f.leaf,{store,recoveryOnly:true})).alreadyPaid,true);
    await store.transaction(s=>{s.schedules[f.plan.id].payoutAttempts[f.leaf.recipient].proof[name]=value;});
    f.connection.getTransaction=async()=>{throw Error('Cached validation must not fetch or re-sign');};
    await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store,recoveryOnly:true}),/completion lacks proof/);assert.equal(f.sends,1);assert.equal(f.latestCalls,1);
  }
});
