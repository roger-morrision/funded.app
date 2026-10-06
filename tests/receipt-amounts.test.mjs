import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPayoutReceipt,payoutReceiptLamports } from '../server/receipt-evidence.mjs';
import { cachedReceiptProof,receiptFingerprint } from '../server/receipt-history.mjs';
import { createReceiptEvidenceReader } from '../server/receipt-service.mjs';
import { createStore } from '../server/store.mjs';
const signature='3'.repeat(88),from='2'.repeat(44),to='4'.repeat(44);
const record=fields=>({cluster:'devnet',signature,status:'paid',source:'mint-router-settle-mint',from,to,claimId:'receipt-amount-fixture',...fields});
function transaction(amount=15,debit=amount+5000){return{slot:123,blockTime:1700000000,transaction:{signatures:[signature],message:{accountKeys:[from,to]}},meta:{err:null,preBalances:[100000,1000],postBalances:[100000-debit,1000+amount]}};}
function cached(row,amount=15){return{key:receiptFingerprint('payouts',row),cluster:'devnet',commitment:'finalized',proof:{signature,claimId:row.claimId,source:row.source,to,amountLamports:amount,actualReceivedLamports:amount,feeLamports:null,feePayer:from,slot:123,blockTime:1700000000}};}

test('exact decimal SOL, including numeric 15-lamport values, verifies identically live and cached',()=>{
  for(const fields of [{amountSol:1.5e-8},{amountSol:'0.000000015'},{amountSol:'0.0000000150'},{amountLamports:15},{amountLamports:'15'},{amountLamports:null,amountSol:1.5e-8}]){
    const row=record(fields),before=structuredClone(row);
    assert.equal(payoutReceiptLamports(row),15);
    assert.equal(verifyPayoutReceipt(row,transaction())?.amountLamports,15);
    assert.equal(cachedReceiptProof(cached(row),'payouts',row)?.amountLamports,15);
    assert.deepEqual(row,before,'Verification must not rewrite persisted amount fields or fingerprints.');
  }
});
test('fractional, coerced and unsafe lamport values cannot be rounded into matching receipt proofs',()=>{
  for(const amountLamports of [true,false,{},[],15.5,0,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'',' 15','015','+15','0xf','15e0','15.0000000000000001','9007199254740992','1'.repeat(100)]){
    const row=record({amountLamports,amountSol:'0.000000015'});
    assert.equal(payoutReceiptLamports(row),null,String(amountLamports));
    assert.equal(verifyPayoutReceipt(row,transaction()),null,String(amountLamports));
    assert.equal(cachedReceiptProof(cached(row),'payouts',row),null,String(amountLamports));
  }
  const boolean=record({amountLamports:true});
  assert.equal(verifyPayoutReceipt(boolean,transaction(1)),null);
  assert.equal(cachedReceiptProof(cached(boolean,1),'payouts',boolean),null);
});
test('sub-lamport decimal SOL and imprecise floats fail closed rather than being rounded',()=>{
  for(const amountSol of ['0.00000001000000000000000000001',1.5e-9,0.1+0.2,'1e-8',true,[],{},null,undefined,'',-1,'9007199.254740992']){
    const row=record({amountSol});
    assert.equal(payoutReceiptLamports(row),null,String(amountSol));
    assert.equal(verifyPayoutReceipt(row,transaction(10)),null,String(amountSol));
    assert.equal(cachedReceiptProof(cached(row,10),'payouts',row),null,String(amountSol));
  }
});
test('safe-integer boundary remains exact while recipient, sender, signature and successful-transaction requirements stay binding',()=>{
  const maximum=Number.MAX_SAFE_INTEGER;
  const large={slot:123,transaction:{signatures:[signature],message:{accountKeys:[from,to]}},meta:{err:null,preBalances:[maximum,0],postBalances:[0,maximum]}};
  for(const fields of [{amountLamports:String(maximum)},{amountSol:'9007199.254740991'}])assert.equal(verifyPayoutReceipt(record(fields),large)?.amountLamports,maximum);
  const row=record({amountSol:1.5e-8});
  assert.equal(verifyPayoutReceipt(row,transaction(15,15))?.amountLamports,15);
  assert.equal(verifyPayoutReceipt(row,transaction(15,5015))?.amountLamports,15,'Additional payer fees remain permitted.');
  for(const tx of [transaction(14),transaction(16),transaction(15,14),{...transaction(),meta:{...transaction().meta,err:{InstructionError:[0,'Custom']}}},{...transaction(),slot:0},{...transaction(),transaction:{...transaction().transaction,signatures:['6'.repeat(88)]}}])assert.equal(verifyPayoutReceipt(row,tx),null);
  for(const fields of [{to:from},{to:'5'.repeat(44)},{from:'5'.repeat(44)},{cluster:'testnet'},{status:'submitted'},{source:'untrusted'}])assert.equal(verifyPayoutReceipt({...row,...fields},transaction()),null);
});
test('cached receipt remains bound to finalized matching signature, source, recipient, amount and unchanged record fingerprint',()=>{
  const row=record({amountSol:1.5e-8}),entry=cached(row);
  for(const changed of [{amountLamports:14},{amountLamports:'15'},{amountLamports:null},{claimId:'other'},{to:'5'.repeat(44)},{source:'untrusted'},{signature:'6'.repeat(88)},{slot:0}])assert.equal(cachedReceiptProof({...entry,proof:{...entry.proof,...changed}},'payouts',row),null);
  for(const changed of [{commitment:'confirmed'},{cluster:'mainnet-beta'},{key:'different'}])assert.equal(cachedReceiptProof({...entry,...changed},'payouts',row),null);
  assert.equal(cachedReceiptProof(entry,'payouts',{...row,amountSol:'0.000000016'}),null);
});
test('finalized 15-lamport proof persists across restart while old rounded invalid proofs are not reused',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'funded-receipt-amount-'));
  try{
    const path=join(directory,'state.json'),store=createStore(path,''),row=record({amountSol:1.5e-8});
    const state={collections:{},payouts:{valid:row}};let reads=0;
    const options={store,cluster:'devnet',commitment:'finalized',officialGenesis:async()=>'devnet-fixture',connectionFactory:()=>({getGenesisHash:async()=>'devnet-fixture',getTransaction:async()=>{reads++;return transaction();}})};
    const evidence=await createReceiptEvidenceReader(options)(state);assert.equal(evidence.verifiedPayouts[0]?.amountLamports,15);assert.equal(reads,1);
    const reopened=createStore(path,'');
    const cachedEvidence=await createReceiptEvidenceReader({...options,store:reopened,connectionFactory:()=>assert.fail('A valid persisted exact proof must not reread RPC.')})(state);
    assert.equal(cachedEvidence.verifiedPayouts[0]?.amountLamports,15);assert.equal(cachedEvidence.indexedRecords,1);
    const invalid=record({amountLamports:'15.0000000000000001'});await reopened.writeReceiptProofs([cached(invalid)]);
    const unverified=await createReceiptEvidenceReader({...options,store:reopened})({collections:{},payouts:{invalid}});
    assert.equal(unverified.verifiedPayouts.length,0);assert.equal(unverified.indexedRecords,0);assert.equal(unverified.status,'unverified-records');
  }finally{await rm(directory,{recursive:true,force:true});}
});
