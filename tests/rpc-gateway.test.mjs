import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {PublicKey} from '@solana/web3.js';
import {createRpcGateway,createRpcUpstreamTransport,RPC_GATEWAY_DEVNET_GENESIS} from '../server/rpc-gateway.mjs';
import {createRpcGatewayServer} from '../server/rpc-gateway-server.mjs';
import {SharedRpcConnection} from '../server/rpc-connection.mjs';

const address=n=>{const bytes=Buffer.alloc(32);bytes.writeUInt32LE(n);return new PublicKey(bytes).toBase58();};
const rpc=(id,method,params=[])=>({jsonrpc:'2.0',id,method,params});
const ok=(request,result)=>({status:200,headers:{},body:{jsonrpc:'2.0',id:request.id,result}});
async function fixture(handler,options={}){
  const calls=[];let time=0;
  const gateway=createRpcGateway({minIntervalMs:0,blockIntervalMs:0,batchWindowMs:2,now:()=>time,wait:async ms=>{time+=ms;},
    transport:async request=>{calls.push(structuredClone(request));return request.method==='getGenesisHash'?ok(request,RPC_GATEWAY_DEVNET_GENESIS):handler(request);},...options});
  assert.equal(await gateway.initialize(),true);calls.length=0;
  return{gateway,calls,advance:ms=>{time+=ms;},time:()=>time};
}

test('many clients coalesce one identical read while preserving every JSON-RPC id',async()=>{
  const {gateway,calls}=await fixture(request=>ok(request,{context:{slot:99},value:123}));
  const replies=await Promise.all(Array.from({length:30},(_,id)=>gateway.request(rpc(id,'getBalance',[address(1),{commitment:'finalized'}]))));
  assert.equal(calls.length,1);assert.equal(gateway.stats().coalescedReads,29);
  replies.forEach((reply,id)=>{assert.equal(reply.body.id,id);assert.equal(reply.body.result.value,123);});
});

test('canonical keys deduplicate option order and keep commitment and minContextSlot separate',async()=>{
  const {gateway,calls}=await fixture(request=>ok(request,{context:{slot:99},value:123}));
  await Promise.all([
    gateway.request(rpc(1,'getBalance',[address(1),{commitment:'finalized',minContextSlot:90}])),
    gateway.request(rpc(2,'getBalance',[address(1),{minContextSlot:90,commitment:'finalized'}])),
    gateway.request(rpc(3,'getBalance',[address(1),{commitment:'confirmed',minContextSlot:90}])),
    gateway.request(rpc(4,'getBalance',[address(1),{commitment:'finalized',minContextSlot:91}])),
  ]);assert.equal(calls.length,3);
});

test('compatible account requests share one atomic account read with original configuration and ordering',async()=>{
  const {gateway,calls}=await fixture(request=>ok(request,{context:{slot:444},value:request.params[0].map(key=>({owner:key,lamports:7}))}));
  const options={encoding:'base64',commitment:'finalized',minContextSlot:400,dataSlice:{offset:2,length:8}};
  const replies=await Promise.all([5,3,8].map(id=>gateway.request(rpc(id,'getAccountInfo',[address(id),options]))));
  assert.equal(calls.length,1);assert.equal(calls[0].method,'getMultipleAccounts');assert.deepEqual(calls[0].params[1],options);
  replies.forEach((reply,index)=>{assert.equal(reply.body.result.context.slot,444);assert.equal(reply.body.result.value.owner,address([5,3,8][index]));});
  assert.equal(gateway.stats().accountBatchSavings,2);
});

test('account batching respects different banks and the native 100-account limit',async()=>{
  const {gateway,calls}=await fixture(request=>ok(request,{context:{slot:500},value:request.method==='getMultipleAccounts'?request.params[0].map(()=>null):null}));
  const config={encoding:'base64',commitment:'finalized'};
  await Promise.all(Array.from({length:101},(_,id)=>gateway.request(rpc(id,'getAccountInfo',[address(id),config]))));
  assert.equal(calls.length,2);assert.equal(calls.find(row=>row.method==='getMultipleAccounts').params[0].length,100);
  calls.length=0;
  await Promise.all([gateway.request(rpc(1,'getAccountInfo',[address(1),config])),gateway.request(rpc(2,'getAccountInfo',[address(2),{...config,minContextSlot:499}]))]);
  assert.equal(calls.length,2);assert(calls.every(row=>row.method==='getAccountInfo'));
});

test('incomplete account batches fail closed and invalid addresses do not poison a valid group',async()=>{
  const {gateway,calls}=await fixture(request=>ok(request,{context:{slot:500},value:[]}));
  const config={encoding:'base64',commitment:'finalized'};
  const replies=await Promise.all([1,2].map(id=>gateway.request(rpc(id,'getAccountInfo',[address(id),config]))));
  assert(replies.every(row=>row.httpStatus===502&&row.body.error));calls.length=0;
  await Promise.all([gateway.request(rpc(3,'getAccountInfo',['bad-address',config])),gateway.request(rpc(4,'getAccountInfo',[address(4),config]))]);
  assert.equal(calls.length,2);assert(calls.every(row=>row.method==='getAccountInfo'));
});

