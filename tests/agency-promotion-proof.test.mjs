import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction} from '@solana/web3.js';
import {agencyProtocolSplit,agencyDiscriminator,buildAgencyPromotionV3Instruction} from '../agency-mint-router-v3.js';
import {agencyDeliveryHash,loadFinalizedAgencyPromotion} from '../server/agency-promotion-proof.mjs';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey;
function fixture({self=false}={}){
  const programId=key(151),mint=key(152),creator=key(153),authority=key(154),recipient=self?authority:key(155);
  const delivery={id:'1234567890123456789',authorId:'123',text:'[Devnet test] exact synthetic agency promotion',createdAt:'2026-10-18T10:00:00Z',verified:true};
  const signature='3'.repeat(64),amount='6666666',postedAt=Math.floor(Date.parse(delivery.createdAt)/1000),hash=agencyDeliveryHash(delivery);
  const built=buildAgencyPromotionV3Instruction({programId,mint,authority,promotionRecipient:recipient,postId:delivery.id,deliveryHash:hash,sequence:0,amount,postedAt});
  const message=new Transaction({feePayer:authority,recentBlockhash:key(156).toBase58()}).add(built.instruction).compileMessage();
  const keys=message.accountKeys.map(row=>row.toBase58()),index=key=>keys.indexOf(key.toBase58());
  const before=keys.map(()=>10000000),after=[...before],rent=2000000;
  before[index(built.receipt)]=0;after[index(built.receipt)]=rent;
  after[index(built.vault)]-=Number(amount);after[index(recipient)]+=Number(amount);after[0]-=rent+5000;
  const tx={slot:123,blockTime:postedAt+1,transaction:{signatures:[signature],message},meta:{err:null,fee:5000,preBalances:before,postBalances:after}};
  const data=Buffer.alloc(140);agencyDiscriminator('AgencyPromotionV3').copy(data);mint.toBuffer().copy(data,8);
  data.writeBigUInt64LE(BigInt(delivery.id),40);hash.copy(data,48);data.writeUInt32LE(0,80);recipient.toBuffer().copy(data,84);
  data.writeBigUInt64LE(BigInt(amount),116);data.writeBigInt64LE(BigInt(postedAt),124);data.writeBigInt64LE(BigInt(postedAt+1),132);
  let deliveryValid=true,policyValid=true;
  const input={programId,mint,creator,authority,initialAuthority:authority,promotionRecipient:recipient,postId:delivery.id,sequence:0,amount,
    text:delivery.text,signature,split:agencyProtocolSplit(),
    connection:{getTransaction:async()=>tx,getAccountInfo:async()=>({owner:programId,data,lamports:rent})},
    verifyDelivery:async({id,text})=>deliveryValid&&id===delivery.id&&text===delivery.text?delivery:null,
    verifyPolicy:async()=>({verified:policyValid,agencyPolicy:true,selectedMask:1,promotionRecipient:recipient.toBase58(),
      promotionSequence:1,lastPromotionAt:BigInt(postedAt),agentSpent:[BigInt(amount),0n,0n]})};
  return{input,tx,data,recipient,delivery,setDelivery:value=>deliveryValid=value,setPolicy:value=>policyValid=value};
}
test('promotion fee needs both exact X delivery and finalized protected billing with independent wallet credit',async()=>{
  const f=fixture(),proof=await loadFinalizedAgencyPromotion(f.input);
  assert.equal(proof.amount,'6666666');assert.equal(proof.actualReceivedLamports,'6666666');assert.equal(proof.post.id,f.delivery.id);
  assert.equal(proof.balanceDeltaVerified,true);assert.equal(proof.agent,0);assert.equal(proof.category,7);
  f.setDelivery(false);assert.equal(await loadFinalizedAgencyPromotion(f.input),null);f.setDelivery(true);
  f.setPolicy(false);assert.equal(await loadFinalizedAgencyPromotion(f.input),null);f.setPolicy(true);
  f.data[48]^=1;assert.equal(await loadFinalizedAgencyPromotion(f.input),null);f.data[48]^=1;
  const index=f.tx.transaction.message.accountKeys.findIndex(row=>row.equals(f.recipient));f.tx.meta.postBalances[index]--;
  assert.equal(await loadFinalizedAgencyPromotion(f.input),null);
});
test('a billing recipient paying costs reports exact net change and cannot hide receipt rent',async()=>{
  const f=fixture({self:true}),proof=await loadFinalizedAgencyPromotion(f.input);
  assert.equal(proof.actualReceivedLamports,'4661666');assert.equal(proof.recipientRentLamports,'2000000');assert.equal(proof.feeLamports,5000);
  f.tx.meta.postBalances[0]++;assert.equal(await loadFinalizedAgencyPromotion(f.input),null);
});
test('delivery hashing rejects an unverified response and binds post author, text and time',()=>{
  const f=fixture(),hash=agencyDeliveryHash(f.delivery);
  for(const change of [{authorId:'999'},{text:'Changed copy'},{createdAt:'2026-10-18T10:00:01Z'}])assert(!hash.equals(agencyDeliveryHash({...f.delivery,...change})));
  assert.throws(()=>agencyDeliveryHash({...f.delivery,verified:false}),/independently verified/);
});
