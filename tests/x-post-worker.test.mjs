import test from 'node:test';
import assert from 'node:assert/strict';
import { runXPostWorker } from '../server/x-post-worker.mjs';
import { normalizeXPostEvent } from '../server/x-post-store.mjs';
const event = {id:'launch:fixture',kind:'launch',cluster:'devnet',occurredAt:'2026-10-04T00:00:00Z',text:'Devnet launch'};
function fixture() {
  const calls = [];
  let state = 'pending';
  const store = {
    leaseMs:60000,
    list:async () => { calls.push('list'); return [{event}]; },
    claim:async () => { calls.push('claim'); if(state !== 'pending') return null; state='sending'; return {event,token:'token'}; },
    markPosted:async (id,token,result) => { assert.equal(state,'sending'); assert.equal(id,event.id); assert.equal(token,'token'); assert.equal(result.id,'123'); calls.push('posted'); state='posted'; },
    markUncertain:async () => { calls.push('uncertain'); state='uncertain'; },
    retryLater:async (id,token,delay) => { calls.push(['retry',delay]); state='pending'; return {status:'pending'}; },
    deferAccount:async (id,token,status)=>{calls.push(['account-hold',status]);state='pending';},
    fail:async () => { calls.push('failed'); state='failed'; },
  };
  return {store,calls,get state(){return state;}};
}
test('disabled and dry-run workers never acquire a dispatch claim or call X', async () => {
  const {store,calls}=fixture(); const publish=()=>assert.fail('must not publish');
  assert.equal((await runXPostWorker({store,publish})).mode,'disabled'); assert.deepEqual(calls,[]);
  const result=await runXPostWorker({store,publish,enabled:true,dryRun:true});
  assert.equal(result.mode,'dry-run');assert.deepEqual(result.events,[event]);assert.deepEqual(calls,['list']);
});

test('separate payout and agency workers select their kinds before acquiring a shared-budget dispatch claim',async()=>{
  const selections=[],published=[],store={leaseMs:60000,claim:async options=>{selections.push(options);return null;}};
  for(const kinds of [['auto_payout'],['agency_promotion']])await runXPostWorker({store,enabled:true,dryRun:false,kinds,publish:async event=>published.push(event)});
  assert.deepEqual(selections,[{kinds:['auto_payout']},{kinds:['agency_promotion']}]);assert.deepEqual(published,[]);
  await assert.rejects(runXPostWorker({store,enabled:true,dryRun:false,kinds:[],publish:async()=>{}}),/kinds/);
});
test('worker persists sending before network and saves the successful publication without replay',async()=>{
  const f=fixture();let published=0;
  const result=await runXPostWorker({store:f.store,enabled:true,dryRun:false,maxPosts:2,publish:async()=>{assert.equal(f.state,'sending');published++;return{id:'123',url:'https://x.com/i/web/status/123'};}});
  assert.equal(published,1);assert.equal(result.posted,1);assert.deepEqual(f.calls,['claim','posted','claim']);
});
test('ambiguous network errors and 5xx never automatically retry',async()=>{
  for(const error of [new Error('network failed'),Object.assign(new Error('upstream'),{status:503,delivery:'unknown'}),Object.assign(new Error('ambiguous authentication response'),{status:401,delivery:'unknown'})]){
    const f=fixture();let published=0;
    const result=await runXPostWorker({store:f.store,enabled:true,dryRun:false,maxPosts:2,publish:async()=>{published++;throw error;}});
    assert.equal(result.uncertain,1);assert.equal(published,1);assert.equal(f.state,'uncertain');
  }
});
test('timeout aborts publication and leaves uncertain state even if publisher resolves later',async()=>{
  const f=fixture();let signal;
  const result=await runXPostWorker({store:f.store,enabled:true,dryRun:false,timeoutMs:100,publish:async(_,{signal:s})=>{signal=s;return new Promise(()=>{});}});
  assert.equal(result.uncertain,1);assert.equal(signal.aborted,true);assert.equal(f.state,'uncertain');
});
test('undelivered 429 is bounded, account access failures are held, and other rejections fail',async()=>{
  const f=fixture();
  const result=await runXPostWorker({store:f.store,enabled:true,dryRun:false,publish:async()=>{throw Object.assign(new Error('limit'),{delivery:'not-sent',status:429,retryAfterMs:120000});}});
  assert.equal(result.retried,1);assert.deepEqual(f.calls,['claim',['retry',120000]]);
  const g=fixture();
  assert.equal((await runXPostWorker({store:g.store,enabled:true,dryRun:false,publish:async()=>{throw Object.assign(new Error('forbidden'),{delivery:'not-sent',status:403});}})).retried,1);
  assert.equal(g.state,'pending');assert.deepEqual(g.calls,['claim',['account-hold',403]]);
  const h=fixture();
  assert.equal((await runXPostWorker({store:h.store,enabled:true,dryRun:false,publish:async()=>{throw Object.assign(new Error('local validation'),{delivery:'rejected'});}})).failed,1);
});
test('authentication, credit and permission rejections hold pending work and stop the batch',async()=>{
  for(const status of [401,402,403]){
    const f=fixture();let sends=0;const result=await runXPostWorker({store:f.store,enabled:true,dryRun:false,maxPosts:20,publish:async()=>{sends++;throw Object.assign(new Error('rejected'),{status,delivery:'rejected'});}});
    assert.equal(sends,1);assert.equal(result.failed,0);assert.equal(result.retried,1);assert.equal(f.state,'pending');assert.equal(f.calls.filter(call=>call==='claim').length,1);
  }
});
test('an ambiguous first send stops even when another pending event is claimable',async()=>{
  let claims=0,sends=0;const store={leaseMs:60000,claim:async()=>{claims++;return{event,token:'t'};},markUncertain:async()=>{}};
  const result=await runXPostWorker({store,enabled:true,dryRun:false,maxPosts:20,publish:async()=>{sends++;throw new Error('unknown');}});
  assert.equal(result.uncertain,1);assert.equal(claims,1);assert.equal(sends,1);
});
test('successful publication with persistence failure never republishes',async()=>{
  const f=fixture();let sends=0;f.store.markPosted=async()=>{throw new Error('database connection lost');};
  const result=await runXPostWorker({store:f.store,enabled:true,dryRun:false,maxPosts:2,publish:async()=>{sends++;return{id:'123'};}});
  assert.equal(sends,1);assert.equal(result.uncertain,1);assert.equal(f.state,'uncertain');
});
test('worker rejects unsafe dispatch bounds before claiming',async()=>{
  const f=fixture();
  await assert.rejects(runXPostWorker({store:f.store,maxPosts:100}),/batch/);
  await assert.rejects(runXPostWorker({store:{...f.store,leaseMs:1000},publish:async()=>{},enabled:true,dryRun:false}),/lease/);
  assert.deepEqual(f.calls,[]);
});
test('outbox events use deterministic canonical payloads and bounded validated fields',()=>{
  assert.deepEqual(normalizeXPostEvent({...event,proofs:{z:1,a:2}}),{...event,occurredAt:'2026-10-04T00:00:00.000Z',proofs:{a:2,z:1}});
  for(const patch of [{id:''},{kind:'bad kind'},{cluster:'mainnet'},{text:'x'.repeat(281)},{text:'🚀'.repeat(71)},{text:'\0unsafe'},{occurredAt:'invalid'},{proofs:{text:'x'.repeat(17000)}}])assert.throws(()=>normalizeXPostEvent({...event,...patch}));
});
