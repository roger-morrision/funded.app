import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { createRewardBatchSubmitter, rewardBatchTransaction, rewardPayoutGroups } from '../server/reward-batch.mjs';
import { verifyRewardBatch } from '../server/reward-batch-proof.mjs';
import { payRewardSchedule } from '../server/reward-schedule-payments.mjs';
import { payDailyBonusLeaves } from '../server/daily-bonus-payments.mjs';
import { dailyBonusTransactionProof } from '../server/daily-bonus-payment-history.mjs';
import { rewardAddresses, rewardReserveAddress } from '../server/automatic-reward-chain.mjs';
import { buildRewardManifest } from '../reward-merkle.js';
import { createHash } from 'node:crypto';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';

const authority = Keypair.generate(), blockhash = Keypair.generate().publicKey.toBase58();
const leaves = Array.from({length:9}, (_, index) => ({ recipient:Keypair.generate().publicKey.toBase58(), amount:'10000', index }));
const row = leaf => ({ leaf, recipient:Keypair.fromSeed(new Uint8Array(32).fill(leaf.index+1)).publicKey,
  transaction:new Transaction().add(SystemProgram.transfer({fromPubkey:authority.publicKey,
    toPubkey:Keypair.generate().publicKey,lamports:10000})) });
function harness(options = {}) {
  const sends = [], simulations = [];
  const connection = { getLatestBlockhash:async()=>({blockhash}), simulateTransaction:async tx=> {
    const size=tx.message.compiledInstructions.length-1; simulations.push(size);
    return {value:{err:size>(options.simulationMax || 4)?{InstructionError:[0,'failed']}:null,unitsConsumed:options.units || 100000}};
  }};
  const submit = createRewardBatchSubmitter({cluster:options.cluster || 'devnet',connection,authority,
    prepareLeaf:options.prepareLeaf || (async(plan, leaf)=>row(leaf)), inspectLeaf:async()=>null,
    send:async tx=>{sends.push(tx.instructions.length-1);if(options.sendError)throw Error('unknown submission');return 'sig';},
    verify:async({rows})=>rows.map(()=>({finalized:true,balanceDeltaVerified:true}))});
  return {submit,sends,simulations};
}
test('four recipients share one signature and bounded serialized transaction',async()=>{
  const h=harness();const out=await h.submit({},leaves.slice(0,4));
  assert.deepEqual(h.sends,[4]);assert.equal(out.length,4);assert(out.every(row=>row.result.finalized));
  const tx=rewardBatchTransaction(leaves.slice(0,4).map(row),authority.publicKey,blockhash);
  assert.equal(tx.compileMessage().header.numRequiredSignatures,1);
  assert(tx.serialize({requireAllSignatures:false,verifySignatures:false}).length<=1200);
});
test('oversized proofs split before signing',async()=>{
  const h=harness({prepareLeaf:async(plan,leaf)=>{const r=row(leaf);r.transaction.instructions[0].data=Buffer.alloc(450);return r;}});
  const out=await h.submit({},leaves.slice(0,4));assert(out.every(row=>row.result));assert.deepEqual(h.sends,[2,2]);
});
test('simulation failure splits without sending the failing group',async()=>{
  const h=harness({simulationMax:2});await h.submit({},leaves.slice(0,4));assert.deepEqual(h.sends,[2,2]);
});
test('unknown send outcome never triggers fallback resubmission',async()=>{
  const h=harness({sendError:true});const out=await h.submit({},leaves.slice(0,4));
  assert.deepEqual(h.sends,[4]);assert(out.every(row=>row.error));
});
test('excessive compute never signs even single-recipient attempts',async()=>{
  const h=harness({units:600000});const out=await h.submit({},leaves.slice(0,4));
  assert.equal(h.sends.length,0);assert(out.every(row=>row.error));
});
test('already paid and invalid recipients do not block valid payouts',async()=>{
  const h=harness({prepareLeaf:async(plan,leaf)=>{
    if(leaf.index===0)return{paid:{alreadyPaid:true,finalized:true}};
    if(leaf.index===1)throw Error('bad proof');return row(leaf);
  }});const out=await h.submit({},leaves.slice(0,4));assert(out[0].result.alreadyPaid);assert(out[1].error);assert.deepEqual(h.sends,[2]);
});
test('Mainnet, oversized and duplicate input fail before signing',async()=>{
  await assert.rejects(harness({cluster:'mainnet-beta'}).submit({},leaves.slice(0,2)),/Devnet only/);
  await assert.rejects(harness().submit({},leaves.slice(0,5)),/bounded/);
  await assert.rejects(harness().submit({},[leaves[0],leaves[0]]),/distinct/);
});
test('automatic groups bounded at four; manual and Mainnet retain single path',async()=>{
  for(const [cluster,batch,expected]of [['devnet',true,[4,4,1]],['devnet',false,Array(9).fill(1)],['mainnet-beta',true,Array(9).fill(1)]]){
    const sizes=[],chain={cluster,submitLeaves:async(p,l)=>sizes.push(l.length),submitLeaf:async()=>sizes.push(1)};
    for await(const group of rewardPayoutGroups({chain,plan:{},leaves,batch}))await group.submit();
    assert.deepEqual(sizes,expected);
  }
});
test('scheduler records every batch recipient and retry skips finalized recipients',async()=>{
  const plan={id:'p',manifest:{leaves:leaves.slice(0,4)}},state={schedules:{p:{payments:{}}}},store={transaction:async fn=>fn(state)};
  let calls=0;const chain={cluster:'devnet',submitLeaves:async(p,l)=>{calls++;return l.map(leaf=>({leaf,result:{signature:'sig',payment:'p'+leaf.index,finalized:true,balanceDeltaVerified:true,amountReceived:leaf.amount}}));}};
  assert.equal(await payRewardSchedule({store,chain,plan,batch:true}),4);
  assert.equal(await payRewardSchedule({store,chain,plan,batch:true}),0);assert.equal(calls,1);assert.equal(Object.keys(state.schedules.p.payments).length,4);
});
test('daily bonus checks pause before sending a batch',async()=>{
  const state={dailyBonusSnapshots:{day:{status:'paused',snapshot:{hash:'h'},payouts:{source:{payments:{}}}}}};
  await assert.rejects(payDailyBonusLeaves({chain:{cluster:'devnet',submitLeaves:async()=>assert.fail('must not send')},
    plan:{manifest:{leaves:leaves.slice(0,2)}},readLedger:async()=>state,rewardStore:{},day:'day',source:{collectionSignature:'source'},snapshot:{hash:'h'}}),/paused/);
});
function proofFixture() {
  const vault=Keypair.generate().publicKey,recipient=Keypair.generate().publicKey,payment=Keypair.generate().publicKey;
  const keys=[authority.publicKey,vault,recipient,payment],signature='signature';
  const tx={slot:123,meta:{err:null,fee:5000,preBalances:[100000,50000,1000,0],postBalances:[90000,40000,11000,5000]},
    transaction:{signatures:[signature],message:{header:{numRequiredSignatures:1},accountKeys:keys}}};
  const leaf={amount:'10000',recipient:recipient.toBase58()},rows=[{leaf,vault,recipient,payment}];
  return {tx,args:{connection:{getTransaction:async()=>tx},authority:authority.publicKey,plan:{manifest:{asset:'SOL'}},rows,signature,
    inspectLeaf:async()=>({payment:payment.toBase58(),amountReceived:'10000'})}};
}
test('batch proof requires exact vault debit, recipient credit and newly created receipt',async()=>{
  const {tx,args}=proofFixture();assert.equal((await verifyRewardBatch(args))[0].batch.feeLamports,'5000');
  tx.meta.postBalances[2]++;await assert.rejects(verifyRewardBatch(args),/recipient credit/);tx.meta.postBalances[2]--;
  tx.meta.postBalances[1]++;await assert.rejects(verifyRewardBatch(args),/vault debit/);tx.meta.postBalances[1]--;
  tx.meta.preBalances[3]=1;await assert.rejects(verifyRewardBatch(args),/payment receipt/);
});
test('token batch verifies gross vault debit and net token credits',async()=>{
  const {tx,args}=proofFixture(),mint=Keypair.generate().publicKey.toBase58();args.plan.manifest.asset=mint;
  const r=args.rows[0];r.vaultTokenAddress=r.vault;r.recipientTokenAddress=r.recipient;
  tx.meta.preTokenBalances=[{accountIndex:1,mint,uiTokenAmount:{amount:'50000'}}];
  tx.meta.postTokenBalances=[{accountIndex:1,mint,uiTokenAmount:{amount:'40000'}},{accountIndex:2,mint,uiTokenAmount:{amount:'9900'}}];
  args.inspectLeaf=async()=>({payment:r.payment.toBase58(),amountReceived:'9900'});
  assert.equal((await verifyRewardBatch(args))[0].amountReceived,'9900');
  tx.meta.postTokenBalances[1].uiTokenAmount.amount='9899';await assert.rejects(verifyRewardBatch(args),/recipient credit/);
});
test('daily bonus history verifies aggregate batch debit without dropping recipients',()=>{
  const program=Keypair.generate().publicKey,mint=Keypair.generate().publicKey.toBase58();
  const manifest=buildRewardManifest({cycleId:'12'.repeat(32),allocations:leaves.slice(0,3)});
  const addresses=manifest.leaves.map(leaf=>rewardAddresses({programId:program,authority:authority.publicKey,mint,cycleId:manifest.cycleId,recipient:leaf.recipient}));
  const reserve=rewardReserveAddress({programId:program,vault:addresses[0].vault,asset:'SOL'});
  const instructions=manifest.leaves.map((leaf,i)=>{
    const data=Buffer.alloc(24);createHash('sha256').update('global:payout_reward_sol').digest().copy(data,0,0,8);
    data.writeBigUInt64LE(BigInt(leaf.amount),8);data.writeUInt32LE(leaf.index,16);data.writeUInt32LE(leaf.proof.length,20);
    return new TransactionInstruction({programId:program,keys:[authority.publicKey,addresses[i].vault,reserve,addresses[i].cycle,new PublicKey(leaf.recipient),addresses[i].payment,SystemProgram.programId].map((pubkey,index)=>({pubkey,isSigner:index===0,isWritable:index!==6})),data:Buffer.concat([data,...leaf.proof.map(x=>Buffer.from(x,'hex'))])});
  });
  const message=new Transaction({feePayer:authority.publicKey,recentBlockhash:blockhash}).add(...instructions).compileMessage(),keys=message.accountKeys.map(x=>x.toBase58());
  const pre=keys.map(()=>100000),post=[...pre];post[keys.indexOf(addresses[0].vault.toBase58())]-=30000;
  manifest.leaves.forEach((leaf,i)=>{post[keys.indexOf(leaf.recipient)]+=10000;const p=keys.indexOf(addresses[i].payment.toBase58());pre[p]=0;post[p]=1000;});
  const tx={slot:123,blockTime:123,transaction:{signatures:['sig'],message},meta:{err:null,fee:5000,preBalances:pre,postBalances:post}};
  for(let i=0;i<3;i++)assert(dailyBonusTransactionProof(tx,'sig',{leaf:manifest.leaves[i],manifest,snapshot:{day:'day'},source:{mint}},program.toBase58(),{...addresses[i],reserve}));
  post[keys.indexOf(addresses[0].vault.toBase58())]--;
  assert.equal(dailyBonusTransactionProof(tx,'sig',{leaf:manifest.leaves[0],manifest,snapshot:{day:'day'},source:{mint}},program.toBase58(),{...addresses[0],reserve}),null);
});
