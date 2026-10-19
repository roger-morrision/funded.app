import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {unlink} from 'node:fs/promises';
import {createAutomaticRewardStore} from '../server/automatic-reward-store.mjs';
import bs58 from 'bs58';
import {Keypair} from '@solana/web3.js';
import {deriveMintPolicyV3} from '../mint-router-v3.js';
import {createDailyBonusEvidenceIndex} from '../server/daily-bonus-index.mjs';
import {buildDailyBonusSnapshot} from '../server/daily-bonus.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';

const keys=Array.from({length:5},(_,n)=>Keypair.fromSeed(Buffer.alloc(32,n+60)).publicKey.toBase58());
const [programId,mint,creator,authority,referrer]=keys;
const start=Date.parse('2026-10-18')/1000,day='2026-10-18',now=start+86400;
const signature=n=>bs58.encode(Buffer.alloc(64,n));
function fixture(){
  const policy=deriveMintPolicyV3(programId,mint).address.toBase58(),claimId=Buffer.alloc(32,3);
  const source=signature(1),settlement=signature(2);
  const reference={signature:settlement,slot:500,blockTime:start+10,confirmationStatus:'finalized',err:null};
  const data=Buffer.alloc(48);
  createHash('sha256').update('global:settle_mint_v3').digest().copy(data,0,0,8);
  claimId.copy(data,8);data.writeBigUInt64LE(1000000n,40);
  const transaction={slot:500,blockTime:reference.blockTime,meta:{err:null},transaction:{signatures:[settlement],message:{
    accountKeys:[programId,mint,policy],instructions:[{programIdIndex:0,accounts:[1,2],data:bs58.encode(data)}]}}};
  const collectionTx={slot:100,blockTime:start-86400,meta:{err:null},transaction:{signatures:[source]}};
  const rewardStore={data:{},async read(){return structuredClone(this.data);},async transaction(fn){
    const next=structuredClone(this.data),result=await fn(next);this.data=next;return result;}};
  const launch={mint,creatorWallet:creator,createdTimestamp:start-2*86400,onchainVerified:true,cluster:'devnet',
    pumpFeeRoute:{scope:'per-mint-v3',verified:true,programId,initialAuthority:authority},
    feeDistribution:{fixedFunded:{communityRewards:{dailyBonus:{version:1}}}}};
  const state={launches:{[mint]:launch},collections:{[source]:{signature:source,mint,scope:'per-mint-v3',cluster:'devnet',
    programId,status:'collected',onchainVerified:true,attribution:'mint-verified',collectedLamports:'1000000',claimId:claimId.toString('hex')}},
    v3Settlements:{[source]:{mint,collectionSignature:source,status:'finalized',settlementSignature:settlement,referralUpline:[referrer]}}};
  const proof={signature:settlement,slot:500,blockTime:reference.blockTime,claimId:claimId.toString('hex'),
    expectedLamports:'1000000',categoryLamports:['800000','80000','20000','6000','4000','40000','50000']};
  const connection={getGenesisHash:async()=>DEVNET_GENESIS_HASH,getSlot:async()=>600,getBlockTime:async()=>now,
    getSignaturesForAddress:async address=>address.toBase58()===policy?[reference]:[],
    getTransaction:async id=>id===source?collectionTx:id===settlement?transaction:null};
  const options={rewardStore,verifyCollection:async()=>({claimId,expectedLamports:1000000n}),loadSettlement:async()=>structuredClone(proof)};
  return {state,proof,source,connection,rewardStore,options,args:{state,connection,programId,day,now,eligibilityBasis:'settlement-time-v1'}};
}

test('a prior-day collection enters its finalized settlement window and unrelated unsettled fees do not block it',async()=>{
  const f=fixture();f.state.collections.unsettled={...f.state.collections[f.source],signature:'unsettled'};
  const result=await createDailyBonusEvidenceIndex(f.options)(f.args);
  assert.equal(result.complete,true);assert.equal(result.collections.length,1);
  assert(result.collections[0].blockTime<start);assert.equal(result.collections[0].settlementBlockTime,start+10);
  const snapshot=buildDailyBonusSnapshot({day,now,...result});
  assert.equal(snapshot.eligibilityBasis,'settlement-time-v1');assert.equal(snapshot.sources.length,1);
  assert.equal(snapshot.rankings.creators[0].wallet,creator);
  assert.equal(snapshot.rankings.referrals[0].wallet,referrer);
  assert.equal(f.rewardStore.data.dailyBonusIndexes,undefined);
  assert(f.rewardStore.data.dailyBonusSettlementIndexes[day]);
});

test('unknown finalized settlement waits for attributed proof, then resumes after a reader restart',async()=>{
  const f=fixture(),record=f.state.v3Settlements[f.source];delete f.state.v3Settlements[f.source];
  const pending=await createDailyBonusEvidenceIndex(f.options)(f.args);
  assert.equal(pending.complete,false);assert.match(pending.reason,/recorded and attributed/);
  f.state.v3Settlements[f.source]=record;
  assert.equal((await createDailyBonusEvidenceIndex(f.options)(f.args)).complete,true);
  f.state.collections[f.source].claimId='a'.repeat(64);
  await assert.rejects(createDailyBonusEvidenceIndex(f.options)(f.args),/conflicts/);
});

