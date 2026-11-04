import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {readIndexedCommunityBase} from '../server/community-indexed-base.mjs';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey;
function fixture({balances=[40n,60n],authority=false,count=2}={}){
  const mintKey=key(1),addresses=Array.from({length:count},(_,i)=>key(i+2)),mint=Buffer.alloc(82);mint[45]=1;
  mint.writeUInt32LE(authority?1:0);mint.writeBigUInt64LE(100n,36);let requests=0,atomicReads=0;
  const connection={rpcEndpoint:'https://rpc.invalid',getMultipleAccountsInfoAndContext:async keys=>{
    atomicReads++;assert.equal(keys[0].toBase58(),mintKey.toBase58());
    return{context:{slot:123},value:[{owner:TOKEN_PROGRAM_ID,data:mint},...addresses.map((_,i)=>{
      const data=Buffer.alloc(165);mintKey.toBuffer().copy(data);key(200+i).toBuffer().copy(data,32);data.writeBigUInt64LE(balances[i]||0n,64);data[108]=1;
      return{owner:TOKEN_PROGRAM_ID,data};})]};
  }};
  const fetchImpl=async(_url,options)=>{requests++;const p=JSON.parse(options.body).params;
    return{ok:true,json:async()=>p.mint?{error:{code:-32602,message:'unknown field `mint`, expected `mintAddress`'}}:
      {result:{total:addresses.length,token_accounts:addresses.map(address=>({address:address.toBase58()}))}}};};
  return{args:{connection,mintKey,fetchImpl},counts:()=>({requests,atomicReads})};
}
test('indexed addresses become eligibility only after one complete finalized supply snapshot',async()=>{
  const f=fixture(),base=await readIndexedCommunityBase(f.args);assert.equal(base.slot,123);assert.equal(base.supply,100n);
  assert.deepEqual(base.accounts.map(row=>row.balance),[40n,60n]);assert.deepEqual(f.counts(),{requests:2,atomicReads:1});
});
test('partial holder coverage and mutable eligibility mints cannot create a community snapshot',async()=>{
  await assert.rejects(readIndexedCommunityBase(fixture({balances:[40n,59n]}).args),/full fixed supply/);
  await assert.rejects(readIndexedCommunityBase(fixture({authority:true}).args),/mint authority/);
});
test('larger holder lists cannot be stitched across bank contexts',async()=>{
  const f=fixture({count:100});await assert.rejects(readIndexedCommunityBase(f.args),/one atomic/);assert.equal(f.counts().atomicReads,0);
});
