import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {Keypair} from '@solana/web3.js';
import {runAgencyPromotion,createAgencyPublisher} from '../server/agency-promotion-executor.mjs';
import {agencyProtocolSplit} from '../agency-mint-router-v3.js';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)),mint=key(181).publicKey.toBase58(),authority=key(182),programId=key(183).publicKey.toBase58();
function fixture(){
  let state={},calls=0,outboxRow=null,verified=true,chainProof=null,journalCalls=0,prepared=null;
  const context={verified:true,cluster:'devnet',programDataSha256:'a'.repeat(64),policy:{selectedMask:1,promotionSequence:0,
    lastPromotionAt:0n,promotionRecipient:key(184).publicKey.toBase58()},agentRemaining:['1000000','0','0'],promotionRecipientReady:true,
    launch:{name:'Synthetic QA',symbol:'QA',creatorWallet:key(185).publicKey.toBase58(),pumpFeeRoute:{initialAuthority:authority.publicKey.toBase58(),protocolSplit:agencyProtocolSplit()}},
    proofs:[{signature:bs58.encode(Buffer.alloc(64,3)),slot:100,cluster:'devnet',commitment:'finalized',verified:true}]};
  const store={read:async()=>structuredClone(state),update:async fn=>{const next=structuredClone(state),result=fn(next);state=next;return structuredClone(result);}};
  const publisher={verifyPost:async({id,text})=>{calls++;if(!verified)throw new Error('X verification failed');
    return{id,authorId:'123',text,verified:true,createdAt:new Date().toISOString()};},publish:async()=>{calls++;return{id:'123'};}};
  const input={store,outbox:{get:async()=>outboxRow,enqueue:async event=>outboxRow={event,status:'pending'}},connection:{
    getLatestBlockhash:async()=>({blockhash:key(186).publicKey.toBase58(),lastValidBlockHeight:1000}),getMinimumBalanceForRentExemption:async()=>2000000},
    mint,programId,approvedHash:'a'.repeat(64),authority,publisher,readContext:async()=>context,
    journal:async args=>{journalCalls++;prepared=await args.prepare();return{status:'finalized',signature:'bill',proof:{finalized:true,balanceDeltaVerified:true}};}};
  return{input,context,get state(){return state;},get outboxRow(){return outboxRow;},get calls(){return calls;},get journalCalls(){return journalCalls;},get prepared(){return prepared;},
    posted:()=>{outboxRow.status='posted';outboxRow.result={id:'123'};},uncertain:()=>outboxRow.status='uncertain',deny:()=>verified=false};
}
test('agency queue survives funding growth without changing its content or charging an unpublished post',async()=>{
  const f=fixture();assert.equal((await runAgencyPromotion(f.input)).status,'x-pending');const event=structuredClone(f.outboxRow.event);
  f.context.agentRemaining[0]='2000000';assert.equal((await runAgencyPromotion(f.input)).status,'x-pending');
  assert.deepEqual(f.outboxRow.event,event);assert.equal(f.calls,0);assert.equal(f.journalCalls,0);
  f.uncertain();assert.equal((await runAgencyPromotion(f.input)).status,'x-uncertain');assert.equal(f.journalCalls,0);
});
test('only independently verified delivery proceeds to exact protected billing and finalized accounting',async()=>{
  const f=fixture();await runAgencyPromotion(f.input);f.posted();const result=await runAgencyPromotion(f.input);
  assert.equal(result.status,'finalized');assert.equal(f.journalCalls,1);assert.equal(f.calls,1);
  assert.equal(f.prepared.estimatedRentLamports,'2000000');assert.equal(f.prepared.transaction.message.header.numRequiredSignatures,1);
  const row=Object.values(f.state.v3AgencyPromotions)[0];assert.equal(row.status,'finalized');assert.equal(row.signature,'bill');
  const g=fixture();await runAgencyPromotion(g.input);g.posted();g.deny();await assert.rejects(()=>runAgencyPromotion(g.input),/X verification/);
  assert.equal(g.journalCalls,0);
});
test('dispatch rechecks live selected budget and immutable outbox identity before making any X request',async()=>{
  const f=fixture();await runAgencyPromotion(f.input);
  const publish=createAgencyPublisher({...f.input});
  await assert.rejects(()=>publish({...f.outboxRow.event,text:'tampered'}),/funded intent/);assert.equal(f.calls,0);
  f.context.agentRemaining[0]='0';await assert.rejects(()=>publish(f.outboxRow.event),/preflight/);assert.equal(f.calls,0);
  f.context.agentRemaining[0]='1000000';assert.equal((await publish(f.outboxRow.event)).id,'123');assert.equal(f.calls,1);
});
test('one post per 24 hours is enforced independently of the general account posting quota',async()=>{
  const f=fixture();f.context.policy.lastPromotionAt=BigInt(Math.floor(Date.now()/1000)-3600);f.context.policy.promotionSequence=1;
  assert.equal((await runAgencyPromotion(f.input)).status,'cadence-wait');assert.equal(f.outboxRow,null);assert.equal(f.calls,0);
});
