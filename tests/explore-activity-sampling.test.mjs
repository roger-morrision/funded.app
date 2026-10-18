import test from 'node:test';
import assert from 'node:assert/strict';
import { createExploreActivitySampler, ACTIVITY_MAX_AGE_MS } from '../src/features/explore/activity-sampling.js';
import { withMarketWindow, filterMarketRecords } from '../market-intelligence.js';
import { createExploreActionsController } from '../src/app/controllers/explore-actions.js';
const data = (value=1) => ({observedCoverage:'complete',coverage:'complete',volume24hSol:value,tradeCount24h:1,buyCount24h:1,sellCount24h:0,
  activityWindows:Object.fromEntries(['1h','6h','24h'].map(period=>[period,{volumeSol:value,tradeCount:1,buyCount:1,sellCount:0,traderCount:1,coverage:'complete'}]))});
test('nine tokens reach coverage across minute windows and an older active token joins ranking and filters',async()=>{
 let time=600_000;const cache=new Map(),items=Array.from({length:9},(_,i)=>({address:String(i),complete:false}));
 const refresh=createExploreActivitySampler({cache,now:()=>time});const calls=[];
 const request=async item=>{calls.push(item.address);return data(item.address==='8'?100:1);};
 assert.equal(await refresh(items,request),5);assert.equal(calls.length,5);
 assert.equal(await refresh(items,request),5);assert.equal(calls.length,5,'Sort/manual refresh shares the existing minute budget');
 time+=60_000;assert.equal(await refresh(items,request),9);assert.equal(calls.length,9);
 const ranked=filterMarketRecords(items.map(item=>withMarketWindow(item,'24h')),{sort:'volume',minVolumeSol:50});
 assert.deepEqual(ranked.map(row=>row.address),['8']);
});
test('failed scans cannot starve untouched tokens and recent cached snapshots survive re-created rows',async()=>{
 let time=600_000;const cache=new Map(),items=Array.from({length:9},(_,i)=>({address:String(i)}));
 const refresh=createExploreActivitySampler({cache,now:()=>time});
 await refresh(items,async()=>null);time+=60_000;
 const seen=[];assert.equal(await refresh(items,async item=>{seen.push(item.address);return data();}),5);
 assert.deepEqual(seen.slice(0,4),['5','6','7','8']);
 const rebuilt=items.map(({address})=>({address}));
 assert.equal(await refresh(rebuilt,async()=>{throw new Error('No request budget remains.');}),5);
 assert.equal(rebuilt[8].volume24hSol,1);assert.equal(rebuilt[4].volume24hSol,null);
});
test('expired snapshots are cleared, concurrency stays bounded, and an aborted refresh makes no requests',async()=>{
 let time=600_000,active=0,max=0;const cache=new Map(),items=Array.from({length:12},(_,i)=>({address:String(i)}));
 const refresh=createExploreActivitySampler({cache,now:()=>time});
 await refresh(items,async()=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,1));active--;time++;return data();});
 assert(max<=4);assert.equal(items[0].volume24hSol,1,'Responses written after refresh began are applied');
 time+=ACTIVITY_MAX_AGE_MS;await refresh(items,async()=>null);
 assert.equal(items[0].volume24hSol,null);assert.equal(items[0].activityWindows,null);
 const controller=new AbortController();controller.abort();time+=60_000;
 await assert.rejects(refresh(items,async()=>{throw new Error('Must not request');},controller.signal),{name:'AbortError'});
});
test('cancelled navigation is quiet while a genuine feed failure remains visible',async()=>{
 const messages=[];let error=new DOMException('Navigation changed','AbortError');
 const actions=createExploreActionsController({exploreSort:'newest',exploreFeedSort:'last_trade_timestamp',
  loadOnchainExploreData:async()=>{throw error;},showToast:message=>messages.push(message)});
 actions.refreshExploreFeedForSort();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(messages,[]);
 error=new Error('Provider unavailable');actions.refreshExploreFeedForSort();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(messages,['Launch feed could not refresh.']);
});
test('freshness follows the server snapshot time rather than extending an old snapshot on fetch',async()=>{
 let time=600_000;const item={address:'older'},cache=new Map();
 const refresh=createExploreActivitySampler({cache,now:()=>time});
 await refresh([item],async()=>({...data(),observedAt:new Date(time-60_000).toISOString()}));
 assert.equal(cache.get('older').at,540_000);
 time+=ACTIVITY_MAX_AGE_MS-60_000;
 assert.equal(await refresh([item],async()=>null),0);assert.equal(item.volume24hSol,null);
});
