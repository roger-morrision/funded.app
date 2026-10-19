import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Transaction } from '@solana/web3.js';
import { QA_SETTLEMENT_RECOVERY as approved, buildQaSettlementRecoveryInstruction,
  QA_RECOVERY_DISCRIMINATOR } from '../server/devnet-qa-settlement-recovery.mjs';
import {QA_SETTLEMENT_RECOVERY_FOLLOWUP as followup} from '../server/devnet-qa-settlement-recovery.mjs';
import { loadFinalizedV3Settlement } from '../server/v3-settlement-proof.mjs';

const input = () => ({...approved,claimId:Buffer.from(approved.claimId,'hex'),
  split:{operationsPercent:50,referralLevelPercents:[10,3,2],communityPercent:10,buybackPercent:25}});

test('restricted QA recovery builder rejects alternate program, mint, creator, authority, claim, amount and rates', () => {
  const built = buildQaSettlementRecoveryInstruction(input());
  assert.equal(built.instruction.keys[0].isSigner,true);
  assert.equal(built.instruction.keys[1].isSigner,false);
  assert.ok(built.instruction.data.subarray(0,8).equals(QA_RECOVERY_DISCRIMINATOR));
  for (const field of ['programId','mint','creator','authority']) {
    assert.throws(()=>buildQaSettlementRecoveryInstruction({...input(),[field]:Keypair.generate().publicKey}));
  }
  assert.throws(()=>buildQaSettlementRecoveryInstruction({...input(),claimId:Buffer.alloc(32)}));
  assert.throws(()=>buildQaSettlementRecoveryInstruction({...input(),expectedLamports:'742576'}));
  assert.throws(()=>buildQaSettlementRecoveryInstruction({...input(),split:{...input().split,
    operationsPercent:40,communityPercent:20}}));
});

test('separately approved follow-up accepts only its exact claim and amount, preserving the original record',()=>{
  const next={...input(),...followup,claimId:Buffer.from(followup.claimId,'hex')};
  const built=buildQaSettlementRecoveryInstruction(next);
  assert.equal(built.instruction.keys[1].isSigner,false);
  assert.equal(built.instruction.data.readBigUInt64LE(40),1484671n);
  assert.throws(()=>buildQaSettlementRecoveryInstruction({...next,expectedLamports:'742575'}));
  assert.throws(()=>buildQaSettlementRecoveryInstruction({...next,claimId:Buffer.from(approved.claimId,'hex')}));
  assert.throws(()=>buildQaSettlementRecoveryInstruction({...next,creator:Keypair.generate().publicKey}));
  assert.equal(buildQaSettlementRecoveryInstruction(input()).instruction.data.readBigUInt64LE(40),742575n);
});

for(const record of [approved,followup])test(`mocked finalized recovery proof binds exact approved claim ${record.claimId.slice(0,8)}`, async () => {
  const params={...input(),...record,claimId:Buffer.from(record.claimId,'hex')}, built=buildQaSettlementRecoveryInstruction(params);
  const signature='1'.repeat(64);
  const message=new Transaction({feePayer:built.instruction.keys[0].pubkey,
    recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(built.instruction).compileMessage();
  const keys=message.accountKeys.map(key=>key.toBase58());
  const routerIndex=keys.indexOf(built.router.address.toBase58());
  const before=keys.map(()=>0),after=keys.map(()=>0);
  before[routerIndex]=1_188_720+Number(record.expectedLamports); after[routerIndex]=1_188_720;
  const tx={slot:42,meta:{err:null,preBalances:before,postBalances:after},
    transaction:{signatures:[signature],message}};
  const expectedTotal=BigInt(record.priorSettledLamports)+BigInt(record.expectedLamports);
  let total=expectedTotal;
  const args={...params,signature,connection:{getTransaction:async()=>tx},
    verifyClaim:async()=>({verified:true,address:built.claim,categoryLamports:record===approved
      ?[594060n,74257n,14852n,4455n,2971n,14851n,37129n]
      :[1187737n,148467n,29693n,8908n,5939n,29693n,74234n]}),
    verifyPolicy:async()=>({verified:true,address:built.policy.address,settledLamports:total})};
  const proof=await loadFinalizedV3Settlement(args);
  assert.equal(proof.authorization,'restricted-devnet-qa-recovery');
  assert.equal(proof.expectedLamports,record.expectedLamports);
  assert.equal(message.header.numRequiredSignatures,1);
  total=BigInt(record.expectedLamports); assert.equal(await loadFinalizedV3Settlement(args),null); total=expectedTotal;
  after[routerIndex]++; assert.equal(await loadFinalizedV3Settlement(args),null); after[routerIndex]--;
  assert.equal(await loadFinalizedV3Settlement({...args,creator:Keypair.generate().publicKey}),null);
  message.instructions[0].data='1'; assert.equal(await loadFinalizedV3Settlement(args),null);
});
