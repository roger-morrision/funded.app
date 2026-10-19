import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,NATIVE_MINT,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk';
import {PUMP_AMM_PROGRAM_ID,canonicalPumpPoolPda} from '@pump-fun/pump-swap-sdk';
import {agencyMarketCapMicros,readAgencyMarketObservation} from '../server/agency-market-observation.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
const mint=Keypair.fromSeed(Buffer.alloc(32,191)).publicKey,pool=canonicalPumpPoolPda(mint,NATIVE_MINT),at=Date.parse('2026-10-19T12:00:00Z');
function fixture(){
  const baseAta=getAssociatedTokenAddressSync(mint,pool,true),quoteAta=getAssociatedTokenAddressSync(NATIVE_MINT,pool,true);
  const mintData=Buffer.alloc(82);mintData.writeBigUInt64LE(1000000000000000n,36);mintData[44]=6;mintData[45]=1;
  const token=(key,amount)=>{const data=Buffer.alloc(165);key.toBuffer().copy(data);pool.toBuffer().copy(data,32);data.writeBigUInt64LE(amount,64);data[108]=1;return{owner:TOKEN_PROGRAM_ID,data};};
  const poolInfo={owner:PUMP_AMM_PROGRAM_ID,data:Buffer.from('synthetic pool layout')},curve={complete:true};
  const snapshot={context:{slot:1234},value:[poolInfo,{owner:TOKEN_PROGRAM_ID,data:mintData},{owner:PUMP_PROGRAM_ID,data:Buffer.from('curve')},
    token(mint,100000000000000n),token(NATIVE_MINT,100000000000n)]};
  const usd={priceUsd:100,source:'coingecko',fetchedAt:new Date(at).toISOString()};
  const layout={baseMint:mint,quoteMint:NATIVE_MINT,poolBaseTokenAccount:baseAta,poolQuoteTokenAccount:quoteAta,virtualQuoteReserves:0n};
  const input={mint:mint.toBase58(),now:()=>at,connection:{getGenesisHash:async()=>DEVNET_GENESIS_HASH,getAccountInfo:async()=>poolInfo,
    getMultipleAccountsInfoAndContext:async(keys,options)=>{assert.equal(options.commitment,'finalized');assert.equal(keys.length,5);return snapshot;},
    getBlockTime:async()=>at/1000,getMultipleAccountsInfo:async(keys,options)=>{assert.equal(options.commitment,'finalized');assert.equal(options.minContextSlot,1234);return keys.map(()=>({extra:true}));}},
    decodePool:()=>layout,decodeCurve:()=>curve,readSolUsd:async()=>usd};
  return{input,snapshot,usd,layout,curve,baseAta};
}
test('market-cap arithmetic is exact at both milestone boundaries and never rounds upward',()=>{
  const base={supply:'1000000000000000',baseReserve:'100000000000000',quoteReserve:'100000000000',solUsd:'100'};
  assert.equal(agencyMarketCapMicros(base),'100000000000');
  assert.equal(agencyMarketCapMicros({...base,quoteReserve:'99999999999'}),'99999999999');
  assert.equal(agencyMarketCapMicros({...base,quoteReserve:'300000000000'}),'300000000000');
  assert.equal(agencyMarketCapMicros({...base,virtualQuoteReserve:'100000000000'}),'200000000000');
  for(const bad of [{baseReserve:'0'},{solUsd:'server-config'},{supply:'01'},{solUsd:NaN}])assert.throws(()=>agencyMarketCapMicros({...base,...bad}));
});
test('one finalized bank snapshot and independently fetched USD reference bind supply and canonical own-coin reserves',async()=>{
  const f=fixture(),result=await readAgencyMarketObservation(f.input);
  assert.equal(result.verified,true);assert.equal(result.marketCapUsdMicros,'100000000000');assert.equal(result.pool,pool.toBase58());
  assert.equal(result.observationHash.length,64);assert.equal(result.accountHashes.length,5);
  const pinned=await result.pinnedConnection.getMultipleAccountsInfo([mint,f.baseAta,Keypair.fromSeed(Buffer.alloc(32,192)).publicKey]);
  assert.deepEqual(pinned[0],f.snapshot.value[1]);assert.deepEqual(pinned[1],f.snapshot.value[3]);assert.equal(pinned[2].extra,true);
});
test('unmigrated markets, stale bank/USD data, configured prices and altered reserve custody fail closed',async()=>{
  const edits=[f=>f.curve.complete=false,f=>f.usd.source='server-config',f=>f.usd.fetchedAt=new Date(at-60001).toISOString(),
    f=>f.input.connection.getBlockTime=async()=>at/1000-61,f=>f.snapshot.value[3].data[32]^=1,
    f=>f.snapshot.value[4].data[0]^=1,f=>f.snapshot.value[3].data[108]=2,
    f=>f.layout.poolBaseTokenAccount=mint,f=>f.snapshot.value[1].owner=PUMP_PROGRAM_ID];
  for(const edit of edits){const f=fixture();edit(f);await assert.rejects(()=>readAgencyMarketObservation(f.input));}
});
