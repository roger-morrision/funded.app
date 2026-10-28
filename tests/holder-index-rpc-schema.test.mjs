import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createHolderHistoryIndexer } from '../server/holder-history-indexer.mjs';

const schemaError = { code:-32602,
  message:'unknown field `mint`, expected one of `ownerAddress`, `mintAddress`, `limit`, `page`' };
function fixture(reply) {
  const mint=Keypair.generate().publicKey, wallet=Keypair.generate().publicKey;
  const addresses=[Keypair.generate().publicKey,Keypair.generate().publicKey];
  const mintData=Buffer.alloc(82);mintData.writeBigUInt64LE(100n,36);
  const accounts=[60n,40n].map(amount=>{const data=Buffer.alloc(165);mint.toBuffer().copy(data);wallet.toBuffer().copy(data,32);data.writeBigUInt64LE(amount,64);data[108]=1;return{data,owner:TOKEN_PROGRAM_ID};});
  const state={},requests=[];
  const connection={rpcEndpoint:'https://fixture.invalid',getGenesisHash:async()=>'devnet-fixture',
    getAccountInfo:async()=>({data:mintData,owner:TOKEN_PROGRAM_ID}),getSlot:async()=>123,getBlockTime:async()=>1234,
    getProgramAccounts:async()=>{throw Error('excluded from account secondary indexes');},
    getMultipleAccountsInfo:async keys=>keys.map(key=>accounts[addresses.findIndex(a=>a.equals(key))]),
    getTokenLargestAccounts:async()=>{throw Error('No truncated fallback available');}};
  const index=createHolderHistoryIndexer({connection,store:{transaction:async action=>action(state)},expectedGenesisHash:'devnet-fixture',
    fetchImpl:async(_url,options)=>{const {params}=JSON.parse(options.body);requests.push(params);return Response.json(reply(params,addresses));}});
  return{mint,index,state,requests,connection};
}

test('public RPC mintAddress negotiation retains finalized supply completeness',async()=>{
  const f=fixture((params,addresses)=>params.mint?{error:schemaError}:{result:{token_accounts:addresses.map(address=>({address:address.toBase58()}))}});
  const snapshot=await f.index.capture(f.mint);
  assert.equal(snapshot.source,'indexed-token-accounts-complete');assert.equal(snapshot.finalized,true);
  assert.equal(snapshot.accounts[0].balance,'100');assert.equal(snapshot.tokenAccountCount,2);
  assert.equal(f.requests.length,2);assert.equal(f.requests[0].mint,f.mint.toBase58());assert.equal(f.requests[1].mintAddress,f.mint.toBase58());
});

test('existing Helius mint requests keep their original format',async()=>{
  const f=fixture((_params,addresses)=>({result:{token_accounts:addresses.map(address=>({address:address.toBase58()}))}}));
  await f.index.capture(f.mint);assert.equal(f.requests.length,1);assert.equal(f.requests[0].mint,f.mint.toBase58());assert.equal(f.requests[0].mintAddress,undefined);
});

test('negotiated format persists across pages and duplicate addresses are verified once',async()=>{
  const f=fixture((params,addresses)=>params.mint?{error:schemaError}:{result:{token_accounts:params.page===1?Array.from({length:1000},(_,i)=>({address:addresses[i%2].toBase58()})):[]}});
  const snapshot=await f.index.capture(f.mint);assert.equal(snapshot.tokenAccountCount,2);
  assert.deepEqual(f.requests.map(p=>[p.page,Boolean(p.mintAddress)]),[[1,false],[1,true],[2,true]]);
});

test('other errors never trigger a request-format retry or persist a snapshot',async()=>{
  for(const error of [{code:429,message:'quota exhausted'}, {code:-32602,message:'invalid mint'},
    {code:-32602,message:'unknown field `mint`, expected ownerAddress'}]) {
    const f=fixture(()=>({error}));await assert.rejects(f.index.capture(f.mint));
    assert.equal(f.requests.length,1);assert.equal(f.state.holderSnapshots,undefined);
  }
});

test('a truncated alternate-format result cannot establish complete holder readiness',async()=>{
  const f=fixture((params,addresses)=>params.mint?{error:schemaError}:{result:{token_accounts:[{address:addresses[0].toBase58()}]}});
  await assert.rejects(f.index.capture(f.mint),/coverage is 60 of 100/);assert.equal(f.state.holderSnapshots,undefined);
});

test('wrong network is rejected before indexed-provider reads',async()=>{
  const f=fixture(()=>({result:{token_accounts:[]}}));f.connection.getGenesisHash=async()=>'wrong-network';
  await assert.rejects(f.index.capture(f.mint),/network/);assert.equal(f.requests.length,0);assert.equal(f.state.holderSnapshots,undefined);
});