test('mutable balances and blockhashes are never served from a TTL cache',async()=>{
  let value=0;const {gateway,calls}=await fixture(request=>ok(request,++value));
  for(const method of ['getBalance','getAccountInfo','getLatestBlockhash','getSignatureStatuses']){
    const first=await gateway.request(rpc(1,method,[])),second=await gateway.request(rpc(2,method,[]));
    assert.notEqual(first.body.result,second.body.result);
  }assert.equal(calls.length,8);
});

test('only non-null finalized history is cached and memory and expiry are bounded',async()=>{
  let result=null;const {gateway,calls,advance}=await fixture(request=>ok(request,result),{cacheMaxEntries:1});
  const read=(id,commitment='finalized')=>gateway.request(rpc(id,'getTransaction',['signature',{commitment}]));
  await read(1);await read(2);assert.equal(calls.length,2);
  result={slot:77,meta:{err:null}};await read(3);await read(4);assert.equal(calls.length,3);
  await read(5,'confirmed');await read(6,'confirmed');assert.equal(calls.length,5);
  advance(300001);await read(7);assert.equal(calls.length,6);assert(gateway.stats().cacheEntries<=1);
});

test('transaction submissions and simulations never coalesce, cache or retry uncertain transport failures',async()=>{
  const {gateway,calls}=await fixture(request=>{if(request.params[0]==='uncertain')throw Error('secret endpoint failed');return ok(request,'signature');});
  const params=['signed-transaction',{maxRetries:0,skipPreflight:false}];
  await Promise.all([gateway.request(rpc(1,'sendTransaction',params)),gateway.request(rpc(2,'sendTransaction',params))]);
  assert.equal(calls.length,2);assert.deepEqual(calls[0].params,params);
  const failed=await gateway.request(rpc(3,'sendTransaction',['uncertain']));
  assert.equal(failed.httpStatus,503);assert.equal(calls.length,3);assert(!JSON.stringify(failed).includes('secret'));
  await Promise.all([gateway.request(rpc(4,'simulateTransaction',params)),gateway.request(rpc(5,'simulateTransaction',params))]);
  assert.equal(calls.length,5);
});

test('a write is a coalescing barrier for later balance proofs',async()=>{
  let release,started;const ready=new Promise(resolve=>{started=resolve;});let balance=0;
  const {gateway,calls}=await fixture(async request=>{
    if(request.method==='getBalance'&&++balance===1){started();await new Promise(resolve=>{release=resolve;});return ok(request,1);}
    return ok(request,request.method==='getBalance'?2:'signature');
  });
  const before=gateway.request(rpc(1,'getBalance',[address(1)]));await ready;
  const write=gateway.request(rpc(2,'sendTransaction',['signed'])),after=gateway.request(rpc(3,'getBalance',[address(1)]));release();
  assert.equal((await before).body.result,1);await write;assert.equal((await after).body.result,2);
  assert.deepEqual(calls.map(row=>row.method),['getBalance','sendTransaction','getBalance']);
});

test('provider throttling opens a shared cooldown instead of repeated upstream calls',async()=>{
  let limited=true;const {gateway,calls,advance}=await fixture(request=>limited?{status:429,headers:{'retry-after':'20'},body:null}:ok(request,7));
  assert.equal((await gateway.request(rpc(1,'getBalance',[address(1)]))).httpStatus,429);
  assert.equal((await gateway.request(rpc(2,'getBalance',[address(2)]))).httpStatus,429);assert.equal(calls.length,1);
  advance(20001);limited=false;assert.equal((await gateway.request(rpc(3,'getBalance',[address(2)]))).body.result,7);assert.equal(calls.length,2);
});

test('an explicitly method-scoped public limit does not stall unrelated financial reads',async()=>{
  const {gateway,calls}=await fixture(request=>request.method==='getTokenLargestAccounts'
    ?{status:429,headers:{},body:{error:{code:429,message:'Too many requests for a specific RPC call'}}}:ok(request,7));
  assert.equal((await gateway.request(rpc(1,'getTokenLargestAccounts',[address(1)]))).httpStatus,429);
  assert.equal((await gateway.request(rpc(2,'getBalance',[address(1)]))).body.result,7);
  assert.equal((await gateway.request(rpc(3,'getTokenLargestAccounts',[address(1)]))).httpStatus,429);
  assert.equal(calls.length,2);assert(gateway.stats().methodCooldowns.getTokenLargestAccounts>0);
});

