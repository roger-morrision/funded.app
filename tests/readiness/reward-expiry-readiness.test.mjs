import test from 'node:test';
import assert from 'node:assert/strict';
import {createRewardScheduler} from '../../server/reward-scheduler.mjs';
import {expiryExecutionFixture,expiryExecutionStore} from './reward-expiry-execution-fixture.mjs';

async function setup(t,{saved=true,landed=true,proof=true}={}){
  const f=expiryExecutionFixture(),{store}=await expiryExecutionStore(t,f);
  f.autoLand=landed;f.proofAvailable=false;
  if(saved)await f.chain().expireCycle(f.plan,{store});
  f.proofAvailable=proof;
  await store.transaction(state=>Object.assign(state.schedules[f.plan.id],{status:'blocked',reason:'protocol-owned vault or PumpSwap liquidity pool'}));
  const chain=f.chain(),expire=chain.expireCycle,calls=[];
  chain.expireCycle=async(plan,options)=>{calls.push({id:plan.id,recoveryOnly:options?.recoveryOnly});return expire(plan,options);};
  chain.readiness=async()=>({constrainedPayouts:false,reasons:['protocol-paused']});
  for(const method of ['ensureCycle','ensureVault','submitLeaf','submitLeaves','cleanupReceipts'])chain[method]=()=>assert.fail('No fresh work while unavailable: '+method);
  const scheduler=createRewardScheduler({store,chain,indexer:{capture:()=>assert.fail('No indexer capture in recovery execute')},cluster:'devnet'});
  const baseline={blockhashes:f.latestCalls,broadcasts:f.submitted};
  const unchanged=()=>{assert.equal(f.latestCalls,baseline.blockhashes);assert.equal(f.submitted,baseline.broadcasts);};
  return {f,store,chain,expire,calls,scheduler,unchanged};
}

test('unavailable execute reconciles only saved attempts and still reports zero submissions',async t=>{
  const {f,store,calls,scheduler,unchanged}=await setup(t);
  const result=await scheduler.execute(f.time),row=(await store.read()).schedules[f.plan.id];
  assert.equal(result.status,'unavailable');assert.equal(result.submitted,0);assert.deepEqual(result.reasons,['protocol-paused']);
  assert.equal(row.expiryAttempt.state,'verified');assert.equal(row.status,'expired');
  assert.deepEqual(calls,[{id:f.plan.id,recoveryOnly:true}]);unchanged();
  assert.equal((await store.read()).serviceStatus.constrainedPayouts,false);
});

test('saved reconciliation precedes a throwing fresh readiness check without signing',async t=>{
  const {f,store,chain,scheduler,unchanged}=await setup(t);
  chain.readiness=async()=>{throw Error('fresh readiness RPC unavailable');};
  await assert.rejects(scheduler.execute(f.time),/fresh readiness RPC unavailable/);
  assert.equal((await store.read()).schedules[f.plan.id].expiryAttempt.state,'verified');unchanged();
});

test('selected schedule IDs isolate recovery and leave unselected saved attempts untouched',async t=>{
  const {f,store,calls,scheduler,unchanged}=await setup(t);
  const other={...structuredClone(f.plan),id:'not-selected',status:'prepared',expiryAttempt:{version:1,state:'prepared'}};
  await store.transaction(state=>{state.schedules[other.id]=structuredClone(other);});
  const result=await scheduler.execute(f.time,[f.plan.id]);assert.equal(result.submitted,0);
  assert.equal((await store.read()).schedules[f.plan.id].expiryAttempt.state,'verified');
  assert.deepEqual((await store.read()).schedules[other.id],other);assert.deepEqual(calls.map(row=>row.id),[f.plan.id]);unchanged();
  await scheduler.execute(f.time,[]);assert.equal(calls.length,1);assert.deepEqual((await store.read()).schedules[other.id],other);unchanged();
});

test('missing transaction proof stays pending and readiness cannot authorize another attempt',async t=>{
  const {f,store,scheduler,unchanged}=await setup(t,{proof:false});
  const saved=structuredClone((await store.read()).schedules[f.plan.id].expiryAttempt);
  const result=await scheduler.execute(f.time);assert.equal(result.status,'unavailable');assert.equal(result.submitted,0);
  assert.deepEqual((await store.read()).schedules[f.plan.id].expiryAttempt,saved);
  assert.equal((await store.read()).schedules[f.plan.id].status,'blocked');unchanged();
});

test('rows without saved attempts are excluded even when fresh expiry would otherwise be due',async t=>{
  const {f,store,calls,scheduler,unchanged}=await setup(t,{saved:false});
  const result=await scheduler.execute(f.time,[f.plan.id]);assert.equal(result.submitted,0);assert.equal(calls.length,0);
  assert.equal((await store.read()).schedules[f.plan.id].expiryAttempt,undefined);unchanged();
});

