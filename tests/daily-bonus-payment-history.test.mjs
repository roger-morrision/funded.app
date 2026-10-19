import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { buildDailyBonusSnapshot, dailyBonusManifest } from '../server/daily-bonus.mjs';
import {appendDailyBonusResidual} from '../server/daily-bonus-reconciliation.mjs';
import { rewardAddresses, rewardReserveAddress, DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { createPaymentHistoryReader } from '../server/payment-history.mjs';
import { v3PublicMetrics } from '../server/v3-public-metrics.mjs';
import { dailyPaymentCandidates, dailyPaymentHistory } from '../server/daily-bonus-payment-history.mjs';

const keys=Array.from({length:7},(_,i)=>Keypair.fromSeed(Buffer.alloc(32,i+120)));
const [program,authority,mint,creator,recipient]=keys.map(k=>k.publicKey.toBase58());
const signature=n=>bs58.encode(Buffer.alloc(64,n));
const start=Date.parse('2026-10-17')/1000;
const discriminator=(space,name)=>createHash('sha256').update(`${space}:${name}`).digest().subarray(0,8);
function fixture({recovered=false,self=false,qa=false,cohort=false,settlementTime=false}={}) {
  const wallet=self ? authority : recipient;
  const collection=signature(1), settlement=signature(2), funding=signature(3), paid=signature(4);
  const snapshot=buildDailyBonusSnapshot({day:qa ? `qa5m:2026-10-17T00:00:00Z${cohort ? '@abcdef012345' : ''}` : '2026-10-17',now:start+86400,
    eligibilityBasis:settlementTime?'settlement-time-v1':'collection-time-v1',
    coverage:[{mint,complete:true}],collections:[{signature:collection,settlementSignature:settlement,
      mint,creator:wallet,referrer:null,blockTime:settlementTime?start-300:start+1,settlementBlockTime:start+1,finalized:true,amountLamports:'1000000000',
      communityLamports:'40000000',dailyBonusVersion:1}],trades:[]});
  const source=snapshot.sources[0], manifest=dailyBonusManifest(snapshot,source), leaf=manifest.leaves[0];
  const addresses=rewardAddresses({programId:program,authority,mint,cycleId:manifest.cycleId,recipient:wallet});
  const reserve=rewardReserveAddress({programId:program,vault:addresses.vault,asset:'SOL'});
  const vault=Buffer.alloc(73);discriminator('account','RewardVault').copy(vault);
  keys[1].publicKey.toBuffer().copy(vault,8);keys[2].publicKey.toBuffer().copy(vault,40);
  const cycle=Buffer.alloc(174);discriminator('account','RewardCycle').copy(cycle);
  addresses.vault.toBuffer().copy(cycle,8);Buffer.from(manifest.cycleId,'hex').copy(cycle,40);
  Buffer.from(manifest.root,'hex').copy(cycle,72);cycle.writeBigUInt64LE(BigInt(manifest.totalAmount),136);
  cycle.writeBigUInt64LE(BigInt(leaf.amount),144);cycle.writeBigInt64LE(BigInt(snapshot.end),152);
  cycle.writeBigInt64LE(BigInt(snapshot.end),160);cycle.writeUInt32LE(manifest.leaves.length,168);cycle[173]=1;
  const receipt=Buffer.alloc(100);discriminator('account','RewardPayment').copy(receipt);
  addresses.cycle.toBuffer().copy(receipt,8);new PublicKey(wallet).toBuffer().copy(receipt,40);
  receipt.writeBigUInt64LE(BigInt(leaf.amount),72);receipt.writeUInt32LE(leaf.index,80);
  receipt.writeBigInt64LE(BigInt(snapshot.end+10),84);receipt.writeBigUInt64LE(BigInt(leaf.amount),92);
  const accounts=new Map([[addresses.vault.toBase58(),{data:vault,owner:keys[0].publicKey}],
    [addresses.cycle.toBase58(),{data:cycle,owner:keys[0].publicKey}],
    [addresses.payment.toBase58(),{data:receipt,owner:keys[0].publicKey}]]);
  const data=Buffer.alloc(24);discriminator('global','payout_reward_sol').copy(data);
  data.writeBigUInt64LE(BigInt(leaf.amount),8);data.writeUInt32LE(leaf.index,16);data.writeUInt32LE(leaf.proof.length,20);
  const instruction=new TransactionInstruction({programId:keys[0].publicKey,
    keys:[keys[1].publicKey,addresses.vault,reserve,addresses.cycle,new PublicKey(wallet),addresses.payment,SystemProgram.programId]
      .map((pubkey,index)=>({pubkey,isSigner:index===0,isWritable:index<6})),
    data:Buffer.concat([data,...leaf.proof.map(hex=>Buffer.from(hex,'hex'))])});
  const message=new Transaction({feePayer:keys[1].publicKey,recentBlockhash:mint}).add(instruction).compileMessage();
  const pre=message.accountKeys.map(()=>1000000000),post=[...pre];
  const index=key=>message.accountKeys.findIndex(row=>row.toBase58()===String(key));
  const rent=1000000, fee=5000;
  pre[index(addresses.payment)]=0;post[index(addresses.payment)]=rent;
  post[0]-=fee+rent;post[index(addresses.vault)]-=Number(leaf.amount);post[index(wallet)]+=Number(leaf.amount);
  const tx={slot:100,blockTime:snapshot.end+10,meta:{err:null,preBalances:pre,postBalances:post,fee},transaction:{signatures:[paid],message}};
  const app={launches:{[mint]:{mint,creatorWallet:creator,cluster:'devnet',onchainVerified:true,
    pumpFeeRoute:{scope:'per-mint-v3',programId:program},feeDistribution:{fixedFunded:{communityRewards:{dailyBonus:{version:1}}}}}},
    collections:{[collection]:{signature:collection,mint,cluster:'devnet',scope:'per-mint-v3',programId:program,status:'collected',onchainVerified:true}},
    v3Settlements:{[collection]:{collectionSignature:collection,mint,status:'finalized',settlementSignature:settlement}},
    v3CommunityFunding:{[collection]:{status:'finalized',balanceDeltaVerified:true,mint,amount:source.amountLamports,recipient:addresses.vault.toBase58(),signature:funding}}};
  const ledger={dailyBonusSnapshots:{[snapshot.day]:{snapshot,status:'snapshotted',payouts:{[collection]:{
    manifest,status:'paid',cycle:addresses.cycle.toBase58(),fundingSignature:funding,payments:{[wallet]:{
      signature:recovered?null:paid,payment:addresses.payment.toBase58(),finalized:true,balanceDeltaVerified:true,amount:leaf.amount,amountReceived:leaf.amount}}}}}}};
  const reads={transactions:0,accounts:0,history:0};
  const connection={getGenesisHash:async()=>DEVNET_GENESIS_HASH,
    getAccountInfo:async key=>{reads.accounts++;return accounts.get(key.toBase58());},
    getTransaction:async()=>{reads.transactions++;return tx;},
    getSignaturesForAddress:async()=>{reads.history++;return[{signature:paid,confirmationStatus:'finalized',err:null}];}};
  const read=()=>createPaymentHistoryReader({readEvidence:async()=>({}),rewardsStore:{read:async()=>ledger},store:{read:async()=>app},
    connectionFactory:()=>connection,officialGenesis:async()=>DEVNET_GENESIS_HASH,cluster:'devnet',v3Only:true})();
  return {read,ledger,app,tx,accounts,addresses,cycle,receipt,reads,connection,leaf,paid,wallet,rent,fee};
}

for(const cohort of [false,true])test(`five-minute QA manifests retain independent finalized payment verification (cohort=${cohort})`,async()=>{
  const f=fixture({qa:true,cohort}),history=await f.read();
  assert.equal(history.verifiedPayouts.length,1);
  assert.equal(history.verifiedPayouts[0].day,`qa5m:2026-10-17T00:00:00Z${cohort ? '@abcdef012345' : ''}`);
  assert.equal(history.verifiedPayouts[0].actualReceivedLamports,Number(f.leaf.amount));
});

for(const qa of [false,true])test(`settlement-time payments remain verifiable when collection preceded the window (QA=${qa})`,async()=>{
  const f=fixture({qa,cohort:qa,settlementTime:true}),history=await f.read();
  assert.equal(history.verifiedPayouts.length,1);
  assert.equal(dailyPaymentCandidates(f.ledger).unavailable,0);
});

test('audited additive funding preserves independently verified old payment receipts; missing archives are rejected',async()=>{
  const f=fixture({settlementTime:true}),saved=Object.values(f.ledger.dailyBonusSnapshots)[0],prior=saved.snapshot;
  const evidence=structuredClone(prior.evidence);
  evidence.collections.push({...evidence.collections[0],signature:signature(8),creator:creator,amountLamports:'2000000000'});
  const next=buildDailyBonusSnapshot({day:prior.day,...evidence,eligibilityBasis:prior.eligibilityBasis,now:prior.end});
  saved.revisions=[{snapshot:prior}];saved.snapshot=appendDailyBonusResidual(prior,next);
  assert.equal((await f.read()).verifiedPayouts.length,1);
  assert.equal(dailyPaymentCandidates(f.ledger).unavailable,0);
  saved.revisions=[];
  assert.equal(dailyPaymentCandidates(f.ledger).candidates.length,0);
  assert.equal(dailyPaymentCandidates(f.ledger).unavailable,1);
});
test('daily receipts enter global history and Analytics once, with explicit daily totals',async()=>{
  const f=fixture(), history=await f.read();
  assert.equal(history.status,'onchain-indexed');assert.equal(history.checkedDaily,1);
  assert.equal(history.verifiedPayouts.length,1);assert.equal(history.verifiedPayouts[0].source,'daily-bonus');
  assert.equal(history.verifiedPayouts[0].actualReceivedLamports,Number(f.leaf.amount));
  const metrics=v3PublicMetrics(f.app,{},history,{},'devnet');
  assert.equal(metrics.finalizedPaidLamports,Number(f.leaf.amount));assert.equal(metrics.recordedPayouts,1);
  assert.equal(metrics.dailyBonusPayoutCount,1);assert.equal(metrics.dailyBonusPaidLamports,Number(f.leaf.amount));
  assert.equal(metrics.feePayoutStats.creator.paidLamports,'0','Daily creator awards must not be counted as creator fees');
});

test('Clock timestamps and estimated RPC block times may differ for the same proven payment',async()=>{
  for(const drift of [-1,1]){
    const f=fixture(),clock=Number(f.receipt.readBigInt64LE(84));
    f.tx.blockTime=clock+drift;
    const history=await f.read();
    assert.equal(history.verifiedPayouts.length,1);
    assert.equal(history.verifiedPayouts[0].actualReceivedLamports,Number(f.leaf.amount));
    assert.equal(history.verifiedPayouts[0].paidAt,clock);
    assert.equal(history.verifiedPayouts[0].blockTime,clock+drift);
  }
});

test('payment cutoff uses program Clock and still rejects an early receipt despite a later RPC estimate',async()=>{
  const f=fixture();f.receipt.writeBigInt64LE(BigInt(start+86400-1),84);
  const history=await f.read();
  assert.equal(history.verifiedPayouts.length,0);assert.equal(history.unavailablePayouts,1);
  const edge=fixture();edge.receipt.writeBigInt64LE(BigInt(start+86400),84);edge.tx.blockTime=start+86400-1;
  assert.equal((await edge.read()).verifiedPayouts.length,1);
});
test('recovered payment accounts discover their finalized transaction and aliases are deduplicated',async()=>{
  const f=fixture({recovered:true});
  f.ledger.dailyBonusSnapshots.alias=structuredClone(f.ledger.dailyBonusSnapshots['2026-10-17']);
  const history=await f.read();assert.equal(history.verifiedPayouts.length,1);
  assert.equal(history.verifiedPayouts[0].signature,f.paid);assert.equal(f.reads.history,2);
  assert.equal(history.dailyBonusSummary.payoutCount,1);assert.equal(history.dailyBonusSummary.status,'verified');
});
test('self-paid daily awards show the exact net receipt after fees and payment-account rent',async()=>{
  const f=fixture({self:true}), history=await f.read();
  assert.equal(history.verifiedPayouts.length,1);
  assert.equal(history.verifiedPayouts[0].actualReceivedLamports,Number(f.leaf.amount)-f.fee-f.rent);
  assert.equal(history.verifiedPayouts[0].recipientRentLamports,f.rent);
});

test('a self-paid bonus with costs exceeding its award remains a verified net debit',async()=>{
  const f=fixture({self:true});
  const keys=f.tx.transaction.message.accountKeys;
  const index=keys.findIndex(key=>key.equals(f.addresses.payment));
  const extra=Number(f.leaf.amount);
  f.tx.meta.postBalances[index]+=extra;f.tx.meta.postBalances[0]-=extra;
  const history=await f.read();assert.equal(history.verifiedPayouts.length,1);
  assert.equal(history.verifiedPayouts[0].actualReceivedLamports,-f.fee-f.rent);
  assert.equal(history.verifiedPayouts[0].recipientRentLamports,f.rent+extra);
});
test('versioned transactions with typed account indexes and loaded addresses remain verifiable',async()=>{
  const f=fixture(), original=f.tx.transaction.message;
  f.tx.transaction.message={header:original.header,staticAccountKeys:original.accountKeys.slice(0,-2),
    compiledInstructions:original.instructions.map(ix=>({programIdIndex:ix.programIdIndex,
      accountKeyIndexes:Uint8Array.from(ix.accounts),data:bs58.decode(ix.data)}))};
  f.tx.meta.loadedAddresses={writable:[],readonly:original.accountKeys.slice(-2)};
  const history=await f.read();assert.equal(history.status,'onchain-indexed');assert.equal(history.verifiedPayouts.length,1);
});
test('verified immutable proofs are reused, while changed funding invalidates the cached proof',async()=>{
  const f=fixture(), proofCache=new Map(), selection=dailyPaymentCandidates(f.ledger);
  const input={connection:f.connection,state:f.app,selection,proofCache};
  assert.equal((await dailyPaymentHistory(input)).rows.length,1);
  const count={...f.reads};
  assert.equal((await dailyPaymentHistory(input)).rows.length,1);assert.deepEqual(f.reads,count);
  Object.values(f.app.v3CommunityFunding)[0].recipient=creator;
  const changed=await dailyPaymentHistory(input);assert.equal(changed.rows.length,0);assert.equal(changed.unavailable,1);
});
test('forged flags, missing accounts, wrong program, instruction, funding, balance or finality never become paid totals',async()=>{
  const cases=[f=>{f.receipt[0]^=1;}, f=>{f.cycle[72]^=1;}, f=>{f.accounts.get(f.addresses.payment.toBase58()).owner=keys[3].publicKey;},
    f=>{f.accounts.delete(f.addresses.cycle.toBase58());}, f=>{f.tx.meta.postBalances[1]++;},
    f=>{f.tx.transaction.message.instructions[0].data=bs58.encode(Buffer.alloc(24));},
    f=>{Object.values(f.app.v3CommunityFunding)[0].amount='1';}, f=>{f.tx.meta.err={error:'failed'};},
    f=>{f.connection.getGenesisHash=async()=> 'wrong-genesis';},f=>{f.ledger.dailyBonusSnapshots['2026-10-17'].snapshot.sources[0].allocations[0].amount='1';}];
  for (const mutate of cases) {
    const f=fixture();mutate(f);const history=await f.read();
    assert.equal(history.status,'partial');assert.equal(history.checkedDaily,1);
    assert.deepEqual(history.verifiedPayouts,[]);assert.equal(history.dailyBonusSummary.paidLamports,'0');
    assert.equal(history.unavailablePayouts,1);
  }
});
