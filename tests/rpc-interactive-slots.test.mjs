import test from 'node:test';
import assert from 'node:assert/strict';
import {createSolanaRpcProxy} from '../server/rpc-proxy.mjs';
test('background reads leave reserved preview slots within the existing total concurrency ceiling',async()=>{
  const releases=[],forwarded=[];
  const proxy=createSolanaRpcProxy({centralized:true,store:{chargeRpcRate:async()=>true},solanaRpcUrl:'http://local.test',
    body:async req=>req.body,authorized:()=>false,clientKey:()=> 'fixture',rpcMethods:new Set(['getAccountInfo']),
    json:(_res,status,body)=>({status,body}),fetch:async(_url,options)=>{
      forwarded.push(JSON.parse(options.body));await new Promise(resolve=>releases.push(resolve));
      return {status:200,ok:true,json:async()=>({jsonrpc:'2.0',result:null})};
    }}).proxySolanaRpc;
  const read=(id,preview=false)=>proxy({headers:{},url:'/api/solana/rpc'+(preview?'?purpose=trade-preview':''),
    body:{jsonrpc:'2.0',id,method:'getAccountInfo',params:['11111111111111111111111111111111']}},{});
  const pending=[];try{
    for(let i=0;i<9;i++){pending.push(read(i));await new Promise(resolve=>setImmediate(resolve));}
    assert.equal((await read(10)).status,429);assert.equal(forwarded.length,9);
    for(let i=0;i<3;i++){pending.push(read(20+i,true));await new Promise(resolve=>setImmediate(resolve));}
    assert.equal(forwarded.length,12);assert.equal((await read(24,true)).status,429);
  }finally{for(const release of releases)release();await Promise.all(pending);}
});
