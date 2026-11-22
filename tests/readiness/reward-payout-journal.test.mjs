import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';
import {createRewardScheduler} from '../../server/reward-scheduler.mjs';
import {historicalPayoutFixture,PAYOUT_ASSETS} from './reward-payout-fixture.mjs';
import {expiryExecutionStore} from './reward-expiry-execution-fixture.mjs';
import {recoverSavedRewardPayouts} from '../../server/reward-payout-recovery.mjs';

for(const asset of PAYOUT_ASSETS){
  test(asset.name+' signed payout is persisted before broadcast and exact finalized proof survives restart',async t=>{
    const f=historicalPayoutFixture(asset),{store,path}=await expiryExecutionStore(t,f);
    f.beforeSend=async wire=>{const a=(await createAutomaticRewardStore(path).read()).schedules[f.plan.id].payoutAttempts?.[f.leaf.recipient];
      assert(a,'Signed payout must already be durably stored');assert.equal(a.transactionBase64,Buffer.from(wire).toString('base64'));assert.equal(a.state,'prepared');};
    const result=await f.chain().submitLeaf(f.plan,f.leaf,{store});assert.equal(result.payoutTransactionVerified,true);assert.equal(result.amountReceived,'200');
    const second=await f.chain().submitLeaf(f.plan,f.leaf,{store:createAutomaticRewardStore(path)});assert.equal(second.alreadyPaid,true);assert.equal(second.signature,result.signature);
    assert.equal(f.sends,1);assert.equal(f.latestCalls,1);assert.equal(f.rows.get(String(f.reserve)).data.readBigUInt64LE(72),41n);
  });
  test(asset.name+' unknown unlanded attempt never refreshes blockhash or broadcasts after restart',async t=>{
    const f=historicalPayoutFixture(asset),{store,path}=await expiryExecutionStore(t,f);f.autoLand=false;
    await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}));
    const before=(await store.read()).schedules[f.plan.id].payoutAttempts?.[f.leaf.recipient];
    await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store:createAutomaticRewardStore(path)}));
    assert.equal(f.latestCalls,1);assert.equal(f.sends,1);assert.equal(before.state,'prepared');assert.deepEqual((await store.read()).schedules[f.plan.id].payoutAttempts[f.leaf.recipient],before);
  });
  test(asset.name+' landed attempt with missing archival transaction stays pending until exact proof returns',async t=>{
    const f=historicalPayoutFixture(asset),{store,path}=await expiryExecutionStore(t,f);f.proofAvailable=false;
    await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}),/exact finalized reconciliation/);
    assert.equal((await store.read()).schedules[f.plan.id].payoutAttempts[f.leaf.recipient].state,'prepared');
    f.proofAvailable=true;const result=await f.chain().submitLeaf(f.plan,f.leaf,{store:createAutomaticRewardStore(path)});
    assert.equal(result.payoutTransactionVerified,true);assert.equal(f.latestCalls,1);assert.equal(f.sends,1);
  });
}

test('disk write rejection prevents payout broadcast',async t=>{
  const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f),fault={read:store.read,transaction:async()=>{throw Error('disk write rejected');}};
  await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store:fault}),/disk write rejected/);assert.equal(f.sends,0);
});

test('saved payout recovery does not call fresh readiness or signing',async t=>{
  const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);f.proofAvailable=false;
  await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}));f.proofAvailable=true;
  const chain=f.chain();chain.readiness=async()=>({constrainedPayouts:false,reasons:['protocol-paused']});
  f.connection.getLatestBlockhash=async()=>{throw Error('No fresh blockhash permitted');};
  const result=await createRewardScheduler({store,chain,indexer:{},cluster:'devnet'}).execute(200010,[f.plan.id]);
  assert.equal(result.status,'unavailable');assert.equal(result.submitted,0);assert.equal(f.sends,1);
  const saved=(await store.read()).schedules[f.plan.id];assert.equal(saved.payoutAttempts[f.leaf.recipient].state,'verified');assert.equal(saved.payments[f.leaf.recipient].status,'paid');
});

test('recovery-only missing attempt cannot fall through to preparation',async t=>{
  const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);
  assert.equal((await f.chain().submitLeaf(f.plan,f.leaf,{store,recoveryOnly:true})).status,'no-saved-payout-attempt');assert.equal(f.latestCalls,0);assert.equal(f.sends,0);
});

test('selected recovery ignores other schedules and retains a disappeared original attempt',async t=>{
  const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);f.autoLand=false;await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}));
  const original=(await store.read()).schedules[f.plan.id].payoutAttempts[f.leaf.recipient];let calls=0;
  const chain=f.chain(),submit=chain.submitLeaf;chain.submitLeaf=async(...args)=>{calls++;await store.transaction(s=>{delete s.schedules[f.plan.id].payoutAttempts[f.leaf.recipient];});return submit(...args);};
  assert.equal(await recoverSavedRewardPayouts({store,chain,selected:new Set(['other'])}),0);assert.equal(calls,0);
  await recoverSavedRewardPayouts({store,chain,selected:new Set([f.plan.id])});assert.equal(calls,1);assert.deepEqual((await store.read()).schedules[f.plan.id].payoutAttempts[f.leaf.recipient],original);
  assert.equal(f.sends,1);assert.equal(f.latestCalls,1);
});