test('a concurrently missing attempt cannot fall through to readiness, signing or broadcast',async t=>{
  const {f,store,chain,expire,scheduler,unchanged}=await setup(t,{landed:false});
  const original=structuredClone((await store.read()).schedules[f.plan.id].expiryAttempt);
  let genesisReads=0;f.connection.getGenesisHash=async()=>{genesisReads++;throw Error('No fresh RPC permitted');};
  chain.expireCycle=async(plan,options)=>{
    assert.equal(options.recoveryOnly,true);
    await store.transaction(state=>{delete state.schedules[plan.id].expiryAttempt;});
    return expire(plan,options);
  };
  const result=await scheduler.execute(f.time);assert.equal(result.submitted,0);assert.equal(genesisReads,0);
  assert.deepEqual((await store.read()).schedules[f.plan.id].expiryAttempt,original);unchanged();
});

test('restored original attempt also blocks replacement after fresh readiness becomes healthy',async t=>{
  const {f,store,chain,expire,scheduler,unchanged}=await setup(t,{landed:false});
  const original=structuredClone((await store.read()).schedules[f.plan.id].expiryAttempt);
  let calls=0;
  chain.expireCycle=async(plan,options)=>{
    calls++;if(calls===1)await store.transaction(state=>{delete state.schedules[plan.id].expiryAttempt;});
    return expire(plan,options);
  };
  chain.readiness=async()=>({constrainedPayouts:true,reasons:[]});
  await scheduler.execute(f.time);assert.equal(calls,1);
  await scheduler.execute(f.time);assert.equal(calls,2);
  assert.deepEqual((await store.read()).schedules[f.plan.id].expiryAttempt,original);unchanged();
});

test('lower chain recovery-only mode rejects absent attempts before fresh readiness',async t=>{
  const {f,store,expire,unchanged}=await setup(t,{saved:false});
  f.connection.getGenesisHash=async()=>assert.fail('Recovery-only absence must not call fresh readiness');
  const result=await expire(f.plan,{store,recoveryOnly:true});assert.equal(result.expired,false);assert.equal(result.status,'no-saved-expiry-attempt');unchanged();
});

test('falsy saved-attempt corruption cannot be treated as a fresh signing authorization',async t=>{
  for(const marker of [null,false,0]){
    const {f,store,expire,unchanged}=await setup(t,{saved:false});
    await store.transaction(state=>{state.schedules[f.plan.id].expiryAttempt=marker;});
    f.connection.getGenesisHash=async()=>assert.fail('Corrupt saved state cannot reach fresh readiness');
    await assert.rejects(expire(f.plan,{store}),/Invalid saved expiry attempt/);unchanged();
  }
});

test('a concurrently removed schedule is not recreated and cannot trigger a fresh attempt',async t=>{
  const {f,store,chain,expire,scheduler,unchanged}=await setup(t,{landed:false});
  chain.expireCycle=async(plan,options)=>{
    await store.transaction(state=>{delete state.schedules[plan.id];});
    return expire(plan,options);
  };
  const result=await scheduler.execute(f.time);assert.equal(result.status,'unavailable');assert.equal(result.submitted,0);
  assert.equal((await store.read()).schedules[f.plan.id],undefined);unchanged();
});

test('replaced immutable schedule cannot inherit an older verified expiry completion',async t=>{
  const {f,store,chain,expire,scheduler,unchanged}=await setup(t);
  chain.expireCycle=async(plan,options)=>{
    const result=await expire(plan,options);
    await store.transaction(state=>{state.schedules[plan.id].manifest.root='00'.repeat(32);});
    return result;
  };
  const result=await scheduler.execute(f.time);assert.equal(result.status,'unavailable');assert.equal(result.submitted,0);
  const row=(await store.read()).schedules[f.plan.id];assert.equal(row.status,'blocked');assert.equal(row.expiryError,undefined);unchanged();
});

test('saved recovery ignores current classification, local grace and missing fresh grace configuration',async t=>{
  const {f,store,chain,calls,scheduler,unchanged}=await setup(t);
  await store.transaction(state=>Object.assign(state.schedules[f.plan.id],{status:'prepared',reason:null}));
  delete chain.cycleExpiryGraceSeconds;
  const result=await scheduler.execute(1);assert.equal(result.status,'unavailable');assert.equal(result.submitted,0);
  assert.equal((await store.read()).schedules[f.plan.id].expiryAttempt.state,'verified');assert.equal(calls.length,1);unchanged();
});

test('healthy execute does not repeat saved recovery in the fresh expiry pass',async t=>{
  const {f,calls,chain,scheduler,unchanged}=await setup(t,{landed:false});
  chain.readiness=async()=>({constrainedPayouts:true,reasons:[]});
  const result=await scheduler.execute(f.time);assert.equal(result.submitted,0);
  assert.deepEqual(calls,[{id:f.plan.id,recoveryOnly:true}]);unchanged();
});

test('healthy execute retains the normal authorized fresh expiry pass',async t=>{
  const {f,store,calls,chain,scheduler}=await setup(t,{saved:false});
  chain.readiness=async()=>({constrainedPayouts:true,reasons:[]});
  await scheduler.execute(f.time);
  const row=(await store.read()).schedules[f.plan.id];assert.equal(row.status,'expired');assert.equal(row.expiryAttempt.state,'verified');
  assert.deepEqual(calls,[{id:f.plan.id,recoveryOnly:false}]);assert.equal(f.latestCalls,1);assert.equal(f.submitted,1);
});
