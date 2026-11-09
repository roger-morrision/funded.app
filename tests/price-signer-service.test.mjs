import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Keypair,ComputeBudgetProgram,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import {agencyDiscriminator} from '../agency-mint-router-v3.js';
import {decodeBuybackRequest,validateComputeInstructions,reviewBuyback} from '../server/price-signer-review.mjs';
import {PriceSignerJournal} from '../server/price-signer-journal.mjs';
import {createPriceSignerServer,validatePriceSignerConfig} from '../server/price-signer-service.mjs';
import nacl from 'tweetnacl';

const keypair=Keypair.generate(),authority=Keypair.generate(),program=Keypair.generate().publicKey.toBase58();
const entry={programId:program,authority:String(authority.publicKey),upgradeAuthority:String(authority.publicKey),
  mint:String(Keypair.generate().publicKey),pool:String(Keypair.generate().publicKey),programDataSha256:'a'.repeat(64),maxOrderLamports:'1000000',allowCurve:false};
const config={cluster:'devnet',maxDailyLamports:'2000000',programs:[entry]};
const requestData=(agency=false)=>{const b=Buffer.alloc(agency?122:64);createHash('sha256').update(`global:${agency?'buyback_agency_mint_v3':'buyback_mint_v3'}`).digest().subarray(0,8).copy(b);
  if(agency){b[40]=6;b[41]=255;}const start=agency?98:40;b.writeBigUInt64LE(10000n,start);b.writeBigUInt64LE(1n,start+8);b.writeBigUInt64LE(10000n,start+16);return b;};

test('signer permits only bounded RICH buy-and-burn encodings',()=>{
  for(const agency of [false,true])assert.equal(decodeBuybackRequest(requestData(agency)).quote,10000n);
  assert.throws(()=>decodeBuybackRequest(Buffer.alloc(64)));
  const own=requestData(true);own[40]=7;own[41]=1;assert.throws(()=>decodeBuybackRequest(own),/Own-coin/);
  const hidden=requestData(true);hidden[42]=1;assert.throws(()=>decodeBuybackRequest(hidden));
  const unsafe=requestData();unsafe.writeBigUInt64LE(20000n,56);assert.throws(()=>decodeBuybackRequest(unsafe),/bounded/);
  assert.throws(()=>decodeBuybackRequest(Buffer.concat([requestData(),Buffer.alloc(1)])));
});
test('compute validation rejects transfers, duplicate limits and excessive priority fees',()=>{
  validateComputeInstructions([ComputeBudgetProgram.setComputeUnitLimit({units:1400000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:100})]);
  assert.throws(()=>validateComputeInstructions([ComputeBudgetProgram.setComputeUnitLimit({units:1400001})]));
  const limit=ComputeBudgetProgram.setComputeUnitLimit({units:1400000});assert.throws(()=>validateComputeInstructions([limit,limit]));
  assert.throws(()=>validateComputeInstructions([limit,ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000000})]));
  assert.throws(()=>validateComputeInstructions([SystemProgram.transfer({fromPubkey:authority.publicKey,toPubkey:keypair.publicKey,lamports:1})]));
});
test('signer requires separate keys, explicit pins and bounded Devnet budgets',()=>{
  validatePriceSignerConfig(config,keypair.publicKey);
  for(const changed of [{cluster:'mainnet-beta'},{maxDailyLamports:'5000000001'},
    {programs:[{...entry,authority:String(keypair.publicKey)}]},{programs:[{...entry,programDataSha256:''}]},
    {programs:[{...entry,maxOrderLamports:'1000000001'}]}])assert.throws(()=>validatePriceSignerConfig({...config,...changed},keypair.publicKey));
});
test('review rejects caller-selected networks and authorities before RPC access',async()=>{
  const connection=new Proxy({},{get(){throw Error('Unexpected RPC access');}});
  await assert.rejects(()=>reviewBuyback({connection,config:entry,signer:keypair.publicKey,request:{cluster:'mainnet-beta',programId:program}}),/network/);
  const message=new TransactionMessage({payerKey:authority.publicKey,recentBlockhash:String(Keypair.generate().publicKey),instructions:[]}).compileToV0Message();
  await assert.rejects(()=>reviewBuyback({connection,config:entry,signer:keypair.publicKey,request:{cluster:'devnet',programId:program,
    transaction:Buffer.from(new VersionedTransaction(message).serialize()).toString('base64')}}),/authorities/);
});
test('durable reservations reject competing transactions and enforce rolling daily cap across restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'rich-price-journal-'));try{
    const path=join(dir,'journal.jsonl'),journal=new PriceSignerJournal(path);await journal.load();
    const row={messageHash:'a'.repeat(64),programId:program,vault:'vault',receipt:'receipt',blockhash:'block',quote:'10000',minimum:'1',slot:1};
    const connection={isBlockhashValid:async()=>({value:true})};
    await journal.reserve(row,{connection,maxDailyLamports:'10000'});
    const restarted=new PriceSignerJournal(path);await restarted.load();assert.equal(restarted.entries.length,1);
    await restarted.reserve(row,{connection,maxDailyLamports:'10000'});assert.equal(restarted.entries.length,1);
    await assert.rejects(()=>restarted.reserve({...row,messageHash:'b'.repeat(64)},{connection,maxDailyLamports:'20000'}),/awaiting expiry/);
    await assert.rejects(()=>restarted.reserve({...row,messageHash:'c'.repeat(64),vault:'other'},{connection,maxDailyLamports:'10000'}),/daily/);
    const written=await readFile(path,'utf8');assert(!written.includes('signature'));assert(!written.includes('secret'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('HTTP signer requires auth, refuses failed reviews and signs only after durable reservation',async()=>{
  const token='b'.repeat(64);let allow=false,reserved=false,calls=0;
  const message=new TransactionMessage({payerKey:authority.publicKey,recentBlockhash:String(Keypair.generate().publicKey),instructions:[]}).compileToV0Message();
  const transaction=new VersionedTransaction(message);
  const server=createPriceSignerServer({connection:{},config,keypair,token,
    journal:{reserve:async()=>{reserved=true;}},review:async()=>{calls++;assert(allow,'rejected');return{transaction,messageHash:'a'.repeat(64),receipt:'receipt',slot:1};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/sign`;
  try{
    const request=(auth=token)=>fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${auth}`},body:JSON.stringify({programId:program})});
    assert.equal((await request('wrong')).status,401);assert.equal(calls,0);
    assert.equal((await request()).status,409);assert.equal(reserved,false);
    allow=true;const result=await request();assert.equal(result.status,200);assert(reserved);
    const {signature}=await result.json();assert(nacl.sign.detached.verify(message.serialize(),Buffer.from(signature,'base64'),keypair.publicKey.toBytes()));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
