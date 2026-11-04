import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {Keypair,Transaction,VersionedTransaction,TransactionMessage,SystemProgram} from '@solana/web3.js';
import {executeLaunchPlan} from '../launch-executor.js';
function fixture(versioned,{mutate=false,lostAck=false,beforeBroadcast=()=>{}}={}){
 const payer=Keypair.generate(),mint=Keypair.generate(),blockhash=Keypair.generate().publicKey.toBase58(),to=Keypair.generate().publicKey;
 const instructions=[SystemProgram.transfer({fromPubkey:mint.publicKey,toPubkey:to,lamports:1000})];
 const transaction=versioned?new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash,instructions}).compileToV0Message()):new Transaction().add(...instructions);
 const state={sends:0,confirmations:0,events:[],signature:null};
 const provider={signTransaction:async tx=>{
  if(mutate){if(versioned)tx.message.compiledInstructions[0].data[4]^=1;else tx.instructions[0].data[4]^=1;}
  // The fixture owns every signer, so altered messages still have valid crypto
  // signatures. Intent verification must independently reject the changed bytes.
  if(versioned)tx.sign([payer,mint]);else tx.partialSign(payer,mint);return tx;
 }};
 const connection={getLatestBlockhash:async()=>({blockhash,lastValidBlockHeight:100}),sendRawTransaction:async wire=>{
  state.sends++;state.signature=bs58.encode(versioned?VersionedTransaction.deserialize(wire).signatures[0]:Transaction.from(wire).signature);
  if(lostAck)throw Error('lost acknowledgement');return state.signature;
 },confirmTransaction:async()=>{state.confirmations++;return{value:{err:null}};}};
 return{state,run:()=>executeLaunchPlan({connection,provider,payer:payer.publicKey,mint,plan:{steps:[{kind:'launch',transaction}]},onEvent:event=>state.events.push(event),beforeBroadcast})};
}
for(const versioned of [false,true]){
 const format=versioned?'versioned':'legacy';
 test(`expired reservation after ${format} wallet approval never broadcasts`,async()=>{
  let checks=0;
  const {state,run}=fixture(versioned,{beforeBroadcast:()=>{if(++checks===2)throw Error('Ticker reservation expired');}});
  await assert.rejects(run,/reservation expired/);assert.equal(state.sends,0);assert.equal(state.confirmations,0);
  assert.equal(state.events.some(event=>event.state==='broadcasting'),false);
 });
 test(`unchanged ${format} launch signs and confirms exactly once`,async()=>{
  const {state,run}=fixture(versioned);const result=await run();assert.equal(result.signature,state.signature);assert.equal(state.sends,1);assert.equal(state.confirmations,1);
 });
 test(`same-object ${format} message mutation cannot broadcast even with valid signatures`,async()=>{
  const {state,run}=fixture(versioned,{mutate:true});await assert.rejects(run,/Wallet changed/);assert.equal(state.sends,0);assert.equal(state.confirmations,0);
 });
 test(`lost ${format} send acknowledgement preserves the known identity and never re-signs`,async()=>{
  const {state,run}=fixture(versioned,{lostAck:true});await assert.rejects(run,/lost acknowledgement/);assert.equal(state.sends,1);assert.equal(state.confirmations,0);
  assert.equal(state.events.at(-1).state,'unknown');assert.equal(state.events.at(-1).signature,state.signature);
 });
}
