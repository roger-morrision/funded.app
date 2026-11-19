import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Keypair} from '@solana/web3.js';
import {PriceSignerJournal} from '../server/price-signer-journal.mjs';
import {unusedPriceReservation} from '../server/price-signer-reconciliation.mjs';

const row={messageHash:'a'.repeat(64),programId:String(Keypair.generate().publicKey),vault:'vault',
  receipt:String(Keypair.generate().publicKey),blockhash:'block',quote:'10000',minimum:'1',slot:10};
function rpc({live=false,landed=false,fail=false,stale=false}={}){
  return {isBlockhashValid:async(_hash,options)=>{
    if(fail)throw Error('RPC unavailable');
    if(options.commitment==='finalized')assert.equal(options.minContextSlot,20);
    return {value:live,context:{slot:options.commitment==='finalized'?21:20}};
  },getAccountInfoAndContext:async(key,options)=>{
    assert.equal(String(key),row.receipt);assert.deepEqual(options,{commitment:'finalized',minContextSlot:21});
    return {value:landed?{owner:row.programId}:null,context:{slot:stale?19:22}};
  }};
}
async function fixture(fn){
  const dir=await mkdtemp(join(tmpdir(),'funded-reservation-test-'));
  try{const path=join(dir,'journal.jsonl'),journal=new PriceSignerJournal(path);await journal.load();await fn(journal,path);}
  finally{await rm(dir,{recursive:true,force:true});}
}
test('expired unused reservation is durably released and a retry fits the unchanged cap after restart',async()=>fixture(async(journal,path)=>{
  const connection=rpc();await journal.reserve(row,{connection,maxDailyLamports:'10000',now:1000});
  await journal.reserve({...row,messageHash:'b'.repeat(64)},{connection,maxDailyLamports:'10000',now:2000});
  assert.equal(journal.entries.filter(r=>r.type==='release').length,1);
  const restarted=new PriceSignerJournal(path);await restarted.load();
  assert.equal(restarted.entries.length,3);
  await assert.rejects(restarted.reserve(row,{connection,maxDailyLamports:'10000',now:3000}),/cannot be reused/);
  await restarted.reserve({...row,messageHash:'b'.repeat(64)},{connection,maxDailyLamports:'10000',now:3000});
  assert.equal(restarted.entries.length,3);
  assert(!String(await readFile(path)).includes('secret'));
}));
test('live, landed, unavailable and stale evidence cannot free daily budget',async()=>{
  for(const options of [{live:true},{landed:true},{fail:true},{stale:true}])await fixture(async journal=>{
    await journal.reserve(row,{connection:rpc(),maxDailyLamports:'10000',now:1000});
    await assert.rejects(journal.reserve({...row,messageHash:'b'.repeat(64),vault:'other'},
      {connection:rpc(options),maxDailyLamports:'10000',now:2000}),/daily/);
    assert.equal(journal.entries.length,1);
  });
});
test('missing or regressing expiry contexts never release a reservation',async()=>{
  for(const result of [{value:false},{value:false,context:{slot:9}},{value:null,context:{slot:20}}]){
    assert.equal(await unusedPriceReservation({isBlockhashValid:async()=>result},row),null);
  }
  const connection=rpc();connection.isBlockhashValid=async(_hash,options)=>({value:false,context:{slot:options.commitment==='finalized'?19:20}});
  assert.equal(await unusedPriceReservation(connection,row),null);
});
test('release persistence failure prevents replacement signing reservation',async()=>fixture(async journal=>{
  await journal.reserve(row,{connection:rpc(),maxDailyLamports:'10000',now:1000});
  journal.append=async()=>{throw Error('disk unavailable');};
  await assert.rejects(journal.reserve({...row,messageHash:'b'.repeat(64)},{connection:rpc(),maxDailyLamports:'10000',now:2000}),/disk unavailable/);
  assert.equal(journal.entries.length,1);
}));
test('journal rejects forged release rows without matching reservation evidence',async()=>fixture(async(journal,path)=>{
  await appendFile(path,JSON.stringify({type:'release',messageHash:row.messageHash,at:1,expirySlot:20,receiptSlot:21})+'\n');
  await assert.rejects(new PriceSignerJournal(path).load(),/Invalid signer release/);
}));
