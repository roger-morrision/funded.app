import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {creatorSettlementRetryState} from '../server/creator-settlement-transaction.mjs';
const receiptAddress=Keypair.generate().publicKey.toBase58();
function fixture(overrides={}){
 const calls=[];
 const connection={getSignatureStatuses:async()=>({value:[null]}),getBlockHeight:async commitment=>{calls.push(commitment);return 101;},
  isBlockhashValid:async(_hash,commitment)=>{calls.push(commitment);return{value:false};},
  getTransaction:async()=>null,getAccountInfo:async()=>null,...overrides};
 return{connection,calls,input:{connection,signatures:['saved-signature'],blockhash:'saved-blockhash',receiptAddress,lastValidBlockHeight:100}};
}
test('retry requires finalized failure rather than confirmed failure',async()=>{
 for(const confirmationStatus of ['processed','confirmed','finalized']){
  const f=fixture({getSignatureStatuses:async()=>({value:[{err:{InstructionError:[0,'failed']},confirmationStatus}]})});
  assert.equal((await creatorSettlementRetryState(f.input)).retry,confirmationStatus==='finalized');
 }
});
test('expired blockhash alone never permits another payment',async()=>{
 const f=fixture();assert.equal((await creatorSettlementRetryState({...f.input,receiptAddress:undefined})).retry,false);
 assert.equal((await creatorSettlementRetryState({...f.input,lastValidBlockHeight:undefined})).retry,false);
 assert.deepEqual(f.calls,[]);
});
test('retry requires expired finalized height, absent signature, transaction and immutable receipt',async()=>{
 const good=fixture();assert.equal((await creatorSettlementRetryState(good.input)).retry,true);
 assert.deepEqual(good.calls,['finalized','finalized']);
 for(const overrides of [
  {getBlockHeight:async()=>100},{isBlockhashValid:async()=>({value:true})},
  {getTransaction:async()=>({slot:1})},{getAccountInfo:async()=>({data:Buffer.alloc(1)})},
  {getSignatureStatuses:async()=>({value:[{err:null,confirmationStatus:'confirmed'}]})},
  {getSignatureStatuses:async()=>({value:[]})},
 ])assert.equal((await creatorSettlementRetryState(fixture(overrides).input)).retry,false);
});
