import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {Keypair,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {executeAgencyJournal} from '../server/agency-execution-journal.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
const signer=Keypair.fromSeed(Buffer.alloc(32,171)),mint=Keypair.fromSeed(Buffer.alloc(32,172)).publicKey;
function fixture(){
  let state={},prepared=0,sent=[],valid=true,proof=false,now=100000,balance=4000000000,status=null,failWrite=false;
  const store={read:async()=>structuredClone(state),update:async fn=>{
    const next=structuredClone(state),result=fn(next);if(failWrite&&result?.signature)throw new Error('journal unavailable');state=next;return structuredClone(result);
  }};
  const connection={getGenesisHash:async()=>DEVNET_GENESIS_HASH,getFeeForMessage:async()=>({value:5000}),
    getBalance:async()=>balance,isBlockhashValid:async()=>({value:valid}),getSignatureStatuses:async()=>({value:[status]}),
    sendRawTransaction:async bytes=>{
      const tx=VersionedTransaction.deserialize(bytes),signature=bs58.encode(tx.signatures[0]);
      assert.equal(state.v3AgencyExecutions[input.key].signature,signature,'journal must precede broadcast');
      sent.push(Buffer.from(bytes).toString('base64'));throw new Error('network timeout after accepted transaction');
    }};
  const input={store,connection,key:`agency:${mint}:0:0`,intent:{cluster:'devnet',approvedHash:'a'.repeat(64),amount:'100',postId:'123'},authority:signer,
    now:()=>now,prepare:async()=>{
      prepared++;
      const message=new TransactionMessage({payerKey:signer.publicKey,recentBlockhash:mint.toBase58(),instructions:[
        SystemProgram.transfer({fromPubkey:signer.publicKey,toPubkey:mint,lamports:100})]}).compileToV0Message();
      return{transaction:new VersionedTransaction(message),lastValidBlockHeight:1000,estimatedRentLamports:'1000000'};
    },prove:async row=>proof?{signature:row.signature,finalized:true,balanceDeltaVerified:true,amount:'100'}:null};
  return{input,get state(){return state;},get prepared(){return prepared;},get sent(){return sent;},
    setProof:value=>proof=value,setValid:value=>valid=value,setBalance:value=>balance=value,setStatus:value=>status=value,
    failWrite:()=>failWrite=true,tick:()=>now+=61000};
}
test('timeout and restart reuse one journaled signature; finalized proof is required before recording success',async()=>{
  const f=fixture(),first=await executeAgencyJournal(f.input);assert.equal(first.status,'verification-pending');assert.equal(f.prepared,1);
  f.tick();const resumed=await executeAgencyJournal(f.input);assert.equal(resumed.signature,first.signature);
  assert.equal(f.prepared,1);assert.equal(f.sent.length,2);assert.equal(f.sent[0],f.sent[1]);
  f.setProof(true);assert.equal((await executeAgencyJournal(f.input)).status,'finalized');
  assert.equal(f.sent.length,2);assert.equal(f.state.v3AgencyExecutions[f.input.key].signedTransaction,undefined);
  assert.equal((await executeAgencyJournal(f.input)).status,'finalized');
  f.setProof(false);assert.equal((await executeAgencyJournal(f.input)).status,'verification-pending');
  assert.equal(f.sent.length,2);
});
test('concurrent workers produce at most one new signed action and changed intents cannot replace it',async()=>{
  const f=fixture();await Promise.all([executeAgencyJournal(f.input),executeAgencyJournal(f.input)]);
  assert.equal(f.prepared,1);assert.equal(f.sent.length,1);
  await assert.rejects(()=>executeAgencyJournal({...f.input,intent:{...f.input.intent,amount:'101'}}),/intent changed/);
});
test('expired or finalized-failed signatures are retained without new quotes or debits',async()=>{
  const f=fixture();await executeAgencyJournal(f.input);f.setValid(false);f.tick();
  assert.equal((await executeAgencyJournal(f.input)).status,'verification-pending');assert.equal(f.prepared,1);assert.equal(f.sent.length,1);
  f.setStatus({confirmationStatus:'finalized',err:{InstructionError:[0,'Custom']}});
  assert.equal((await executeAgencyJournal(f.input)).status,'failed-finalized');assert.equal(f.sent.length,1);
});
test('payer reserve, wrong network and unavailable journal stop all broadcasts',async()=>{
  const f=fixture();f.setBalance(3000000000);await assert.rejects(()=>executeAgencyJournal(f.input),/reserve/);assert.equal(f.sent.length,0);
  const g=fixture();g.input.connection.getGenesisHash=async()=>'mainnet';await assert.rejects(()=>executeAgencyJournal(g.input),/Devnet/);assert.equal(g.prepared,0);
  const h=fixture();h.failWrite();await assert.rejects(()=>executeAgencyJournal(h.input),/journal unavailable/);assert.equal(h.sent.length,0);
});
