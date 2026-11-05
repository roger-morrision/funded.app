import test from 'node:test';
import assert from 'node:assert/strict';
import {createHolderShareReader} from '../server/callout-market.mjs';
const key='11111111111111111111111111111111';
test('holder detection uses exact raw amounts even when RPC uiAmount is null',async()=>{
 const read=createHolderShareReader({getConnection:()=>({getParsedTokenAccountsByOwner:async()=>({value:[{account:{data:{parsed:{info:{tokenAmount:{amount:'1250000',uiAmount:null}}}}}}]}),getTokenSupply:async()=>({value:{amount:'100000000',uiAmount:null}})})});
 assert.equal(await read(key,key),1.25);
});
test('malformed or timed out holdings remain unavailable, never a zero balance',async()=>{
 const bad=createHolderShareReader({getConnection:()=>({getParsedTokenAccountsByOwner:async()=>({value:[{}]}),getTokenSupply:async()=>({value:{amount:'100'}})})});assert.equal(await bad(key,key),null);
 const slow=createHolderShareReader({timeoutMs:5,getConnection:()=>({getParsedTokenAccountsByOwner:()=>new Promise(()=>{}),getTokenSupply:()=>new Promise(()=>{})})});assert.equal(await slow(key,key),null);
});
