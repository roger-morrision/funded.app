import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Keypair,SystemProgram,Transaction,TransactionInstruction} from '@solana/web3.js';
import {createSigner,replayJournal,appendSignerJournal} from '../../server/signer-service.mjs';
import {DENIED_ROUTER_INSTRUCTIONS} from '../../server/signer-policy.mjs';

const role='treasury-operations',now=1_800_000_000_000;
function fixture(journal=()=>{},extraProgram=null) {
  const key=Keypair.generate(),admin=Keypair.generate(),program=Keypair.generate().publicKey;
  const env={FUNDED_SIGNER_TOKEN:'test-only-token-'.repeat(4),FUNDED_ADMIN_WALLETS:String(admin.publicKey),
    FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS:'100',FUNDED_ADMIN_WITHDRAW_DAILY_LAMPORTS:'150',
    FUNDED_V3_FEE_ROUTER_PROGRAM_ID:String(program),FUNDED_SIGNER_ENFORCE:'treasury',
    ...(extraProgram?{FUNDED_SIGNER_EXTRA_PROGRAMS:String(extraProgram)}:{})};
  const signer=createSigner({env,keys:new Map([[role,key],['authority',key]]),now:()=>now,journal});
  const request=(ix,payer=admin.publicKey,which=role)=>({role:which,version:'legacy',message:new Transaction({
    feePayer:payer,recentBlockhash:String(Keypair.generate().publicKey)}).add(ix).serializeMessage().toString('base64')});
  const transfer=(amount,to=admin.publicKey)=>request(SystemProgram.transfer({fromPubkey:key.publicKey,toPubkey:to,lamports:amount}));
  return {key,admin,program,env,signer,request,transfer};
}
test('treasury enforces recipient, fee payer, per-transaction and concurrent daily limits',async()=>{
  const f=fixture();
  assert.equal((await f.signer.sign(f.transfer(101))).status,403);
  assert.equal((await f.signer.sign(f.transfer(1,Keypair.generate().publicKey))).status,403);
  const wrongPayer=f.request(SystemProgram.transfer({fromPubkey:f.key.publicKey,toPubkey:f.admin.publicKey,lamports:1}),f.key.publicKey);
  assert.equal((await f.signer.sign(wrongPayer)).status,403);
  const results=await Promise.all([f.signer.sign(f.transfer(100)),f.signer.sign(f.transfer(100))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,403]);
  assert.equal(f.signer.usage.get(role).lamports(now),100n);
});
test('hot signer cannot execute any router administrative instruction in observe mode',async()=>{
  const f=fixture();
  for(const name of DENIED_ROUTER_INSTRUCTIONS){
    const ix=new TransactionInstruction({programId:f.program,keys:[{pubkey:f.key.publicKey,isSigner:true,isWritable:true}],
      data:createHash('sha256').update(`global:${name}`).digest().subarray(0,8)});
    const result=await f.signer.sign(f.request(ix,f.key.publicKey,'authority'));
    assert.equal(result.status,403,name);
    assert.match(result.body.error,/router-/);
  }
});
test('an extra allowlisted router cannot use the hot signer for administration',async()=>{
  const extra=Keypair.generate().publicKey,f=fixture(()=>{},extra);
  for(const name of DENIED_ROUTER_INSTRUCTIONS){
    const ix=new TransactionInstruction({programId:extra,keys:[{pubkey:f.key.publicKey,isSigner:true,isWritable:true}],
      data:createHash('sha256').update(`global:${name}`).digest().subarray(0,8)});
    const result=await f.signer.sign(f.request(ix,f.key.publicKey,'authority'));
    assert.equal(result.status,403,name);
    assert.match(result.body.error,/router-/);
  }
  const ordinary=new TransactionInstruction({programId:extra,keys:[{pubkey:f.key.publicKey,isSigner:true,isWritable:true}],
    data:createHash('sha256').update('global:claim_community_airdrop').digest().subarray(0,8)});
  assert.equal((await f.signer.sign(f.request(ordinary,f.key.publicKey,'authority'))).status,200);
});
test('journal failure latches signing closed and makes health fail',async()=>{
  const f=fixture(()=>{throw Error('disk unavailable');});
  await assert.rejects(f.signer.sign(f.transfer(50)),/journal write failed/);
  assert.equal((await f.signer.sign(f.transfer(50))).status,503);
  let status,body;
  await f.signer.handle({method:'GET',url:'/health',headers:{}},{writeHead:s=>{status=s;},end:s=>{body=JSON.parse(s);}});
  assert.equal(status,503);assert.equal(body.ok,false);
  assert.equal(f.signer.usage.get(role).lamports(now),0n);
});
test('durable journal restores budget; corrupt tails restore nothing',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'funded-signer-security-')),path=join(dir,'journal.jsonl');
  try{
    const f=fixture(row=>appendSignerJournal(path,row));
    assert.equal((await f.signer.sign(f.transfer(100))).status,200);
    const restarted=createSigner({env:f.env,keys:new Map([[role,f.key]]),now:()=>now});
    replayJournal(path,restarted);
    assert.equal((await restarted.sign(f.transfer(60))).status,403);
    writeFileSync(path,'{"decision":"signed"}\n');
    const clean=fixture();
    assert.throws(()=>replayJournal(path,clean.signer),/corrupt/);
    assert.equal(clean.signer.usage.get(role).lamports(now),0n);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
