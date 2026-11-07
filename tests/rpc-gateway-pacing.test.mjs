import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcGatewayPacing} from '../server/rpc-gateway-pacing.mjs';
import {createRpcGateway,RPC_GATEWAY_DEVNET_GENESIS} from '../server/rpc-gateway.mjs';

test('Helius uses conservative provider-specific pacing without accelerating other providers',()=>{
 assert.deepEqual(rpcGatewayPacing('https://devnet.helius-rpc.com/?api-key=fixture'),
  {minIntervalMs:150,blockIntervalMs:2500,sendIntervalMs:1000,maxConcurrent:4});
 for(const url of ['https://api.devnet.solana.com','https://fake-helius-rpc.com','https://helius-rpc.com.attacker.invalid'])
  assert.deepEqual([rpcGatewayPacing(url).minIntervalMs,rpcGatewayPacing(url).maxConcurrent],[500,1]);
 assert.throws(()=>rpcGatewayPacing('invalid'),/Invalid RPC gateway pacing configuration/);
});

test('mixed Helius reads, historical blocks and writes share one socket budget with independent send pacing',async()=>{
 let time=0;const starts=[];
 const gateway=createRpcGateway({...rpcGatewayPacing('https://devnet.helius-rpc.com'),now:()=>time,wait:async ms=>{time+=ms;},
  transport:async request=>{starts.push({method:request.method,at:time});return{status:200,body:{jsonrpc:'2.0',id:request.id,
   result:request.method==='getGenesisHash'?RPC_GATEWAY_DEVNET_GENESIS:'ok'}};}});
 assert(await gateway.initialize());starts.length=0;
 const methods=['sendTransaction','getBalance','sendTransaction','getBlock','getBlock','sendTransaction'];
 await Promise.all(methods.map((method,id)=>gateway.request({jsonrpc:'2.0',id,method,params:[id]})));
 const sends=starts.filter(r=>r.method==='sendTransaction');
 for(let i=1;i<sends.length;i++)assert(sends[i].at-sends[i-1].at>=1000);
 for(let i=1;i<starts.length;i++)assert(starts[i].at-starts[i-1].at>=150);
 const blocks=starts.filter(r=>r.method==='getBlock');assert(blocks[1].at-blocks[0].at>=2500);
 assert.equal(gateway.stats().pacing.sendIntervalMs,1000);
});

test('a supported read burst fits the queue deadline at the Helius budget and remains bounded for public RPC',async()=>{
 async function run(url){let time=0;const gateway=createRpcGateway({...rpcGatewayPacing(url),now:()=>time,wait:async ms=>{time+=ms;},
  transport:async request=>({status:200,body:{jsonrpc:'2.0',id:request.id,result:request.method==='getGenesisHash'?RPC_GATEWAY_DEVNET_GENESIS:1}})});
  assert(await gateway.initialize());const replies=await Promise.all(Array.from({length:36},(_,id)=>gateway.request({jsonrpc:'2.0',id,method:'getBalance',params:[id]})));
  return{stats:gateway.stats(),replies};}
 const helius=await run('https://devnet.helius-rpc.com');assert(helius.replies.every(r=>r.httpStatus===200));assert.equal(helius.stats.queueRejected,0);
 const publicRpc=await run('https://api.devnet.solana.com');assert(publicRpc.stats.queueRejected>0);
 assert.equal(publicRpc.stats.pacing.minIntervalMs,500);
});

test('a slow Helius response does not hold later paced starts, and in-flight reads stay capped',async()=>{
 let time=0,active=0,maximum=0;const starts=[],releases=[];
 const gateway=createRpcGateway({...rpcGatewayPacing('https://devnet.helius-rpc.com'),now:()=>time,wait:async ms=>{time+=ms;},
  transport:async request=>{
   if(request.method==='getGenesisHash')return{status:200,body:{jsonrpc:'2.0',id:request.id,result:RPC_GATEWAY_DEVNET_GENESIS}};
   starts.push(time);active++;maximum=Math.max(maximum,active);
   await new Promise(resolve=>releases.push(resolve));active--;
   return{status:200,body:{jsonrpc:'2.0',id:request.id,result:1}};}});
 assert(await gateway.initialize());
 const replies=Array.from({length:6},(_,id)=>gateway.request({jsonrpc:'2.0',id,method:'getBalance',params:[id]}));
 while(starts.length<4)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(starts.length,4);for(let i=1;i<starts.length;i++)assert(starts[i]-starts[i-1]>=150);
 while(starts.length<6){releases.shift()?.();await new Promise(resolve=>setImmediate(resolve));}
 while(releases.length)releases.shift()();
 assert((await Promise.all(replies)).every(reply=>reply.httpStatus===200));assert.equal(maximum,4);
});
