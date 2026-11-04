import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcSavingsBetween} from '../server/rpc-savings.mjs';
const zero={requests:0,upstreamRequests:0,cacheHits:0,redisCacheHits:0,coalescedReads:0,accountBatchSavings:0,
 upstreamFailures:0,rateLimited:0,queueRejected:0};
const snapshot=metrics=>({instance:'gateway-start-1',metrics:{...zero,...metrics}});
test('savings split Redis from memory and exclude rejected requests',()=>{
 const r=rpcSavingsBetween(snapshot({}),snapshot({requests:120,upstreamRequests:40,cacheHits:30,redisCacheHits:10,
  coalescedReads:20,accountBatchSavings:25,queueRejected:5}));
 assert.deepEqual(r.avoided,{memoryCache:20,redisCache:10,coalescing:20,accountBatching:25});
 assert.equal(r.totalAvoidedProviderAttempts,75);assert.equal(r.incrementalRedisSavings,10);
 assert.equal(r.equivalentUnoptimizedAttempts,115);assert.equal(r.avoidedAttemptPercent,100*75/115);
 assert.equal(r.errors.localQueueRejections,5);assert.equal(r.billingCreditsMeasured,false);
});
test('zero-traffic windows and cumulative baselines produce valid deltas',()=>{
 const before=snapshot({requests:100,cacheHits:30,redisCacheHits:4});
 assert.equal(rpcSavingsBetween(before,before).avoidedAttemptPercent,0);
 const after=snapshot({requests:110,cacheHits:36,redisCacheHits:5,upstreamRequests:4});
 assert.equal(rpcSavingsBetween(before,after).totalAvoidedProviderAttempts,6);
});
test('restarts, reset counters, malformed counters and overlapping cache totals reject',()=>{
 assert.throws(()=>rpcSavingsBetween(snapshot({}),{...snapshot({}),instance:'gateway-start-2'}),/same gateway/);
 assert.throws(()=>rpcSavingsBetween(snapshot({cacheHits:2}),snapshot({cacheHits:1})),/reset/);
 assert.throws(()=>rpcSavingsBetween(snapshot({}),snapshot({cacheHits:0.5})),/counter/);
 assert.throws(()=>rpcSavingsBetween(snapshot({}),snapshot({redisCacheHits:1})),/subset/);
});
