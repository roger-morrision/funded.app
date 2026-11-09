import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRpcFailoverTransport,isRpcQuotaRejection,isHeliusRpc} from '../server/rpc-failover.mjs';
import {createRpcGateway,createRpcUpstreamTransport,RPC_GATEWAY_DEVNET_GENESIS as genesis} from '../server/rpc-gateway.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';
const ok=(p,result)=>({status:200,headers:{},body:{jsonrpc:'2.0',id:p.id,result}});
const quota=()=>({status:429,headers:{},body:'max usage reached'});
const request=(method='getSlot',params=[])=>({jsonrpc:'2.0',id:77,method,params});
function fixture({primary=()=>quota(),publicReply=p=>ok(p,p.method==='getGenesisHash'?genesis:123)}={}){
  let time=1000;const primaryCalls=[],publicCalls=[],starts=[];
  const now=()=>time,wait=async ms=>{time+=ms;};
  const transport=createRpcFailoverTransport({primary:async p=>{primaryCalls.push(p);return primary(p);},
    publicTransport:async p=>{publicCalls.push(p);starts.push(time);return publicReply(p);},
    now,recoveryIntervalMs:30000,publicOptions:{wait}});
  return {transport,primaryCalls,publicCalls,starts,now,wait,advance:ms=>{time+=ms;}};
}

test('quota detection handles Helius 429 and explicit credit denial without masking auth or execution failures',()=>{
  for(const response of [quota(),{status:200,body:{error:{code:429}}},
    {status:403,body:'out of credits'},{status:402,body:{error:{message:'credits exhausted'}}}])assert(isRpcQuotaRejection(response));
  for(const response of [{status:401,body:'invalid API key'},{status:403,body:'access forbidden'},
    {status:503},{status:429,body:{result:'signature'}},{status:200,body:{error:{code:-32002,message:'simulation failed'}}}])assert(!isRpcQuotaRejection(response));
  assert(isHeliusRpc('https://devnet.helius-rpc.com/?api-key=private'));
  assert(!isHeliusRpc('https://helius-rpc.com.attacker.example'));
});

test('quota switch verifies public Devnet, preserves request IDs and stays on public during cooldown',async()=>{
  const f=fixture();try{
    const a=await f.transport(request()),b=await f.transport({...request(),id:78});
    assert.equal(a.body.id,77);assert.equal(b.body.id,78);assert.equal(a.body.result,123);
    assert.deepEqual(f.publicCalls.map(p=>p.method),['getGenesisHash','getSlot','getSlot']);
    assert.equal(f.primaryCalls.length,1);assert.equal(f.transport.stats().activeProvider,'public-devnet');
    assert(f.starts[1]-f.starts[0]>=500);assert(f.starts[2]-f.starts[1]>=500);
    assert(!JSON.stringify(f.transport.stats()).includes('api-key'));
  }finally{f.transport.close();}
});

test('gateway can start when Helius is already out of credits',async()=>{
  const f=fixture(),gateway=createRpcGateway({transport:f.transport,now:f.now,wait:f.wait});
  try{assert.equal(await gateway.initialize(),true);const r=await gateway.request(request());
    assert.equal(r.body.result,123);assert.equal(gateway.stats().failover.publicVerified,true);
  }finally{gateway.close();}
});

test('wrong public genesis blocks requests including writes',async()=>{
  const f=fixture({publicReply:p=>ok(p,'mainnet-or-unknown')});try{
    const response=await f.transport(request('sendTransaction',['signed-bytes']));
    assert.equal(response.status,503);assert.deepEqual(f.publicCalls.map(p=>p.method),['getGenesisHash']);
    assert.equal(f.transport.stats().publicVerified,false);
  }finally{f.transport.close();}
});

test('an explicitly rejected transaction is forwarded once with identical signed bytes and options',async()=>{
  const f=fixture(),payload=request('sendTransaction',['signed-transaction',{skipPreflight:false,maxRetries:0}]);try{
    await f.transport(payload);
    const sent=f.publicCalls.filter(p=>p.method==='sendTransaction');assert.equal(sent.length,1);
    assert.deepEqual(sent[0].params,payload.params);assert.equal(f.primaryCalls.length,1);
  }finally{f.transport.close();}
});

test('transport timeouts and normal execution errors never replay a transaction',async()=>{
  for(const primary of [()=>{throw Error('timeout');},p=>({status:200,body:{jsonrpc:'2.0',id:p.id,error:{code:-32002,message:'simulation failed'}}})]){
    const f=fixture({primary});try{
      try{await f.transport(request('sendTransaction',['signed-bytes']));}catch(error){assert.equal(error.message,'timeout');}
      assert.equal(f.publicCalls.length,0);assert.equal(f.transport.stats().activeProvider,'helius');
    }finally{f.transport.close();}
  }
});

test('recovery uses a network-verified read before returning to Helius',async()=>{
  let recovered=false;const f=fixture({primary:p=>recovered?ok(p,p.method==='getGenesisHash'?genesis:456):quota()});try{
    await f.transport(request());f.advance(30000);recovered=true;
    const r=await f.transport(request());assert.equal(r.body.result,456);
    assert.deepEqual(f.primaryCalls.map(p=>p.method),['getSlot','getGenesisHash','getSlot']);
    assert.equal(f.transport.stats().activeProvider,'helius');assert.equal(f.transport.stats().recoveryProbes,1);
  }finally{f.transport.close();}
});

