import test from 'node:test';
import assert from 'node:assert/strict';
import {buybackExecutionPolicy,buybackAgeEligible,remainingBuybackDailyBudget} from '../server/v3-buyback-execution-policy.mjs';
import {expiredTransactionAbsent} from '../server/expired-transaction-recovery.mjs';
import {estimateBuybackComputeBudget} from '../server/buyback-compute-budget.mjs';
import {Keypair} from '@solana/web3.js';
test('age execution is explicit, economically bounded, and requires an old finalized settlement',()=>{
 const p=buybackExecutionPolicy({FUNDED_V3_BUYBACK_MAX_WAIT_SECONDS:'3600'}),now=86400000;
 const state={v3Settlements:{source:{status:'finalized',finalizedAt:new Date(now-3600000).toISOString()}}};
 assert.equal(buybackAgeEligible(state,{sourceCollectionSignature:'source',amountLamports:'10000000'},p,now),true);
 assert.equal(buybackAgeEligible(state,{sourceCollectionSignature:'source',amountLamports:'9999999'},p,now),false);
 assert.equal(buybackAgeEligible(state,{sourceCollectionSignature:'source',amountLamports:'10000000'},buybackExecutionPolicy({}),now),false);
 assert.throws(()=>buybackExecutionPolicy({FUNDED_V3_BUYBACK_MAX_WAIT_SECONDS:'1'}));
});
test('daily cap reserves pending maximum debits and counts only verified finalized spend',()=>{
 const p=buybackExecutionPolicy({FUNDED_V3_BUYBACK_DAILY_CAP_LAMPORTS:'100000'}),state={v3BuybackOrders:{a:{programId:'p',signature:'s',maxTotalDebit:'30000',status:'verification-pending'},b:{programId:'p',signature:'b',status:'finalized',finalized:true,vaultDebitVerified:true,burnInstructionVerified:true,spentLamports:'20000',finalizedAt:new Date(86400001).toISOString()}}};
 assert.equal(remainingBuybackDailyBudget(state,'p',p,86400002),50000n);
 state.v3BuybackOrders.b.vaultDebitVerified=false;assert.throws(()=>remainingBuybackDailyBudget(state,'p',p,86400002));
});
test('expired retry requires expiry, absent signature, transaction and immutable receipt',async()=>{
 const row={signature:'s',blockhash:'hash',lastValidBlockHeight:100,receiptAddress:Keypair.generate().publicKey.toBase58()};
 const connection={getBlockHeight:async()=>101,isBlockhashValid:async()=>({value:false}),getSignatureStatuses:async()=>({value:[null]}),getTransaction:async()=>null,getAccountInfo:async()=>null};
 assert.equal(await expiredTransactionAbsent(connection,row),true);
 for(const changed of [{getBlockHeight:async()=>100},{getAccountInfo:async()=>({data:Buffer.alloc(1)})},{getSignatureStatuses:async()=>({value:[{confirmationStatus:'processed'}]})},{getTransaction:async()=>({slot:1})}])assert.equal(await expiredTransactionAbsent({...connection,...changed},row),false);
 assert.equal(await expiredTransactionAbsent(connection,{...row,lastValidBlockHeight:undefined}),false);
});
test('simulation sets compute headroom and caps requested priority fees exactly',async()=>{
 const c={simulateTransaction:async()=>({value:{err:null,unitsConsumed:200000}}),getRecentPrioritizationFees:async()=>[{prioritizationFee:999999999}]};
 const tx={message:{staticAccountKeys:[],isAccountWritable:()=>true}};
 const result=await estimateBuybackComputeBudget(c,tx,{maxPriorityLamports:10000});
 assert.equal(result.computeUnitLimit,230000);assert(Math.ceil(result.computeUnitLimit*result.computeUnitPriceMicroLamports/1e6)<=10000);
 await assert.rejects(estimateBuybackComputeBudget({...c,simulateTransaction:async()=>({value:{err:{}}})},tx),/simulation/);
});
