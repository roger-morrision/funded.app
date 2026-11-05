import test from 'node:test';import assert from 'node:assert/strict';
import {createRpcReadScheduler} from '../src/features/shared/rpc-read-scheduler.js';
const body=method=>JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('SDK read bursts share a bounded queue and interactive quotes take the next slot',async()=>{
 const starts=[],releases=[];let active=0,peak=0;
 const send=createRpcReadScheduler({maxActive:2,fetch:async url=>{starts.push(url);peak=Math.max(peak,++active);await new Promise(r=>releases.push(r));active--;return new Response('{}');}});
 const calls=['a','b','c','d'].map(id=>send('https://app.test/rpc?id='+id,{body:body('getAccountInfo')}));await tick();assert.equal(starts.length,2);
 calls.push(send('https://app.test/rpc?purpose=trade-preview',{body:body('getMultipleAccounts')}));releases.shift()();await tick();assert.match(starts[2],/trade-preview/);
 while(releases.length){releases.shift()();await tick();}await Promise.all(calls);assert.equal(peak,2);assert.equal(starts.length,5);
});
test('cancelled queued reads never reach the network and rejected reads release their slot',async()=>{
 let release,calls=0;const send=createRpcReadScheduler({maxActive:1,fetch:async()=>{calls++;if(calls===1)await new Promise(r=>release=r);else throw new Error('RPC down');return new Response('{}');}});
 const first=send('https://app.test',{body:body('getSlot')});await tick();const controller=new AbortController();
 const cancelled=send('https://app.test',{body:body('getSlot'),signal:controller.signal});controller.abort();await assert.rejects(cancelled,{name:'AbortError'});release();await first;
 await assert.rejects(send('https://app.test',{body:body('getSlot')}),/RPC down/);await assert.rejects(send('https://app.test',{body:body('getSlot')}),/RPC down/);assert.equal(calls,3);
});
test('transaction submission bypasses a busy read queue and is never retried',async()=>{
 let release;const calls=[];const send=createRpcReadScheduler({maxActive:1,maxQueued:1,fetch:async(_url,init)=>{const method=JSON.parse(init.body).method;calls.push(method);if(method==='sendTransaction')throw new Error('uncertain submission');await new Promise(r=>release=r);return new Response('{}');}});
 const read=send('https://app.test',{body:body('getSlot')});await tick();const controller=new AbortController();const queued=send('https://app.test',{body:body('getSlot'),signal:controller.signal});
 await assert.rejects(send('https://app.test',{body:body('getSlot')}),/queue is busy/);
 await assert.rejects(send('https://app.test',{body:body('sendTransaction')}),/uncertain submission/);assert.deepEqual(calls,['getSlot','sendTransaction']);controller.abort();await assert.rejects(queued);release();await read;
});

test('concurrent SDK consumers share one connection initialization',async()=>{
 const {createConnectionsController}=await import('../src/app/controllers/connections.js');
 let connections=0;const state={APP_CLUSTER:'devnet',APP_RPC_URL:'https://rpc.example.test'};
 const controller=createConnectionsController(state);Object.assign(state,controller);
 const original=state.connectionConfig;state.connectionConfig=(...args)=>{connections++;return original(...args);};
 const modules=await Promise.all(Array.from({length:12},()=>controller.getSolana()));
 assert.equal(connections,1);assert(modules.every(value=>value===modules[0]));assert(state.connection);
});
