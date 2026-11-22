import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {PublicKey,Transaction,Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';
import {expireUnpayableCycles} from '../../server/reward-cycle-expiry.mjs';
import {expiryExecutionFixture,expiryExecutionStore} from './reward-expiry-execution-fixture.mjs';
import {rewardExpiryFixture} from './reward-expiry-fixture.mjs';
import {readRewardExpiryContext} from '../../server/reward-expiry-context.mjs';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {expiryDigest,expiryObjectHash,expiryPlanHash,expirySnapshot,finalizedExpiryAttempt} from '../../server/reward-expiry-attempt.mjs';
import {finalizedSend} from '../../server/automatic-reward-chain.mjs';

async function setup(t){const f=expiryExecutionFixture(),stored=await expiryExecutionStore(t,f);return {f,...stored};}
const attempt=async(store,f)=>(await store.read()).schedules[f.plan.id].expiryAttempt;

test('expiry signed message is durable before broadcast and exact proof survives restart without another send',async t=>{
  const {f,store,path}=await setup(t);
  f.beforeSend=async wire=>{const saved=JSON.parse(await readFile(path,'utf8')).schedules[f.plan.id].expiryAttempt;
    assert.equal(saved.state,'prepared');assert.equal(saved.transactionBase64,Buffer.from(wire).toString('base64'));};
  const result=await f.chain().expireCycle(f.plan,{store});assert.equal(result.expiryTransactionVerified,true);assert.equal(result.unpaidAmount,'200');
  assert.equal((await attempt(store,f)).state,'verified');const calls=f.latestCalls;
  const recovered=await f.chain().expireCycle(f.plan,{store:createAutomaticRewardStore(path)});
  assert.deepEqual(recovered,result);assert.equal(f.submitted,1);assert.equal(f.latestCalls,calls);
});

test('landed timeout remains pending until its exact finalized transaction is available',async t=>{
  const {f,store,path}=await setup(t);f.transportFailure=true;f.proofAvailable=false;
  const pending=await f.chain().expireCycle(f.plan,{store});assert.equal(pending.expired,false);assert.equal(f.rows.get(String(f.cycle)).data[173],0);
  const retry=await f.chain().expireCycle(f.plan,{store:createAutomaticRewardStore(path)});assert.equal(retry.status,'expiry-reconciliation-pending');assert.equal(f.submitted,1);
  f.proofAvailable=true;assert.equal((await f.chain().expireCycle(f.plan,{store})).expiryTransactionVerified,true);assert.equal(f.submitted,1);
});

test('unknown unlanded attempts block fresh signatures until the original transaction can reconcile',async t=>{
  const {f,store,path}=await setup(t);f.autoLand=false;f.transportFailure=true;
  assert.equal((await f.chain().expireCycle(f.plan,{store})).status,'expiry-reconciliation-pending');
  const saved=await readFile(path,'utf8'),calls=f.latestCalls;
  for(let n=0;n<2;n++)assert.equal((await f.chain().expireCycle(f.plan,{store:createAutomaticRewardStore(path)})).expired,false);
  assert.equal(f.latestCalls,calls);assert.equal(f.submitted,1);assert.equal(await readFile(path,'utf8'),saved);
  f.land();assert.equal((await f.chain().expireCycle(f.plan,{store})).unpaidAmount,'200');assert.equal(f.submitted,1);
});

test('repeated unknown recovery never obtains a refreshed blockhash or broadcasts another attempt',async t=>{
  const {f,store}=await setup(t);f.autoLand=false;f.transportFailure=true;
  f.connection.getLatestBlockhash=async()=>{f.latestCalls++;return {blockhash:String(new PublicKey(new Uint8Array(32).fill(90+f.latestCalls))),lastValidBlockHeight:999};};
  for(let n=0;n<2;n++){
    try{await f.chain().expireCycle(f.plan,{store});}catch(error){assert.match(error.message,/reconcile before retrying/);}
  }
  assert.equal(f.latestCalls,1);assert.equal(f.submitted,1);assert.equal((await attempt(store,f)).state,'prepared');
});

test('inactive state without a saved attributed attempt cannot report expiry completion',async t=>{
  const {f,store}=await setup(t);f.expire();const result=await f.chain().expireCycle(f.plan,{store});
  assert.equal(result.expired,false);assert.equal(result.status,'inactive-cycle-without-attributed-expiry');assert.equal(f.submitted,0);assert.equal(f.latestCalls,0);
});

test('durable write failure cannot broadcast or silently create an expiry attempt',async t=>{
  const {f,store,path}=await setup(t),before=await readFile(path,'utf8');
  const failing={read:()=>store.read(),transaction:()=>Promise.reject(Error('disk write/fsync failed'))};
  await assert.rejects(f.chain().expireCycle(f.plan,{store:failing}),/disk write/);assert.equal(f.submitted,0);assert.equal(await readFile(path,'utf8'),before);
});

test('changed finalized message, signature, fee or balance evidence cannot attribute an inactive cycle',async t=>{
  for(const mutate of [f=>{f.expiryTransaction.transaction.signatures[0]='wrong';},f=>{f.expiryTransaction.meta.fee++;},
    f=>{f.expiryTransaction.meta.postBalances[1]++;},f=>{f.expiryTransaction.meta.innerInstructions=[{index:0,instructions:[{}]}];},
    f=>{f.expiryTransaction.transaction.message.recentBlockhash=String(PublicKey.default);}]){
    const {f,store,path}=await setup(t);f.proofAvailable=false;await f.chain().expireCycle(f.plan,{store});const saved=await readFile(path,'utf8');
    mutate(f);f.proofAvailable=true;assert.equal((await f.chain().expireCycle(f.plan,{store})).expired,false);
    assert.equal(f.submitted,1);assert.equal(await readFile(path,'utf8'),saved);
  }
});

test('failed or status-only finalized attempts remain unresolved without new broadcasts',async t=>{
  for(const missing of ['transaction','status','failed']){
    const {f,store}=await setup(t);f.proofAvailable=false;await f.chain().expireCycle(f.plan,{store});
    if(missing==='status'){f.proofAvailable=true;f.statusAvailable=false;}
    if(missing==='failed'){f.proofAvailable=true;f.expiryTransaction.meta.err={InstructionError:[0,'Custom']};}
    assert.equal((await f.chain().expireCycle(f.plan,{store})).expired,false);assert.equal(f.submitted,1);assert.equal(f.latestCalls,1);
  }
});

test('wrong genesis, later deployment and stale finalized program reads cannot complete an attempt',async t=>{
  for(const mutate of [f=>{f.connection.getGenesisHash=async()=> 'wrong-network';},
    f=>{f.programData.data.writeBigUInt64LE(BigInt(f.slot+1),4);},f=>{f.programDataContextSlot=f.slot-1;}]){
    const {f,store}=await setup(t);f.proofAvailable=false;await f.chain().expireCycle(f.plan,{store});mutate(f);f.proofAvailable=true;
    assert.equal((await f.chain().expireCycle(f.plan,{store})).expired,false);assert.equal(f.submitted,1);
  }
});

test('changed unpaid release or custody after a successful-looking status stays pending',async t=>{
  for(const mutate of [f=>{f.rows.get(String(f.reserve)).data.writeBigUInt64LE(40n,72);},f=>{f.rows.get(String(f.vault)).lamports++;},
    f=>{f.rows.get(String(f.cycle)).data.writeBigUInt64LE(101n,144);}]){
    const {f,store}=await setup(t);f.proofAvailable=false;await f.chain().expireCycle(f.plan,{store});mutate(f);f.proofAvailable=true;
    assert.equal((await f.chain().expireCycle(f.plan,{store})).expired,false);assert.equal(f.submitted,1);
  }
});

test('corrupt saved signatures, foreign plan and altered verified facts cannot authorize new attempts',async t=>{
  for(const mutate of [r=>{r.expiryAttempt.transactionBase64='AA==';},r=>{r.manifest.root='00'.repeat(32);},
    r=>{r.expiryAttempt.proof.unpaidAmount='201';}]){
    const {f,store,path}=await setup(t);await f.chain().expireCycle(f.plan,{store});
    const state=JSON.parse(await readFile(path,'utf8'));mutate(state.schedules[f.plan.id]);await writeFile(path,JSON.stringify(state));const before=await readFile(path,'utf8');
    await assert.rejects(f.chain().expireCycle(f.plan,{store}));assert.equal(f.submitted,1);assert.equal(await readFile(path,'utf8'),before);
  }
});

test('two locked schedule stores cannot race into a second expiry broadcast',async t=>{
  const {f,store,path}=await setup(t),other=createAutomaticRewardStore(path);
  const results=await Promise.all([f.chain().expireCycle(f.plan,{store}),f.chain().expireCycle(f.plan,{store:other})]);
  assert.equal(f.submitted,1);assert.ok(results.every(r=>r.expiryTransactionVerified===true||r.expired===false));
  assert.equal((await attempt(store,f)).signature,f.signature);
});

test('expiry preparation protects the operator reserve including the complete quoted fee',async t=>{
  for(const short of [0,1]){
    const {f,store}=await setup(t);f.connection.getFeeForMessage=async()=>({value:5000});f.connection.getBalance=async()=>3000005000-short;
    if(short){await assert.rejects(f.chain().expireCycle(f.plan,{store}),/reserve/);assert.equal(f.submitted,0);assert.equal(await attempt(store,f),undefined);}
    else assert.equal((await f.chain().expireCycle(f.plan,{store})).expiryTransactionVerified,true);
  }
});

test('expiry scheduler refuses unattributed inactive flags but records an attributed exact release',async t=>{
  const {f,store}=await setup(t);await store.transaction(state=>Object.assign(state.schedules[f.plan.id],{status:'blocked',reason:'protocol-owned vault or PumpSwap liquidity pool'}));
  const fake={cycleExpiryGraceSeconds:600,expireCycle:async()=>({expired:true,alreadyExpired:true})};
  assert.equal(await expireUnpayableCycles({store,chain:fake,now:f.time}),0);assert.equal((await store.read()).schedules[f.plan.id].status,'blocked');
  assert.equal(await expireUnpayableCycles({store,chain:f.chain(),now:f.time}),1);
  const row=(await store.read()).schedules[f.plan.id];assert.equal(row.status,'expired');assert.equal(row.expiredUnpaidAmount,'200');
  assert.equal(row.expiryVault,String(f.vault));assert.equal(row.expiryOriginalAuthority,String(f.original));assert.equal(row.expiryAttempt.state,'verified');
});

test('paused Mainnet context permits read-only recovery while fresh expiry construction remains forbidden',async()=>{
  const f=rewardExpiryFixture();f.expire();f.rows.get(String(f.router)).data[106]=1;
  await assert.rejects(readRewardExpiryContext(f.args()),/paused/);
  const recovered=await readRewardExpiryContext({...f.args(),readOnlyRecovery:true});assert.equal(recovered.record.reserved,false);
});

test('synthetic Mainnet exact transaction proof reconciles through pause without admitting a fresh expiry',async()=>{
  const f=rewardExpiryFixture(),before=await readRewardExpiryContext(f.args()),blockhash=String(new PublicKey(new Uint8Array(32).fill(91)));
  const signed=new Transaction({feePayer:f.operator,recentBlockhash:blockhash}).add(before.instruction);
  signed.sign(Keypair.fromSeed(new Uint8Array(32).fill(33)));const signature=bs58.encode(signed.signature),snapshot=expirySnapshot(before);
  const saved={version:1,state:'prepared',cluster:'mainnet-beta',genesisHash:SOLANA_GENESIS['mainnet-beta'],programId:String(f.program),
    programDataSha256:f.release.programDataSha256,planHash:expiryPlanHash(f.plan),before:snapshot,snapshotHash:expiryObjectHash(snapshot),
    signature,transactionBase64:signed.serialize().toString('base64'),blockhash,lastValidBlockHeight:999,messageHash:expiryDigest(signed.serializeMessage())};
  f.advance();f.slot=f.market.slot;f.expire();f.rows.get(String(f.router)).data[106]=1;
  const message=signed.compileMessage(),pre=message.accountKeys.map((_,i)=>i===0?100000:1000),post=[...pre];post[0]-=5000;
  const transaction={slot:f.slot,transaction:{signatures:[signature],message},meta:{err:null,fee:5000,preBalances:pre,postBalances:post,innerInstructions:[]}};
  f.connection.getTransaction=async()=>transaction;
  f.connection.getSignatureStatuses=async()=>({context:{slot:f.slot},value:[{slot:f.slot,err:null,confirmationStatus:'finalized'}]});
  const options={connection:f.connection,attempt:saved,plan:f.plan,programId:f.program,currentAuthority:f.operator,cluster:'mainnet-beta',expectedProgramDataSha256:f.release.programDataSha256,release:f.release};
  assert.equal((await finalizedExpiryAttempt(options)).expiryTransactionVerified,true);
  await assert.rejects(readRewardExpiryContext(f.args()),/paused/);
  f.programData.data.writeBigUInt64LE(BigInt(f.slot+1),4);assert.equal(await finalizedExpiryAttempt(options),null);
});

test('incomplete production admission rejects expiry before RPC, signing or durable broadcast hooks',async()=>{
  const f=rewardExpiryFixture();let calls=0;
  const forbidden=async()=>{calls++;assert.fail('No RPC, signing or persistence under an unreviewed release');};
  await assert.rejects(finalizedSend({getGenesisHash:forbidden},new Transaction(),[{publicKey:f.operator,remoteSign:forbidden}],
    {cluster:'mainnet-beta',programId:String(f.program),expectedProgramDataSha256:f.release.programDataSha256,beforeBroadcast:forbidden}),/reviewed release/);
  assert.equal(calls,0);
});
