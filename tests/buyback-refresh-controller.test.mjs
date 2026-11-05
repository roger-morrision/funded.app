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
  for (const suffix of ['balance','status','track','fill','last-time','proof','title'])
    elements.set('#buyback-route-'+suffix,{style:{},setAttribute(){},removeAttribute(){}});
  globalThis.document = {querySelector:key => elements.get(key) || null};
  t.after(() => {globalThis.document = prior;});
  let calls=0;
  const state = {apiRequest:async(...args) => {calls++;return {available:true,data:await read(...args)};},
    renderBuybackDashboard(){},formatOnchainAge:()=>'1m ago'};
  return {state,elements,calls:()=>calls,controller:createBuybackController(state)};
}

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
