import test from 'node:test';
import assert from 'node:assert/strict';
import {createAcceptanceRpcFetch} from '../scripts/devnet-acceptance-rpc.mjs';
const request=method=>({body:JSON.stringify({jsonrpc:'2.0',id:1,method})});
test('transient read limits recover with bounded waits; writes and unknown methods never replay',async()=>{
 let calls=0;const waits=[];
 const fetch=createAcceptanceRpcFetch({sleep:async ms=>waits.push(ms),fetchImpl:async()=>++calls<3?new Response('',{status:429}):new Response('{}')});
 assert.equal((await fetch('https://devnet.example',request('getAccountInfo'))).status,200);
 assert.equal(calls,3);assert.deepEqual(waits,[1000,2000]);
 for(const method of ['sendTransaction','simulateTransaction','requestAirdrop','newRpcMethod']){
  calls=0;const noRetry=createAcceptanceRpcFetch({sleep:()=>assert.fail('Write retry'),fetchImpl:async()=>{calls++;return new Response('',{status:429});}});
  assert.equal((await noRetry('https://devnet.example',request(method))).status,429);assert.equal(calls,1);
 }
});
test('JSON RPC throttling is bounded and excessive Retry-After stops immediately',async()=>{
 let calls=0,waits=0;
 const fetch=createAcceptanceRpcFetch({sleep:async()=>waits++,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:{code:429}}));}});
 await fetch('https://devnet.example',request('getBalance'));assert.equal(calls,4);assert.equal(waits,3);
 const long=createAcceptanceRpcFetch({sleep:()=>assert.fail('Long retry'),fetchImpl:async()=>new Response('',{status:503,headers:{'retry-after':'60'}})});
 assert.equal((await long('https://devnet.example',request('getBalance'))).status,503);
});
test('abort cancels read recovery without another network attempt',async()=>{
 const controller=new AbortController();let calls=0;
 const fetch=createAcceptanceRpcFetch({sleep:async()=>controller.abort(),fetchImpl:async()=>{calls++;return new Response('',{status:429});}});
 await assert.rejects(fetch('https://devnet.example',{...request('getBalance'),signal:controller.signal}));assert.equal(calls,1);
});