test('failed or wrong-network recovery stays on public and does not probe on every request',async()=>{
  let probe=false;const f=fixture({primary:p=>probe?ok(p,'wrong-network'):quota()});try{
    await f.transport(request());f.advance(30000);probe=true;
    await f.transport(request());await f.transport(request());
    assert.equal(f.primaryCalls.length,2);assert.equal(f.transport.stats().activeProvider,'public-devnet');
  }finally{f.transport.close();}
});

test('concurrent callers share a single recovery probe',async()=>{
  let releaseProbe,ready=false;
  const f=fixture({primary:p=>ready?new Promise(resolve=>{releaseProbe=()=>resolve(ok(p,'wrong-network'));}):quota()});try{
    await f.transport(request());f.advance(30000);ready=true;
    const a=f.transport(request()),b=f.transport({...request(),id:78});
    releaseProbe();await Promise.all([a,b]);assert.equal(f.transport.stats().recoveryProbes,1);
  }finally{f.transport.close();}
});

test('public rate limits stop retries while retaining fallback routing',async()=>{
  const f=fixture({publicReply:p=>p.method==='getGenesisHash'?ok(p,genesis):quota()});try{
    assert.equal((await f.transport(request())).status,429);
    assert.equal((await f.transport(request())).status,429);
    assert.equal(f.publicCalls.length,2);assert.equal(f.primaryCalls.length,1);
    assert.equal(f.transport.stats().publicRateLimited,1);
  }finally{f.transport.close();}
});

test('a mismatched JSON-RPC error ID cannot trigger fallback',async()=>{
  const f=fixture({primary:()=>({status:200,body:{jsonrpc:'2.0',id:'different',error:{code:429}}})});
  try{await f.transport(request());assert.equal(f.publicCalls.length,0);}finally{f.transport.close();}
});

test('HTTP transport preserves bounded plain-text credit errors for classification',async()=>{
  const server=createServer((_req,res)=>{res.writeHead(403);res.end('max usage reached');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const transport=createRpcUpstreamTransport(`http://127.0.0.1:${server.address().port}`);
  try{const response=await transport(request());assert.equal(response.body,'max usage reached');assert(isRpcQuotaRejection(response));}
  finally{transport.close();await new Promise(resolve=>server.close(resolve));}
});

test('Mainnet failover verifies Mainnet, rejects Devnet recovery and blocks transaction submission',async()=>{
  let time=1000,recovered=false,primaryCalls=0;const calls=[];
  const transport=createRpcFailoverTransport({cluster:'mainnet-beta',now:()=>time,recoveryIntervalMs:30000,
    primary:async p=>{primaryCalls++;return recovered?ok(p,genesis):quota();},
    publicTransport:async p=>{calls.push(p.method);return ok(p,p.method==='getGenesisHash'?SOLANA_GENESIS['mainnet-beta']:456);},
    publicOptions:{wait:async ms=>{time+=ms;}}});
  try{
    assert.equal((await transport(request())).body.result,456);assert.equal(transport.stats().activeProvider,'public-mainnet-beta');
    const before=primaryCalls;assert.equal((await transport(request('sendTransaction',['signed']))).status,403);
    assert.equal((await transport(request('requestAirdrop',['wallet',1]))).status,403);assert.equal(primaryCalls,before);
    time+=30000;recovered=true;await transport(request());assert.equal(transport.stats().activeProvider,'public-mainnet-beta');
    assert(!calls.includes('sendTransaction'));assert(!calls.includes('requestAirdrop'));
  }finally{transport.close();}
});

test('Mainnet gateway rejects a Devnet endpoint and keeps history cache keys network-bound',async()=>{
  const keys=[],cached=new Map();
  const sharedCache={close(){},get:async key=>{keys.push(key);return cached.get(key);},set:async(key,response,ttl)=>cached.set(key,{response,expiresAt:Date.now()+ttl})};
  const options={minIntervalMs:0,wait:async()=>{},sharedCache};
  const wrong=createRpcGateway({...options,cluster:'mainnet-beta',transport:async p=>ok(p,genesis)});
  assert.equal(await wrong.initialize(),false);assert.equal((await wrong.request(request())).httpStatus,503);wrong.close();
  for(const cluster of ['devnet','mainnet-beta']){
    const gateway=createRpcGateway({...options,cluster,transport:async p=>ok(p,p.method==='getGenesisHash'?SOLANA_GENESIS[cluster]:{cluster})});
    try{
      assert.equal(await gateway.initialize(),true);
      const result=await gateway.request(request('getTransaction',['signature',{commitment:'finalized'}]));
      assert.equal(result.body.result.cluster,cluster);
      if(cluster==='mainnet-beta')assert.equal((await gateway.request(request('sendTransaction',['signed']))).httpStatus,403);
    }finally{gateway.close();}
  }
  assert.equal(new Set(keys).size,2);
});

test('read timeouts and server outages fail over, but ambiguous writes and successful results never replay',async()=>{
  for(const primary of [()=>{throw Error('timeout');},()=>({status:503})]){
    const f=fixture({primary});try{assert.equal((await f.transport(request())).body.result,123);assert.equal(f.transport.stats().failovers,1);}finally{f.transport.close();}
  }
  const write=fixture({primary:()=>({status:503})});
  try{assert.equal((await write.transport(request('sendTransaction',['signed']))).status,503);assert.equal(write.publicCalls.length,0);}finally{write.transport.close();}
  const result=fixture({primary:p=>({...ok(p,123),status:503})});
  try{await result.transport(request());assert.equal(result.publicCalls.length,0);}finally{result.transport.close();}
});
