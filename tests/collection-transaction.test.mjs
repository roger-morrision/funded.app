import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {Keypair,SystemProgram,Transaction} from '@solana/web3.js';
import {sendJournaledCollection} from '../server/collection-transaction.mjs';
function fixture(){
 const payer=Keypair.generate(),recipient=Keypair.generate().publicKey;
 const transaction=new Transaction({feePayer:payer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()})
  .add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:recipient,lamports:1}));transaction.lastValidBlockHeight=100;
 let journal,sends=0;const connection={sendRawTransaction:async wire=>{assert(journal,'durable identity must precede broadcast');sends++;return bs58.encode(Transaction.from(wire).signature);},
  getSignatureStatuses:async()=>({value:[{confirmationStatus:'finalized',err:null}]}),getBlockHeight:async()=>99};
 return{payer,transaction,connection,get sends(){return sends;},get journal(){return journal;},onSigned:async row=>{journal=row;}};
}
test('collection journals the exact signed identity before a single immutable broadcast',async()=>{
 const f=fixture(),signature=await sendJournaledCollection(f.connection,f.transaction,[f.payer],{onSigned:f.onSigned});
 assert.equal(f.sends,1);assert.equal(signature,f.journal.signature);assert.equal(f.journal.lastValidBlockHeight,100);assert.match(f.journal.wireHash,/^[a-f0-9]{64}$/);
});
test('failed durable journal prevents every broadcast',async()=>{
 const f=fixture();await assert.rejects(sendJournaledCollection(f.connection,f.transaction,[f.payer],{onSigned:async()=>{throw Error('database unavailable');}}),/database unavailable/);
 assert.equal(f.sends,0);
});
test('lost send response reconciles the already landed signature without a replacement',async()=>{
 const f=fixture();let sends=0;f.connection.sendRawTransaction=async()=>{sends++;throw Error('response lost');};
 assert.equal(await sendJournaledCollection(f.connection,f.transaction,[f.payer],{onSigned:f.onSigned}),f.journal.signature);assert.equal(sends,1);
});
test('unlanded expiry and finalized failure preserve the pending identity without retrying',async()=>{
 for(const failed of [true,false]){
  const f=fixture();f.connection.getSignatureStatuses=async()=>({value:[failed?{confirmationStatus:'finalized',err:{InstructionError:[0,1]}}:null]});
  f.connection.getBlockHeight=async()=>101;
  await assert.rejects(sendJournaledCollection(f.connection,f.transaction,[f.payer],{onSigned:f.onSigned,maxPolls:1}),e=>e.pendingSignature===f.journal.signature);
  assert.equal(f.sends,1);
 }
});
