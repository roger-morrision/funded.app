import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcGatewayPacing} from '../server/rpc-gateway-pacing.mjs';
import {createRpcGateway,RPC_GATEWAY_DEVNET_GENESIS} from '../server/rpc-gateway.mjs';

test('Helius uses conservative provider-specific pacing without accelerating other providers',()=>{
 assert.deepEqual(rpcGatewayPacing('https://devnet.helius-rpc.com/?api-key=fixture'),
  {minIntervalMs:250,blockIntervalMs:2500,sendIntervalMs:1000});
 for(const url of ['https://api.devnet.solana.com','https://fake-helius-rpc.com','https://helius-rpc.com.attacker.invalid'])
  assert.equal(rpcGatewayPacing(url).minIntervalMs,500);
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
 for(let i=1;i<starts.length;i++)assert(starts[i].at-starts[i-1].at>=250);
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
