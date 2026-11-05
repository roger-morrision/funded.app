import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import {rankLiveBonus,createLiveBonusReader} from '../server/daily-bonus-live.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey.toBase58();
test('today rankings aggregate exact scores, show five and mark only three provisional winners',()=>{
  const entries=Array.from({length:7},(_,i)=>[key(i+1),String((7-i)*100)]);entries.push([key(1),'9007199254740993']);
  entries.push([String(PublicKey.findProgramAddressSync([Buffer.from('test')],new PublicKey(key(9)))[0]),'999999999999999999']);
  const result=rankLiveBonus(entries);assert.equal(result.length,5);assert.equal(result[0].scoreLamports,'9007199254741693');
  assert.equal(result.filter(x=>x.provisionalWinner).length,3);
});
test('a late response from yesterday cannot enter today rankings',async()=>{
  let resolve,now=100;const result=new Promise(r=>resolve=r),reader=createLiveBonusReader({connection:{getGenesisHash:async()=>DEVNET_GENESIS_HASH},
    programId:key(10),now:()=>now,readTrades:()=>result});
  const launch={mint:key(11),createdTimestamp:1,onchainVerified:true,cluster:'devnet',pumpFeeRoute:{scope:'per-mint-v3',verified:true,programId:key(10)}};
  const state={launches:{[launch.mint]:launch}};reader(state,0,200);await new Promise(r=>setImmediate(r));now=210;reader(state,200,400);
  resolve({coverage:{complete:true},rows:[{wallet:key(1),amountLamports:'100',signature:'s',logIndex:0,mint:launch.mint,finalized:true,blockTime:99}]});
  await new Promise(r=>setImmediate(r));assert.deepEqual(reader(state,200,400).traders,[]);
});
