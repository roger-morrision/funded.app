import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { bondingCurvePda } from '@pump-fun/pump-sdk';
import { deriveMintRouterV3 } from '../mint-router-v3.js';
import { createDailyBonusEvidenceIndex } from '../server/daily-bonus-index.mjs';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
const start=Date.parse('2026-10-17')/1000, now=start+86400;
const keys=Array.from({length:202},(_,i)=>{const seed=Buffer.alloc(32);seed.writeUInt32LE(i+1);return Keypair.fromSeed(seed).publicKey.toBase58();});
const programId=keys[201];
const sig=i=>{const bytes=Buffer.alloc(64,1);bytes.writeUInt32LE(i);return bs58.encode(bytes);};
const memory=()=>({data:{},async read(){return structuredClone(this.data);},async transaction(fn){const next=structuredClone(this.data),result=await fn(next);this.data=next;return result;}});
const launch=mint=>({mint,creatorWallet:keys[200],createdTimestamp:start-1,onchainVerified:true,cluster:'devnet',pumpFeeRoute:{scope:'per-mint-v3',verified:true,programId}});
const reference=(i,time=now+1)=>({signature:sig(i),slot:50000-i,blockTime:time,confirmationStatus:'finalized',err:null});
function setup(mints=[keys[0]]) {
 const rewardStore=memory(),state={launches:Object.fromEntries(mints.map(mint=>[mint,launch(mint)]))};
 const connection={getGenesisHash:async()=>DEVNET_GENESIS_HASH,getSlot:async()=>60000,getBlockTime:async()=>now,getSignaturesForAddress:async()=>[]};
 return {rewardStore,state,connection,args:{connection,state,programId,day:'2026-10-17',now}};
}
test('more than 2000 post-cutoff references resume across durable checkpoints without rejecting the day',async()=>{
 const f=setup(),curve=bondingCurvePda(keys[0]).toBase58(),refs=Array.from({length:2101},(_,i)=>reference(i+1));
 f.connection.getSignaturesForAddress=async(address,{limit,before})=>address.toBase58()===curve
  ? refs.slice(before?refs.findIndex(row=>row.signature===before)+1:0,(before?refs.findIndex(row=>row.signature===before)+1:0)+limit):[];
 let result,passes=0;
 do {const reader=createDailyBonusEvidenceIndex({rewardStore:f.rewardStore,pagesPerTick:2});result=await reader(f.args);passes++;} while(!result.complete&&passes<20);
 assert.equal(result.complete,true);assert(passes>10);assert.deepEqual(result.trades,[]);
 assert.equal(Object.values(f.rewardStore.data.dailyBonusIndexes['2026-10-17'].routes)[0].complete,true);
});
test('201 verified mints complete in bounded batches without a lifetime catalog limit',async()=>{
 const f=setup(keys.slice(0,201));let result,passes=0;
 do{result=await createDailyBonusEvidenceIndex({rewardStore:f.rewardStore,pagesPerTick:64})(f.args);passes++;}while(!result.complete&&passes<15);
 assert.equal(result.complete,true);assert.equal(result.coverage.length,201);assert(passes>1);
});
test('missing transactions preserve the cursor and verified prefix for safe restart',async()=>{
 const f=setup(),curve=bondingCurvePda(keys[0]).toBase58(),refs=Array.from({length:6},(_,i)=>reference(i+1,start+1));
 f.connection.getSignaturesForAddress=async address=>address.toBase58()===curve?refs:[];
 let missing=true;
 f.connection.getTransaction=async signature=>{const ref=refs.find(row=>row.signature===signature);return missing&&signature===refs[2].signature?null:{slot:ref.slot,blockTime:ref.blockTime,meta:{err:null},transaction:{signatures:[signature]}};};
 const options={rewardStore:f.rewardStore,transactionsPerTick:2,decodeTrade:(_,ref,mint)=>[{signature:ref.signature,logIndex:0,mint:mint.toBase58(),wallet:keys[10],amountLamports:'1',blockTime:start+1,finalized:true}]};
 assert.equal((await createDailyBonusEvidenceIndex(options)(f.args)).complete,false);
 assert.equal(Object.values(f.rewardStore.data.dailyBonusIndexes['2026-10-17'].routes)[0].pending.length,4);
 await assert.rejects(createDailyBonusEvidenceIndex(options)(f.args),/proof is unavailable/);
 assert.equal(Object.keys(f.rewardStore.data.dailyBonusIndexes['2026-10-17'].trades).length,2);
 missing=false;let result;
 do{result=await createDailyBonusEvidenceIndex(options)(f.args);}while(!result.complete);
 assert.equal(result.trades.length,6);
});
test('a finalized on-chain collection blocks publication until its app record and signed settlement catch up',async()=>{
 const f=setup(),mint=keys[0],router=deriveMintRouterV3(programId,mint).address.toBase58(),ref=reference(1,start+1),claimId=Buffer.alloc(32,2);
 f.connection.getSignaturesForAddress=async address=>address.toBase58()===router?[ref]:[];
 f.connection.getTransaction=async()=>({slot:ref.slot,blockTime:ref.blockTime,meta:{err:null},transaction:{signatures:[ref.signature]}});
 const reader=createDailyBonusEvidenceIndex({rewardStore:f.rewardStore,verifyCollection:async()=>({expectedLamports:1000000n,claimId}),loadSettlement:async()=>({categoryLamports:['800000','80000','20000','6000','4000','40000','50000']})});
 const pending=await reader(f.args);assert.equal(pending.complete,false);assert.match(pending.reason,/indexed collections/);
 f.state.collections={[ref.signature]:{signature:ref.signature,mint,scope:'per-mint-v3',cluster:'devnet',programId,status:'collected',onchainVerified:true,attribution:'mint-verified',collectedLamports:1000000,claimId:claimId.toString('hex')}};
 f.state.v3Settlements={[ref.signature]:{mint,collectionSignature:ref.signature,status:'finalized',settlementSignature:sig(20),referralUpline:[]}};
 const complete=await reader(f.args);assert.equal(complete.complete,true);assert.equal(complete.collections.length,1);assert.equal(complete.collections[0].communityLamports,'40000');
});
