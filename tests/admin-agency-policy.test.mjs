import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction,SystemProgram} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {publishAgencyFeePolicy} from '../server/admin-agency-policy.mjs';
import {agencyProtocolUnits,agencyProtocolSplit,buildAgencyConfigV3Instruction} from '../agency-mint-router-v3.js';

const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey;
function fixture(revision='1') {
  const [programId,authority,recipient,actor]=[81,82,83,84].map(key);
  const deployment={verified:true,revision,protocolUnits:agencyProtocolUnits(),protocolSplit:agencyProtocolSplit(),promotionRecipient:String(recipient)};
  const built=buildAgencyConfigV3Instruction({programId,authority,promotionRecipient:recipient,...(revision==='1'?{}:{expectedRevision:String(BigInt(revision)-1n)})});
  const tx={slot:500,blockTime:1760000000,meta:{err:null},transaction:{message:new Transaction({feePayer:authority,recentBlockhash:String(key(85))}).add(built.instruction).compileMessage()}};
  const signature=bs58.encode(nacl.sign.detached(tx.transaction.message.serialize(),Keypair.fromSeed(Buffer.alloc(32,82)).secretKey));
  tx.transaction.signatures=[signature];
  const state={adminSettings:{protocolFeePolicy:{revision:2,split:{operationsPercent:40,referralLevelPercents:[10,3,2],communityPercent:20,buybackPercent:25}}},launches:{old:{savedRates:[2,.6,.4]}}};
  const store={read:async()=>structuredClone(state),update:async mutate=>mutate(state)};
  return{state,tx,input:{expectedRevision:2,configRevision:revision,signature,reason:'Reviewed new-launch referral activation'},
    store,connection:{getTransaction:async()=>tx},programId,authority,actor:String(actor),approvedHash:'a'.repeat(64),readDeployment:async()=>deployment};
}
test('only a matching finalized authority configuration publishes future-mint rates and preserves old records',async()=>{
  for(const revision of ['1','2']) {
    const f=fixture(revision),old=structuredClone(f.state.launches);
    const saved=await publishAgencyFeePolicy(f);
    assert.deepEqual(saved.split.referralLevelPercents,[3,1.25,.75]);
    assert.equal(saved.split.agencyPercent,10);assert.equal(saved.revision,3);
    assert.equal(saved.configurationSignature,f.input.signature);assert.deepEqual(f.state.launches,old);
    assert.equal(f.state.adminAudit['agency-fee-policy:3'].wallet,f.actor);
    assert.deepEqual(await publishAgencyFeePolicy(f),saved);
  }
});
test('failed, wrong, stale and substituted configuration evidence cannot publish',async()=>{
  for(const change of [f=>f.tx.meta.err={InstructionError:[0,1]},f=>f.input.configRevision='2',
    f=>{f.input.signature='1'.repeat(64);f.tx.transaction.signatures=[f.input.signature];},
    f=>f.input.expectedRevision=1,f=>f.input.reason='short',f=>f.readDeployment=async()=>{throw new Error('wrong binary');},
    f=>f.tx.transaction.message=new Transaction({feePayer:f.authority,recentBlockhash:String(key(85))})
      .add(SystemProgram.transfer({fromPubkey:f.authority,toPubkey:key(86),lamports:1})).compileMessage()]) {
    const f=fixture();change(f);await assert.rejects(publishAgencyFeePolicy(f));
    assert.equal(f.state.adminSettings.protocolFeePolicy.revision,2);
  }
});
