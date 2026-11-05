import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuybackController} from '../src/app/controllers/buyback.js';

const pending = {cluster:'devnet',refreshing:true,dashboard:{status:'unavailable',thresholdLamports:'5000000000'}};
const verified = {cluster:'devnet',refreshing:false,automationEnabled:true,
  dashboard:{status:'verified',collectedLamports:'147100',thresholdLamports:'5000000000',triggerReached:false}};
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, read) {
  t.mock.timers.enable({apis:['setTimeout']});
  const prior = globalThis.document, elements = new Map();
  for (const suffix of ['balance','status','track','fill','last-time','proof','title','policy'])
    elements.set('#buyback-route-'+suffix,{style:{},setAttribute(){},removeAttribute(){}});
  globalThis.document = {querySelector:key => elements.get(key) || null};
  t.after(() => {globalThis.document = prior;});
  let calls=0;
  const state = {apiRequest:async(...args) => {calls++;return {available:true,data:await read(...args)};},
    renderBuybackDashboard(){},formatOnchainAge:()=>'1m ago'};
  return {state,elements,calls:()=>calls,controller:createBuybackController(state)};
}

test('aged funding readiness follows the server decision and still requires current custody',async t=>{
  const data={...verified,executionPolicy:{maxWaitSeconds:86400,ageMinimumLamports:'10000000'},
    pending:[{ageEligible:true}],executionReady:false};
  const f=fixture(t,()=>data);
  await f.controller.loadBuybackNetworkState();
  assert.match(f.elements.get('#buyback-route-policy').textContent,/at least 0\.01 SOL.*at least 24 hours/);
  assert.equal(f.elements.get('#buyback-route-status').textContent,'Older funding qualifies · execution checks pending');
  data.executionReady=true;await f.controller.loadBuybackNetworkState();
  assert.equal(f.elements.get('#buyback-route-status').textContent,'Older funding qualifies · protected execution ready');
  data.dashboard={...data.dashboard,status:'unavailable'};await f.controller.loadBuybackNetworkState();
  assert.doesNotMatch(f.elements.get('#buyback-route-status').textContent,/execution ready/);
});

test('disabled or malformed age rules do not advertise aged execution even with stale eligibility',async t=>{
  const data={...verified,pending:[{ageEligible:true}],executionReady:true};
  const f=fixture(t,()=>data);
  for(const policy of [undefined,{maxWaitSeconds:0,ageMinimumLamports:'10000000'},
    {maxWaitSeconds:86400,ageMinimumLamports:'0'},{maxWaitSeconds:86400,ageMinimumLamports:'invalid'}]){
    data.executionPolicy=policy;await f.controller.loadBuybackNetworkState();
    assert.doesNotMatch(f.elements.get('#buyback-route-policy').textContent,/Older fee allocations/);
    assert.doesNotMatch(f.elements.get('#buyback-route-status').textContent,/execution ready/);
    assert.doesNotMatch(f.elements.get('#buyback-route-title').textContent,/older fees/);
  }
});

test('an API failure clears previously displayed age rules',async t=>{
  const f=fixture(t,()=>({...verified,executionPolicy:{maxWaitSeconds:300,ageMinimumLamports:'10000'}}));
  await f.controller.loadBuybackNetworkState();
  assert.match(f.elements.get('#buyback-route-policy').textContent,/5 minutes/);
  f.state.apiRequest=async()=>{throw new Error('Network unavailable');};
  await f.controller.loadBuybackNetworkState();
  assert.equal(f.elements.get('#buyback-route-policy').textContent,'Current buyback rules are unavailable.');
  assert.equal(f.elements.get('#buyback-route-title').textContent,'Buybacks from verified fees.');
});

test('a cold buyback panel follows the pending scan and displays only the fresh balance',async t=>{
  let ready=false;
  const f=fixture(t,()=>ready?verified:{...pending,lastVerified:{...verified.dashboard,checkedAt:'2026-11-05T00:00:00Z'}});
  const work=f.controller.loadBuybackNetworkState();await flush();
  assert.equal(f.elements.get('#buyback-route-balance').textContent,'—');
  assert.match(f.elements.get('#buyback-route-status').textContent,/Checking finalized vault balances/);
  assert.equal(f.state.buybackNetworkState.executionReady,false);
  ready=true;t.mock.timers.tick(2000);await work;
  assert.equal(f.calls(),2);
  assert.match(f.elements.get('#buyback-route-balance').textContent,/0\.0001471 SOL/);
  assert.match(f.elements.get('#buyback-route-status').textContent,/Verified eligible funds/);
});

test('verification failure stops follow-up reads and does not present historical custody as current',async t=>{
  const f=fixture(t,()=>({...pending,refreshing:false,lastVerified:{...verified.dashboard,checkedAt:'2026-11-05T00:00:00Z'}}));
  await f.controller.loadBuybackNetworkState();
  assert.equal(f.calls(),1);
  assert.equal(f.elements.get('#buyback-route-balance').textContent,'—');
  assert.match(f.elements.get('#buyback-route-status').textContent,/current verification unavailable/);
});

test('missing optional history does not claim there have been no burns or hide verified custody',async t=>{
  const f=fixture(t,()=>({...verified,dashboard:{...verified.dashboard,historyStatus:'unavailable'}}));
  await f.controller.loadBuybackNetworkState();
  assert.equal(f.elements.get('#buyback-route-last-time').textContent,'Burn history temporarily unavailable');
  assert.equal(f.elements.get('#buyback-route-balance').textContent,'0.0001471 SOL');
});

test('a continuously pending scan has a bounded follow-up budget',async t=>{
  const f=fixture(t,()=>pending), work=f.controller.loadBuybackNetworkState();await flush();
  for(let i=0;i<13;i++){t.mock.timers.tick(2000);await flush();}
  await work;assert.equal(f.calls(),14);
  t.mock.timers.tick(60_000);await flush();assert.equal(f.calls(),14);
});

test('follow-up covers a scan that finishes near the server deadline',async t=>{
  let ready=false;
  const f=fixture(t,()=>ready?verified:pending),work=f.controller.loadBuybackNetworkState();await flush();
  for(let i=0;i<11;i++){t.mock.timers.tick(2000);await flush();}
  ready=true;t.mock.timers.tick(2000);await work;
  assert.equal(f.state.buybackNetworkState.dashboard.status,'verified');
});

test('leaving the route cancels the follow-up timer',async t=>{
  const f=fixture(t,()=>pending), owner=new AbortController();
  const work=f.controller.loadBuybackNetworkState(owner.signal);await flush();
  owner.abort();await work;t.mock.timers.tick(2000);await flush();
  assert.equal(f.calls(),1);
});

test('a newer load prevents an older response from overwriting fresh custody',async t=>{
  let finish;
  const f=fixture(t,()=>new Promise(resolve=>{finish=resolve;}));
  const older=f.controller.loadBuybackNetworkState();await flush();
  f.state.apiRequest=async()=>({available:true,data:verified});
  await f.controller.loadBuybackNetworkState();
  finish(pending);await older;
  assert.equal(f.state.buybackNetworkState.dashboard.status,'verified');
});
