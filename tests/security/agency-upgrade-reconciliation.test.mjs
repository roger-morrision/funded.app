import test from 'node:test';import assert from 'node:assert/strict';import {Keypair} from '@solana/web3.js';
import {executeAgencyJournal} from '../../server/agency-execution-journal.mjs';import {runAgencyMilestone} from '../../server/agency-buyback-executor.mjs';
import {allocationAuditHash} from '../../server/allocation-audit-hash.mjs';import {DEVNET_GENESIS_HASH} from '../../server/automatic-reward-chain.mjs';
function fixture(){const mint=String(Keypair.generate().publicKey),intent={cluster:'devnet',mint,agent:1,programId:mint,approvedHash:'a'.repeat(64),creator:mint,initialAuthority:mint},key=`agency:${mint}:1:0`,signature='2'.repeat(88);
 const state={v3AgencyExecutions:{[key]:{key,intent,intentHash:allocationAuditHash(intent),signature,status:'verification-pending',signedTransaction:'must-never-be-broadcast'}}};
 return{mint,intent,key,signature,state,store:{read:async()=>structuredClone(state),update:async f=>f(state)},connection:{getGenesisHash:async()=>DEVNET_GENESIS_HASH}};
}
test('prior-program agency proof reconciliation retains original intent and never submits again',async()=>{
 const f=fixture();const result=await executeAgencyJournal({...f,reconcileOnly:true,prepare:()=>assert.fail('must not prepare'),prove:async()=>({signature:f.signature,finalized:true,balanceDeltaVerified:true})});
 assert.equal(result.status,'finalized');assert.equal(result.signature,f.signature);assert.equal(f.state.v3AgencyExecutions[f.key].intent.approvedHash,'a'.repeat(64));
});
test('unresolved prior-program agency signatures cannot rebroadcast expire or prepare',async()=>{
 const f=fixture();const result=await executeAgencyJournal({...f,reconcileOnly:true,prepare:()=>assert.fail('must not prepare'),prove:async()=>null});assert.equal(result.status,'verification-pending');assert.equal(f.state.v3AgencyExecutions[f.key].signedTransaction,'must-never-be-broadcast');
 delete f.state.v3AgencyExecutions[f.key].signature;await assert.rejects(executeAgencyJournal({...f,reconcileOnly:true,prepare:()=>{},prove:()=>null}),/existing signed agency attempt/);
});
test('milestone hash upgrade allows signed proof only while preserving immutable mint policy checks',async()=>{
 const f=fixture(),args={...f,agent:1,programId:f.mint,approvedHash:'b'.repeat(64),authority:{publicKey:Keypair.generate().publicKey},readContext:async()=>({policy:{selectedMask:2,completedMask:2},launch:{creatorWallet:f.mint,pumpFeeRoute:{initialAuthority:f.mint}},agentRemaining:['0','0','0']}),journal:async x=>{assert.equal(x.reconcileOnly,true);assert.equal(x.intent.approvedHash,'a'.repeat(64));return{status:'reconciled'};}};
 assert.equal((await runAgencyMilestone(args)).status,'reconciled');delete f.state.v3AgencyExecutions[f.key].signature;await assert.rejects(runAgencyMilestone(args),/different immutable mint policy/);
});
