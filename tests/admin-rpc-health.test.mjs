import test from 'node:test';
import assert from 'node:assert/strict';
import {readAdminRpcHealth} from '../server/admin-rpc-health.mjs';
const env={FUNDED_RPC_GATEWAY_ENABLED:'true',FUNDED_RPC_GATEWAY_URL:'http://rpc-gateway:8899'};
const metrics={cluster:'devnet',upstreamVerified:true,requests:100,upstreamRequests:40,cacheHits:30,redisCacheHits:10,coalescedReads:10,accountBatchSavings:20,
 upstreamFailures:1,rateLimited:0,queueRejected:2,queueDepth:3,redis:{enabled:true,ready:true},secret:'never forward arbitrary provider fields'};
test('private gateway view separates Redis, memory and batching without exposing upstream configuration',async()=>{
 let called;const result=await readAdminRpcHealth({env,fetch:async(url,options)=>{called=String(url);assert.equal(options.cache,'no-store');return{ok:true,json:async()=>metrics};}});
 assert.equal(called,'http://rpc-gateway:8899/metrics');assert.equal(result.memoryCacheHits,20);assert.equal(result.avoidedProviderAttempts,60);
 assert.equal(result.counts.redisCacheHits,10);assert(!('secret'in result));assert.equal(result.counts.queueRejected,2);assert(result.scope.includes('not billed credits'));
});
test('disabled gateway does not make a provider request',async()=>{
 assert.equal((await readAdminRpcHealth({env:{},fetch:()=>assert.fail()})).enabled,false);
});
test('failed, wrong-cluster or inconsistent counters fail without fabricated zero balances',async()=>{
 for(const changed of [{...metrics,cluster:'mainnet-beta'},{...metrics,redisCacheHits:40},{...metrics,upstreamRequests:-1},{...metrics,requests:NaN}]){
  await assert.rejects(readAdminRpcHealth({env,fetch:async()=>({ok:true,json:async()=>changed})}),/invalid/);
 }
 await assert.rejects(readAdminRpcHealth({env,fetch:async()=>({ok:false})}),/unavailable/);
});
