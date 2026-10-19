import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Transaction } from '@solana/web3.js';
import { QA_SETTLEMENT_RECOVERY as approved, buildQaSettlementRecoveryInstruction,
  QA_RECOVERY_DISCRIMINATOR } from '../server/devnet-qa-settlement-recovery.mjs';
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

test('mocked finalized recovery proof binds exact instruction, single authority signer, claim, original policy and debit', async () => {
  const params=input(), built=buildQaSettlementRecoveryInstruction(params);
  const signature='1'.repeat(64);
  const message=new Transaction({feePayer:built.instruction.keys[0].pubkey,
    recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(built.instruction).compileMessage();
  const keys=message.accountKeys.map(key=>key.toBase58());
  const routerIndex=keys.indexOf(built.router.address.toBase58());
  const before=keys.map(()=>0),after=keys.map(()=>0);
  before[routerIndex]=1_188_720+742_575; after[routerIndex]=1_188_720;
  const tx={slot:42,meta:{err:null,preBalances:before,postBalances:after},
    transaction:{signatures:[signature],message}};
  let total=1_065_492n;
  const args={...params,signature,connection:{getTransaction:async()=>tx},
    verifyClaim:async()=>({verified:true,address:built.claim,categoryLamports:[594060n,74257n,14852n,4455n,2971n,14851n,37129n]}),
    verifyPolicy:async()=>({verified:true,address:built.policy.address,settledLamports:total})};
  const proof=await loadFinalizedV3Settlement(args);
  assert.equal(proof.authorization,'restricted-devnet-qa-recovery');
  assert.equal(proof.expectedLamports,'742575');
  assert.equal(message.header.numRequiredSignatures,1);
  total=742575n; assert.equal(await loadFinalizedV3Settlement(args),null); total=1065492n;
  after[routerIndex]++; assert.equal(await loadFinalizedV3Settlement(args),null); after[routerIndex]--;
  assert.equal(await loadFinalizedV3Settlement({...args,creator:Keypair.generate().publicKey}),null);
  message.instructions[0].data='1'; assert.equal(await loadFinalizedV3Settlement(args),null);
});
