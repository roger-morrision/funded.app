import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,Transaction,TransactionInstruction,SystemProgram} from '@solana/web3.js';
import bs58 from 'bs58';
import {buildRewardManifest} from '../reward-merkle.js';
import {rewardBitmap,bitmapPaid,rewardDiscriminator,rewardReceiptCleanup,cleanupPaidSchedules} from '../server/reward-rent.mjs';
import {parseCycleFields} from '../server/reward-account-codec.mjs';
import {rewardPayoutProof,findRewardPayout} from '../server/reward-payout-evidence.mjs';

test('bitmap codec checks bounds and exact allocation; retained closed state remains readable',()=>{
  const data=Buffer.alloc(180);rewardDiscriminator('account','RewardBitmapCycle').copy(data);data.writeUInt32LE(9,168);data.writeUInt32LE(2,174);data[178]=129;data[179]=1;
  const bits=rewardBitmap({data});assert(bitmapPaid(bits,0));assert(bitmapPaid(bits,7));assert(bitmapPaid(bits,8));assert(!bitmapPaid(bits,1));assert(!bitmapPaid(bits,-1));
  assert.equal(parseCycleFields({data}).reserved,false);assert.equal(parseCycleFields({data}).receiptMode,'bitmap');
  data.writeUInt32LE(65537,168);assert.throws(()=>rewardBitmap({data}),/layout/);
});

function fixture(){
  const payer=Keypair.generate().publicKey,program=Keypair.generate().publicKey,vault=Keypair.generate().publicKey,cycle=Keypair.generate().publicKey;
  const recipients=[Keypair.generate().publicKey,Keypair.generate().publicKey];
  const manifest=buildRewardManifest({cycleId:'ab'.repeat(32),asset:'SOL',allocations:recipients.map(recipient=>({recipient:recipient.toBase58(),amount:'10000'}))});
  const tx=new Transaction({feePayer:payer,recentBlockhash:PublicKey.default.toBase58()});
  for(const leaf of manifest.leaves){
    const data=Buffer.alloc(24);rewardDiscriminator('global','payout_bitmap_sol').copy(data);data.writeBigUInt64LE(10000n,8);data.writeUInt32LE(leaf.index,16);data.writeUInt32LE(leaf.proof.length,20);
    tx.add(new TransactionInstruction({programId:program,keys:[payer,vault,PublicKey.default,cycle,new PublicKey(leaf.recipient),SystemProgram.programId].map((pubkey,i)=>({pubkey,isSigner:i===0,isWritable:[0,1,2,3,4].includes(i)})),data:Buffer.concat([data,...leaf.proof.map(h=>Buffer.from(h,'hex'))])}));
  }
  const message=tx.compileMessage(),keys=message.accountKeys.map(k=>k.toBase58()),pre=keys.map(()=>1000000),post=[...pre];
  post[keys.indexOf(vault.toBase58())]-=20000;post[0]-=5000;for(const r of recipients)post[keys.indexOf(r.toBase58())]+=10000;
  const proof={slot:9,blockTime:1800000000,transaction:{message,signatures:['proof']},meta:{err:null,fee:5000,preBalances:pre,postBalances:post}};
  return {proof,context:{program,cycle,vault,manifest,leaf:manifest.leaves[0],bitmap:true}};
}
test('shared-cycle history binds exact leaf, transfer and all batch instructions',()=>{
  const {proof,context}=fixture();assert.equal(rewardPayoutProof(proof,context).amountReceived,'10000');
  const ix=proof.transaction.message.instructions[0],data=bs58.decode(ix.data);data[8]=99;ix.data=bs58.encode(data);
  assert.equal(rewardPayoutProof(proof,context),null);
});
test('recovery skips creation/other leaf signatures and finds the exact finalized payout',async()=>{
  const {proof,context}=fixture();const connection={getSignaturesForAddress:async()=>[{signature:'creation',err:null},{signature:'payout',err:null}],getTransaction:async sig=>sig==='payout'?proof:null};
  assert.equal((await findRewardPayout(connection,context)).signature,'proof');
  connection.getTransaction=async()=>null;await assert.rejects(findRewardPayout(connection,context),/do not resend/);
});
test('Mainnet cleanup refuses before reads or signing',async()=>{
  let called=false;const cleanup=rewardReceiptCleanup({cluster:'mainnet-beta',requireReady:async()=>{called=true;}});
  await assert.rejects(cleanup({}),/Devnet only/);assert.equal(called,false);
});
test('cleanup worker is bounded and preserves archives while retaining retry failures',async()=>{
  const state={schedules:{a:{id:'a',status:'paid',payments:{x:{signature:'archive'}}},b:{id:'b',status:'paid'},c:{id:'c',status:'distributing'}}};
  const store={transaction:async fn=>fn(state)},calls=[];
  const chain={cluster:'devnet',cleanupReceipts:async p=>{calls.push(p.id);throw Error('RPC unavailable');}};
  await cleanupPaidSchedules({store,chain});assert.deepEqual(calls,['a']);assert.equal(state.schedules.a.payments.x.signature,'archive');
  assert.match(state.schedules.a.receiptCleanup.error,/RPC/);assert.equal(state.schedules.b.receiptCleanup,undefined);
});
