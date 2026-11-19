import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {executeAgencyJournal} from '../server/agency-execution-journal.mjs';
import {allocationAuditHash} from '../server/allocation-audit-hash.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';

function fixture(options={}){
  const mint=String(Keypair.generate().publicKey),key=`agency:${mint}:2:0`;
  const intent={cluster:'devnet',mint,agent:2,programId:String(Keypair.generate().publicKey),approvedHash:'a'.repeat(64)};
  const row={key,intent,intentHash:allocationAuditHash(intent),signature:'saved-signature',signedTransaction:'AA==',
    blockhash:'expired-blockhash',lastValidBlockHeight:1000,status:'verification-pending',evidence:{test:true}};
  row.evidenceHash=allocationAuditHash(row.evidence);
  const state={v3AgencyExecutions:{[key]:row}},store={update:async fn=>fn(state)};
  const connection={getGenesisHash:async()=>DEVNET_GENESIS_HASH,getSignatureStatuses:async()=>({value:[options.status||null]}),
    isBlockhashValid:async()=>({value:false,context:{slot:2000}}),
    getBlockHeight:async config=>{assert.deepEqual(config,{commitment:'finalized',minContextSlot:2000});return options.height??1200;},
    getTransaction:async()=>options.transaction||null,
    getAccountInfoAndContext:async(_key,config)=>{assert.deepEqual(config,{commitment:'finalized',minContextSlot:2000});
      return {value:options.receipt||null,context:{slot:options.receiptSlot??2001}};}};
  const run=()=>executeAgencyJournal({store,connection,key,intent,authority:Keypair.generate(),
    prepare:async()=>{throw Error('fresh attempt');},prove:async()=>null});
  return {run,state,key,connection};
}
test('expired unlanded milestone is retired with chain evidence before a later retry',async()=>{
  const f=fixture();assert.equal((await f.run()).status,'expired-unlanded');
  const row=f.state.v3AgencyExecutions[f.key];
  assert.equal(row.signature,undefined);assert.equal(row.signedTransaction,undefined);assert.equal(row.evidence,undefined);
  assert.equal(row.expiredAttempts[0].signature,'saved-signature');assert.equal(row.expiredAttempts[0].receiptSlot,2001);
  await assert.rejects(f.run(),/fresh attempt/);
});
test('any landing evidence, insufficient expiry margin or stale receipt context retains original signature',async()=>{
  for(const options of [{height:1150},{status:{confirmationStatus:'processed'}},{transaction:{slot:1}},{receipt:{owner:'program'}},{receiptSlot:1999}]){
    const f=fixture(options);assert.equal((await f.run()).status,'verification-pending');
    assert.equal(f.state.v3AgencyExecutions[f.key].signature,'saved-signature');
  }
});
test('unavailable expiry evidence cannot retire a signed attempt',async()=>{
  const f=fixture();f.connection.getAccountInfoAndContext=async()=>{throw Error('RPC unavailable');};
  await assert.rejects(f.run(),/RPC unavailable/);assert.equal(f.state.v3AgencyExecutions[f.key].signature,'saved-signature');
});