test('changed transaction, signature, receipt or custody deltas never close an attempt',async t=>{
  const changes=[f=>{f.payoutTransaction.transaction.signatures[0]='wrong';},f=>{f.payoutTransaction.meta.postBalances[f.payoutTransaction.transaction.message.accountKeys.findIndex(k=>k.equals(f.recipient))]--;},
    f=>{f.rows.get(String(f.payment(f.leaf))).data.writeBigUInt64LE(199n,92);},f=>{f.payoutTransaction.meta.err={InstructionError:[0,'failed']};},
    f=>{f.connection.getSignatureStatuses=async()=>({context:{},value:[{slot:f.slot,err:null,confirmationStatus:'finalized'}]});}];
  for(const change of changes){const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);f.proofAvailable=false;await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}));f.proofAvailable=true;change(f);
    await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}),/exact finalized reconciliation/);assert.equal(f.sends,1);assert.equal(f.latestCalls,1);}
});

test('corrupt or changed immutable payout journal refuses before fresh signing',async t=>{
  for(const corrupt of [null,{},false]){const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);await store.transaction(s=>{s.schedules[f.plan.id].payoutAttempts={[f.leaf.recipient]:corrupt};});
    await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}));assert.equal(f.sends,0);assert.equal(f.latestCalls,0);}
  const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);f.autoLand=false;await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}));
  await store.transaction(s=>{s.schedules[f.plan.id].manifest.root='00'.repeat(32);});await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}),/schedule changed/);assert.equal(f.sends,1);
});

test('corrupt root attempt container cannot be reinterpreted as fresh authorization',async t=>{
  for(const corrupt of [null,false,[]]){const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);
    await store.transaction(s=>{s.schedules[f.plan.id].payoutAttempts=corrupt;});
    await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}),/container/);assert.equal(f.sends,0);assert.equal(f.latestCalls,0);}
});

test('observed in-flight attempt owns the leaf across a second store instance',async t=>{
  const f=historicalPayoutFixture(),{store,path}=await expiryExecutionStore(t,f);let release,reached;
  const gate=new Promise(r=>{release=r;}),seen=new Promise(r=>{reached=r;});f.beforeSend=async()=>{reached();await gate;};
  const first=f.chain().submitLeaf(f.plan,f.leaf,{store});await seen;
  await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store:createAutomaticRewardStore(path)}),/reconciliation/);
  assert.equal(f.latestCalls,1);release();assert.equal((await first).payoutTransactionVerified,true);assert.equal(f.sends,1);
});

test('fee and actual Token2022 ATA rent remain above the single protected reserve',async t=>{
  for(const low of [false,true]){const f=historicalPayoutFixture(PAYOUT_ASSETS[2]),{store}=await expiryExecutionStore(t,f),sizes=[];
    f.balances.set(String(f.operator),3000007000-(low?1:0));f.connection.getMinimumBalanceForRentExemption=async bytes=>{sizes.push(bytes);return 1000;};
    if(low){await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}),/reserve/);assert.equal(f.sends,0);}
    else assert.equal((await f.chain().submitLeaf(f.plan,f.leaf,{store})).payoutTransactionVerified,true);
    assert.deepEqual(sizes,[100,170]);}
});

test('wrong network, stale status and failed finalized transaction leave the original attempt unresolved',async t=>{
  for(const change of [f=>{f.connection.getGenesisHash=async()=> 'wrong';},f=>{f.connection.getSignatureStatuses=async()=>({context:{slot:f.slot-1},value:[{slot:f.slot,err:null,confirmationStatus:'finalized'}]});},
    f=>{f.payoutTransaction.meta.err='failed';}]){
    const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);f.proofAvailable=false;await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}));f.proofAvailable=true;change(f);
    await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}),/reconciliation/);assert.equal(f.latestCalls,1);assert.equal(f.sends,1);assert.equal((await store.read()).schedules[f.plan.id].payoutAttempts[f.leaf.recipient].state,'prepared');}
});

test('throwing readiness still permits only saved read-only payout recovery and respects empty ID selection',async t=>{
  const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);f.proofAvailable=false;await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}));f.proofAvailable=true;
  const chain=f.chain();chain.readiness=async()=>{throw Error('fresh readiness unavailable');};
  const scheduler=createRewardScheduler({store,chain,indexer:{},cluster:'devnet'});
  await assert.rejects(scheduler.execute(200010,[]),/fresh readiness/);assert.equal((await store.read()).schedules[f.plan.id].payoutAttempts[f.leaf.recipient].state,'prepared');
  await assert.rejects(scheduler.execute(200010,[f.plan.id]),/fresh readiness/);assert.equal((await store.read()).schedules[f.plan.id].payoutAttempts[f.leaf.recipient].state,'verified');assert.equal(f.latestCalls,1);assert.equal(f.sends,1);
});

test('receipt-mode self-payout retains exact fee and receipt-rent accounting',async t=>{
  for(const asset of PAYOUT_ASSETS){const f=historicalPayoutFixture({...asset,self:true}),{store}=await expiryExecutionStore(t,f);
    const result=await f.chain().submitLeaf(f.plan,f.leaf,{store});assert.equal(result.payoutTransactionVerified,true);assert.equal(result.amountReceived,'200');assert.equal(f.sends,1);}
});

test('cached completion with corrupted verification facts cannot become a paid scheduler row',async t=>{
  const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f);await f.chain().submitLeaf(f.plan,f.leaf,{store});
  await store.transaction(s=>{s.schedules[f.plan.id].payoutAttempts[f.leaf.recipient].proof.balanceDeltaVerified=false;});
  await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store,recoveryOnly:true}),/completion lacks proof/);
  assert.equal(await recoverSavedRewardPayouts({store,chain:f.chain()}),0);assert.notEqual((await store.read()).schedules[f.plan.id].payments[f.leaf.recipient]?.status,'paid');assert.equal(f.sends,1);
});
