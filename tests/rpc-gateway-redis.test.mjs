import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpcGateway,RPC_GATEWAY_DEVNET_GENESIS} from '../server/rpc-gateway.mjs';

const rpc=(id,method='getTransaction',params=['tx',{commitment:'finalized'}])=>({jsonrpc:'2.0',id,method,params});
function fixture(){
  let time=1000,reads=0,writes=0,result={slot:42,meta:{err:null}};
  const values=new Map(),calls=[];
  const sharedCache={get:async key=>{reads++;return values.get(key);},
    set:async(key,response,ttl)=>{writes++;values.set(key,{response,expiresAt:time+ttl});},close:()=>{}};
  const gateway=()=>createRpcGateway({sharedCache,minIntervalMs:0,blockIntervalMs:0,now:()=>time,wait:async()=>{},
    transport:async request=>{calls.push(request);return{status:200,body:{jsonrpc:'2.0',id:request.id,
      ...(result?.error&&request.method!=='getGenesisHash'?{error:result.error}:
        {result:request.method==='getGenesisHash'?RPC_GATEWAY_DEVNET_GENESIS:result})}};}});
  return{gateway,values,calls,sharedCache,advance:ms=>{time+=ms;},setResult:v=>{result=v;},counts:()=>({reads,writes})};
}

test('finalized history survives gateway replacement and duplicate misses still coalesce',async()=>{
  const f=fixture(),first=f.gateway();await first.initialize();
  const replies=await Promise.all(Array.from({length:20},(_,id)=>first.request(rpc(id))));
  assert.equal(f.calls.filter(r=>r.method==='getTransaction').length,1);assert.equal(f.counts().writes,1);
  replies.forEach((row,id)=>assert.equal(row.body.id,id));first.close();
  const second=f.gateway();assert.equal((await second.request(rpc(99))).httpStatus,503);
  await second.initialize();const cached=await second.request(rpc(100));
  assert.equal(cached.body.id,100);assert.equal(cached.body.result.slot,42);assert.equal(second.stats().redisCacheHits,1);
  assert.equal(f.calls.filter(r=>r.method==='getGenesisHash').length,2);
  assert.equal(f.calls.filter(r=>r.method==='getTransaction').length,1);
});

test('Redis reuse keeps the original expiry even after an L1 refresh',async()=>{
  const f=fixture(),a=f.gateway();await a.initialize();await a.request(rpc(1));
  f.advance(86400000-1000);const b=f.gateway();await b.initialize();await b.request(rpc(2));
  assert.equal(b.stats().redisCacheHits,1);f.advance(1001);await b.request(rpc(3));
  assert.equal(f.calls.filter(r=>r.method==='getTransaction').length,2);
});

test('all RPC options affect Redis keys; confirmed history, nulls, errors and financial state bypass storage',async()=>{
  const f=fixture(),a=f.gateway();await a.initialize();
  for(const method of ['getBalance','getAccountInfo','getLatestBlockhash','getSignatureStatuses','getTokenAccountsByOwner',
    'sendTransaction','simulateTransaction','requestAirdrop'])await a.request(rpc(1,method,[]));
  await a.request(rpc(1,'getTransaction',['tx',{commitment:'confirmed'}]));assert.deepEqual(f.counts(),{reads:0,writes:0});
  for(const result of [null,{error:{code:-32000,message:'not available'}}]){
    f.setResult(result);await a.request(rpc(1));await a.request(rpc(2));
  }
  assert.equal(f.counts().writes,0);f.setResult({slot:42});
  await a.request(rpc(1,'getTransaction',['tx',{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:0}]));
  await a.request(rpc(2,'getTransaction',['tx',{maxSupportedTransactionVersion:0,encoding:'json',commitment:'finalized'}]));
  await a.request(rpc(3,'getTransaction',['tx',{commitment:'finalized',encoding:'jsonParsed',maxSupportedTransactionVersion:0}]));
  await a.request(rpc(4,'getBlock',[42,{commitment:'finalized',transactionDetails:'signatures'}]));
  await a.request(rpc(5,'getBlock',[42,{commitment:'finalized',transactionDetails:'full'}]));
  assert.equal(f.values.size,4);assert.equal(f.counts().writes,4);
});

test('corrupt cache results and Redis errors fall back to live RPC without retrying a submission',async()=>{
  const f=fixture(),a=f.gateway();await a.initialize();
  const key=JSON.stringify(['getTransaction',['tx',{commitment:'finalized'}]]);
  for(const response of [{httpStatus:200,body:{jsonrpc:'2.0',result:null}},
    {httpStatus:200,body:{jsonrpc:'2.0',id:'other',result:{slot:1}}},
    {httpStatus:200,body:{jsonrpc:'2.0',error:{code:1}}}]){
    f.values.set(key,{expiresAt:2000,response});const g=f.gateway();await g.initialize();
    assert.equal((await g.request(rpc(1))).body.result.slot,42);assert.equal(g.stats().redisCacheHits,0);
  }
  f.sharedCache.get=async()=>{throw Error('unavailable');};f.sharedCache.set=async()=>{throw Error('unavailable');};
  const b=f.gateway();await b.initialize();assert.equal((await b.request(rpc(2))).body.result.slot,42);
  assert.equal(b.stats().redisCacheErrors,2);
  const count=f.calls.length;await b.request(rpc(3,'sendTransaction',['signed']));assert.equal(f.calls.length,count+1);
});
