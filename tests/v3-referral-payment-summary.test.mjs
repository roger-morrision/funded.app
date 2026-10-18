import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { v3ReferralPaymentSummary } from '../server/v3-referral-payment-summary.mjs';
import { v3PublicMetrics } from '../server/v3-public-metrics.mjs';
const [mint, creator, recipient, programId, authority, withdrawal] = Array.from({length:6},()=>Keypair.generate().publicKey.toBase58());
const source='3'.repeat(64), settlementSignature='4'.repeat(64), signature='5'.repeat(64);
function fixture() {
 const row={status:'finalized',collectionSignature:source,mint,recipient,programId,category:2,level:1,amount:'6459',signature,balanceDeltaVerified:true,protectedPolicy:true};
 const state={v3ReferralPayouts:{[`${source}:1`]:row},launches:{[mint]:{mint,creatorWallet:creator,cluster:'devnet',onchainVerified:true,pumpFeeRoute:{scope:'per-mint-v3',programId,initialAuthority:authority}}},
  collections:{[source]:{signature:source,mint,cluster:'devnet',scope:'per-mint-v3',programId,status:'collected',onchainVerified:true}},
  v3Settlements:{[source]:{collectionSignature:source,mint,status:'finalized',settlementSignature,referralUpline:[recipient],allocationPlan:{status:'allocated-not-funded',protocol:{referralLamports:['6459','1937','1292']}}}}};
 const proof={signature,mint,recipient,programId,category:2,amount:'6459',slot:42,balanceDeltaVerified:true,withdrawal};
 const calls=[];
 return {state,row,proof,calls,args:{state,cluster:'devnet',connection:{getTransaction:async()=>({transaction:{message:{accountKeys:[authority]}}})},loadFunding:async input=>{calls.push(input);return proof;}}};
}
test('verified V3 referrals enter public aggregate totals without private recipient or attribution fields',async()=>{
 const f=fixture(), summary=await v3ReferralPaymentSummary(f.args);
 assert.deepEqual(summary,{status:'verified',paidLamports:'6459',payoutCount:1,checkedCount:1,unavailableCount:0});
 assert.equal(f.calls[0].protectedPolicy,true); assert.equal(f.calls[0].beneficiary,4);
 assert.equal(JSON.stringify(summary).includes(recipient),false);
 const history={cluster:'devnet',commitment:'finalized',status:'onchain-indexed',verifiedPayouts:[],referralSummary:summary};
 const metrics=v3PublicMetrics({}, {cluster:'devnet',commitment:'finalized',status:'no-records'},history,{},'devnet');
 assert.equal(metrics.referralPaidLamports,6459);assert.equal(metrics.referralPayoutCount,1);
 assert.equal(metrics.finalizedPaidLamports,6459);assert.equal(metrics.verifiedPayoutCount,1);
});
test('forged entitlements, wrong mint, category, amount or source never enter totals',async()=>{
 for(const change of [{recipient:creator},{category:3},{amount:'6460'},{programId:creator},{collectionSignature:signature},{level:2},{balanceDeltaVerified:false}]){
  const f=fixture();Object.assign(f.row,change);
  const summary=await v3ReferralPaymentSummary(f.args);
  assert.equal(summary.status,'partial');assert.equal(summary.paidLamports,'0');assert.equal(f.calls.length,0);
 }
});
test('missing or mismatched finalized funding proof remains partial',async()=>{
 for(const change of [{signature:source},{amount:'1'},{balanceDeltaVerified:false},{withdrawal:null}]){
  const f=fixture();Object.assign(f.proof,change);const summary=await v3ReferralPaymentSummary(f.args);
  assert.equal(summary.status,'partial');assert.equal(summary.payoutCount,0);
 }
 const f=fixture();f.args.loadFunding=async()=>null;
 assert.equal((await v3ReferralPaymentSummary(f.args)).paidLamports,'0');
});
test('proof cache is invalidated by a changed entitlement or receipt',async()=>{
 const f=fixture();f.args.proofCache=new Map();
 await v3ReferralPaymentSummary(f.args);await v3ReferralPaymentSummary(f.args);assert.equal(f.calls.length,1);
 f.row.amount='1';assert.equal((await v3ReferralPaymentSummary(f.args)).status,'partial');
});
test('unavailable referral verification is not represented as a verified zero',()=>{
 const result=v3PublicMetrics({}, {},{cluster:'devnet',commitment:'finalized',verifiedPayouts:[],referralSummary:{status:'unavailable',paidLamports:'0',payoutCount:0}}, {}, 'devnet');
 assert.equal(result.referralPaidLamports,null);assert.equal(result.referralPayoutCount,null);
});
