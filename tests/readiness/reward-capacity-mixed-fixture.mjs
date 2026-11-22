import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey,Transaction} from '@solana/web3.js';
import {getAssociatedTokenAddressSync} from '@solana/spl-token';
import {signedCapacityCohort} from './reward-capacity-fixture.mjs';
import {requirePayoutAttempt} from '../../server/reward-payout-journal.mjs';
import {completedRewardPayment} from '../../server/reward-paid-record.mjs';

// Synthetic transaction-local bank effects, NOT SBF execution or consensus proof.
// Actual production parsers/journal must derive completion from these facts;
// no hand-authored verified flag/proof is used as a capacity input.
export function installCapacityBank(c){
  const {f}=c;f.capacityTransactions=new Map();f.capacityProofAvailable=true;
  f.connection.getTransaction=async signature=>f.capacityProofAvailable?f.capacityTransactions.get(signature)||null:null;
  f.connection.getSignatureStatuses=async signatures=>({context:{slot:f.slot},value:signatures.map(signature=>{
    const tx=f.capacityTransactions.get(signature);return tx?{slot:tx.slot,err:tx.meta.err,confirmationStatus:'finalized'}:null;
  })});
}

export function landCapacityLeaf(c,leaf){
  const {f,plan,options}=c,attempt=plan.payoutAttempts[leaf.recipient];assert(f.capacityTransactions instanceof Map);
  requirePayoutAttempt(attempt,{...options,plan,leaf});assert(!f.capacityTransactions.has(attempt.signature));
  const tx=Transaction.from(Buffer.from(attempt.transactionBase64,'base64')),message=tx.compileMessage(),sol=plan.asset==='SOL';
  const payment=attempt.before.payment;assert(!f.rows.has(payment));
  const balance=a=>f.rows.get(String(a))?.lamports??f.balances.get(String(a))??0;
  const pre=message.accountKeys.map(balance),preTokens=new Map(f.tokens),amount=BigInt(leaf.amount);
  const operator=String(f.operator),cost=attempt.before.feeLamports+attempt.before.receiptRentLamports;
  let deposit=0;
  if(sol){f.rows.get(String(f.vault)).lamports-=Number(amount);f.balances.set(leaf.recipient,balance(leaf.recipient)+Number(amount));}
  else{
    const destination=getAssociatedTokenAddressSync(new PublicKey(plan.asset),new PublicKey(leaf.recipient),false,f.tokenProgram);
    assert(!f.tokens.has(String(destination)));deposit=attempt.before.tokenRentLamports;
    f.tokens.set(String(f.vaultToken),f.tokens.get(String(f.vaultToken))-amount);f.tokens.set(String(destination),amount);
    f.balances.set(String(destination),deposit);
  }
  f.balances.set(operator,balance(operator)-cost-deposit);
  const cycle=f.rows.get(String(f.cycle)).data,reserve=f.rows.get(String(f.reserve)).data;
  cycle.writeBigUInt64LE(cycle.readBigUInt64LE(144)+amount,144);reserve.writeBigUInt64LE(reserve.readBigUInt64LE(72)-amount,72);
  const receipt=Buffer.alloc(100);createHash('sha256').update('account:RewardPayment').digest().subarray(0,8).copy(receipt);
  f.cycle.toBuffer().copy(receipt,8);new PublicKey(leaf.recipient).toBuffer().copy(receipt,40);
  receipt.writeBigUInt64LE(amount,72);receipt.writeUInt32LE(leaf.index,80);receipt.writeBigInt64LE(BigInt(plan.payoutAt+10),84);receipt.writeBigUInt64LE(amount,92);
  f.rows.set(payment,{owner:f.program,executable:false,lamports:attempt.before.receiptRentLamports,data:receipt});
  const post=message.accountKeys.map(balance),tokenRows=values=>message.accountKeys.flatMap((a,accountIndex)=>values.has(String(a))?
    [{accountIndex,mint:plan.asset,uiTokenAmount:{amount:String(values.get(String(a)))}}]:[]);
  assert.equal(pre.reduce((n,v,i)=>n+BigInt(v)-BigInt(post[i]),0n),BigInt(attempt.before.feeLamports));
  const result={slot:f.slot,blockTime:plan.payoutAt+10,transaction:{signatures:[attempt.signature],message},meta:{err:null,fee:attempt.before.feeLamports,
    preBalances:pre,postBalances:post,preTokenBalances:tokenRows(preTokens),postTokenBalances:tokenRows(f.tokens)}};
  f.capacityTransactions.set(attempt.signature,result);return result;
}

export async function mixedCapacityCohort({count,assetName,verifiedStride=2}){
  assert(Number.isSafeInteger(verifiedStride)&&verifiedStride>=2&&verifiedStride<=32,'Bounded mixed proof stride required.');
  const c=await signedCapacityCohort({count,assetName}),{plan,f}=c;plan.periodStart=plan.cutoffAt-3600;installCapacityBank(c);
  const state={schedules:{[plan.id]:plan}},staging={read:async()=>state,transaction:async mutate=>mutate(state)};
  let verified=0,distributed=0n;const started=performance.now();
  for(const leaf of plan.manifest.leaves)if(leaf.index%verifiedStride===0){
    landCapacityLeaf(c,leaf);const proof=await c.chain.submitLeaf(plan,leaf,{store:staging,recoveryOnly:true});
    assert(proof.payoutTransactionVerified&&plan.payoutAttempts[leaf.recipient].state==='verified');
    plan.payments[leaf.recipient]=completedRewardPayment(undefined,leaf,proof).record;
    plan.payments[leaf.recipient].capacityMetadata='preserve';verified++;distributed+=BigInt(leaf.amount);
  }
  assert.equal(f.sends,count);assert.equal(f.latestCalls,count);
  assert.equal(f.rows.get(String(f.cycle)).data.readBigUInt64LE(144),distributed);
  assert.equal(f.rows.get(String(f.reserve)).data.readBigUInt64LE(72),BigInt(plan.manifest.totalAmount)+41n-distributed);
  c.mixedProfile={verified,prepared:count-verified,distributed:String(distributed),retainedLiability:String(BigInt(plan.manifest.totalAmount)+41n-distributed),
    verificationMs:performance.now()-started,planBytes:Buffer.byteLength(JSON.stringify(plan)),
    proofBytes:Buffer.byteLength(JSON.stringify(Object.values(plan.payoutAttempts).filter(a=>a.state==='verified').map(a=>a.proof)))};
  return c;
}