test('a full queue rejects excess work without forwarding or retrying it',async()=>{
  let release,started;const ready=new Promise(resolve=>{started=resolve;});
  const {gateway,calls}=await fixture(async request=>{started();await new Promise(resolve=>{release=resolve;});return ok(request,1);},{maxQueue:1});
  const first=gateway.request(rpc(1,'getBalance',[address(1)]));await ready;
  assert.equal((await gateway.request(rpc(2,'sendTransaction',['signed']))).httpStatus,429);
  assert.equal(calls.length,1);release();await first;assert.equal(calls.length,1);
});

test('one global queue serializes the provider and applies the separate block budget',async()=>{
  const starts=[];let active=0,maximum=0,time=0;
  const {gateway}=await fixture(async request=>{active++;maximum=Math.max(maximum,active);starts.push({method:request.method,at:time});await new Promise(r=>setTimeout(r,2));active--;return ok(request,1);},
    {minIntervalMs:500,blockIntervalMs:2500,now:()=>time,wait:async ms=>{time+=ms;}});
  await Promise.all(['getBlock','getBlock','getBalance'].map((method,id)=>gateway.request(rpc(id,method,[id,{commitment:'finalized'}]))));
  assert.equal(maximum,1);assert(starts[1].at-starts[0].at>=2500);assert(starts[2].at-starts[1].at>=500);
});

test('wrong-network and unsupported requests cannot reach financial RPC methods',async()=>{
  const gateway=createRpcGateway({transport:async request=>ok(request,'wrong-genesis'),minIntervalMs:0});
  assert.equal(await gateway.initialize(),false);assert.equal((await gateway.request(rpc(1,'sendTransaction',['signed']))).httpStatus,503);
  const {gateway:ready,calls}=await fixture(request=>ok(request,1));
  assert.equal((await ready.request(rpc(2,'adminReset',[]))).httpStatus,400);assert.equal(calls.length,0);
  assert.throws(()=>createRpcUpstreamTransport('http://untrusted.invalid/?api-key=secret'),/Invalid RPC upstream/);
});

test('real HTTP clients share one persistent upstream socket and duplicate reads consume one request',async()=>{
  const sockets=new Set();let reads=0;
  const upstream=createServer(async(req,res)=>{sockets.add(req.socket);let data='';for await(const part of req)data+=part;
    const request=JSON.parse(data);if(request.method!=='getGenesisHash')reads++;
    res.setHeader('content-type','application/json');res.end(JSON.stringify(ok(request,request.method==='getGenesisHash'?RPC_GATEWAY_DEVNET_GENESIS:{context:{slot:88},value:99}).body));});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const transport=createRpcUpstreamTransport(`http://127.0.0.1:${upstream.address().port}/`),gateway=createRpcGateway({transport,minIntervalMs:0});
  assert.equal(await gateway.initialize(),true);const server=createRpcGatewayServer({gateway});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url=`http://127.0.0.1:${server.address().port}/`;
    const replies=await Promise.all(Array.from({length:15},(_,id)=>fetch(url,{method:'POST',body:JSON.stringify(rpc(id,'getBalance',[address(1)]))}).then(response=>response.json())));
    assert(replies.every(row=>row.result.value===99));assert.equal(reads,1);assert.equal(sockets.size,1);
    const count=gateway.stats().upstreamRequests;await fetch(url+'health');await fetch(url+'metrics');assert.equal(gateway.stats().upstreamRequests,count);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));gateway.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));}
});

test('parallel SDK account readers reach one central atomic batch without a second local rate queue',async()=>{
  const calls=[];
  const gateway=createRpcGateway({minIntervalMs:0,batchWindowMs:20,transport:async request=>{
    calls.push(request);return ok(request,request.method==='getGenesisHash'?RPC_GATEWAY_DEVNET_GENESIS:
      {context:{slot:777},value:request.params[0].map(()=>({data:['','base64'],owner:'11111111111111111111111111111111',lamports:123,executable:false,rentEpoch:0}))});
  }});await gateway.initialize();
  const server=createRpcGatewayServer({gateway});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const prior=[process.env.FUNDED_RPC_GATEWAY_ENABLED,process.env.FUNDED_RPC_GATEWAY_URL],url=`http://127.0.0.1:${server.address().port}`;
  process.env.FUNDED_RPC_GATEWAY_ENABLED='true';process.env.FUNDED_RPC_GATEWAY_URL=url;
  try{
    const first=new SharedRpcConnection(url,'finalized'),second=new SharedRpcConnection(url,'finalized');
    const results=await Promise.all([first.getAccountInfoAndContext(new PublicKey(address(1))),second.getAccountInfoAndContext(new PublicKey(address(2)))]);
    assert.equal(results[0].context.slot,777);assert.equal(results[1].context.slot,777);assert.equal(results[0].value.lamports,123);
    assert.deepEqual(calls.slice(1).map(row=>row.method),['getMultipleAccounts']);
  }finally{
    for(const [index,key] of ['FUNDED_RPC_GATEWAY_ENABLED','FUNDED_RPC_GATEWAY_URL'].entries()){
      if(prior[index]===undefined)delete process.env[key];else process.env[key]=prior[index];}
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));gateway.close();
  }
});