test('settlement finality, exact time and source chronology are required even when ledger metadata says finalized',async()=>{
  const f=fixture();f.proof.blockTime++;
  await assert.rejects(createDailyBonusEvidenceIndex(f.options)(f.args),/settlement-time bonus proof/);
  f.proof.blockTime--;
  const original=f.connection.getTransaction;
  f.connection.getTransaction=async id=>{const tx=await original(id);return id===f.source?{...tx,slot:501}:tx;};
  await assert.rejects(createDailyBonusEvidenceIndex(f.options)(f.args),/chronology/);
});

test('new eligibility rejects missing settlement time without changing legacy snapshot hashes',()=>{
  const fee={signature:'collection',settlementSignature:'settlement',mint,creator,blockTime:start+1,finalized:true,
    amountLamports:'1000000',communityLamports:'40000',dailyBonusVersion:1};
  const input={day,now,collections:[fee],trades:[],coverage:[{mint,complete:true}]};
  const legacy=buildDailyBonusSnapshot(input);
  assert.equal(legacy.eligibilityBasis,undefined);
  assert.deepEqual(buildDailyBonusSnapshot({day,now,...legacy.evidence}),legacy);
  assert.throws(()=>buildDailyBonusSnapshot({...input,eligibilityBasis:'settlement-time-v1'}),/finalized UTC day/);
  const next=buildDailyBonusSnapshot({...input,collections:[{...fee,blockTime:start-1,settlementBlockTime:start+1}],eligibilityBasis:'settlement-time-v1'});
  assert.notEqual(next.hash,legacy.hash);
  assert.equal(next.policy.metrics.creators,'settled-creator-fee-lamports');
});

test('settlement windows include the exact start and place the exact end only in the following window',()=>{
  const fee={signature:'collection',settlementSignature:'settlement',mint,creator,blockTime:start-86400,
    finalized:true,amountLamports:'1000',communityLamports:'40',dailyBonusVersion:1};
  const input={day,now,eligibilityBasis:'settlement-time-v1',trades:[],coverage:[{mint,complete:true}]};
  assert.equal(buildDailyBonusSnapshot({...input,collections:[{...fee,settlementBlockTime:start}]}).sources.length,1);
  assert.throws(()=>buildDailyBonusSnapshot({...input,collections:[{...fee,settlementBlockTime:now}]}),/finalized UTC day/);
  const next=buildDailyBonusSnapshot({...input,day:'2026-10-19',now:now+86400,collections:[{...fee,settlementBlockTime:now}]});
  assert.equal(next.sources.length,1);assert.equal(next.start,now);
});

test('settlement index resumes paginated checkpoints in the actual reward ledger after reader restarts',async t=>{
  const file=join(tmpdir(),'funded-fqa002-'+randomUUID()+'.json');
  t.after(async()=>{await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});});
  const f=fixture(),store=createAutomaticRewardStore(file),lookup=f.connection.getSignaturesForAddress;
  f.connection.getSignaturesForAddress=async(address,options)=>options?.before?[]:lookup(address);
  let result;
  for(let tick=0;tick<8;tick++){
    result=await createDailyBonusEvidenceIndex({...f.options,rewardStore:store,
      pageSize:1,pagesPerTick:1,transactionsPerTick:2})(f.args);
    if(result.complete)break;
  }
  assert.equal(result.complete,true);
  assert.equal(result.collections.length,1);
  const saved=await createAutomaticRewardStore(file).read();
  assert(saved.dailyBonusSettlementIndexes[day].revision>1);
  assert.equal(saved.dailyBonusIndexes,undefined);
});

test('two settlement readers cannot overwrite one actual reward-ledger checkpoint revision',async t=>{
  const file=join(tmpdir(),'funded-fqa002-'+randomUUID()+'.json');
  t.after(async()=>{await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});});
  const f=fixture(),adapter=createAutomaticRewardStore(file);
  let firstReads=0,release;
  const bothReady=new Promise(resolve=>{release=resolve;});
  const store={
    read:async()=>{
      const snapshot=await adapter.read();
      if(++firstReads<=2){if(firstReads===2)release();await bothReady;}
      return snapshot;
    },
    transaction:fn=>adapter.transaction(fn)
  };
  const options={...f.options,rewardStore:store};
  const first=createDailyBonusEvidenceIndex(options),second=createDailyBonusEvidenceIndex(options);
  const outcomes=await Promise.allSettled([first(f.args),second(f.args)]);
  assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);
  assert.match(outcomes.find(row=>row.status==='rejected').reason.message,/changed concurrently/);
  assert.equal((await createDailyBonusEvidenceIndex({...f.options,rewardStore:adapter})(f.args)).complete,true);
});
