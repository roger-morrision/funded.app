import test from 'node:test';
import assert from 'node:assert/strict';
import {financialRows} from '../src/features/experience/financial-model.js';
import {creatorRewardRow} from '../creator-reward-model.js';
const mint='So11111111111111111111111111111111111111112',wallet='11111111111111111111111111111111',sig='3'.repeat(64),program='4'.repeat(32);
const overview=()=>({available:true,scope:'per-mint-v3',mint,creatorWallet:wallet,gates:{settlement:true,creatorWalletPayout:true},collections:[{
 signature:sig,amountLamports:'1000',settlement:'pending'}]});
test('automatic settlement is processing, never an available creator approval',()=>{
 const row=overview();row.automaticSettlementEnabled=true;
 const automatic=financialRows({overviews:[row],wallet})[0];assert.equal(automatic.stage,'Processing');assert.equal(automatic.ready,false);assert.match(automatic.detail,/no creator signature/);
 row.automaticSettlementEnabled=false;const manual=financialRows({overviews:[row],wallet})[0];assert.equal(manual.stage,'Awaiting approval');assert.equal(manual.ready,true);
});
test('automatic funding and payout remain unverified until exact payment evidence',()=>{
 const row=overview();row.automaticDisbursementEnabled=true;
 row.collections[0]={...row.collections[0],settlement:'finalized',allocationPlan:{status:'allocated-not-funded',mint,programId:program,sourceCollectionSignature:sig,
  creatorDirected:{walletLamports:'800',holderLamports:'0',xLamports:'0'},protocol:{communityLamports:'0',operationsLamports:'0'}}};
 const rows=financialRows({overviews:[row],wallet});assert.equal(rows.length,1);assert.equal(rows[0].stage,'Processing');assert.equal(rows[0].ready,false);
 const launch={mint,creatorWallet:wallet,onchainVerified:true,cluster:'devnet',pumpFeeRoute:{scope:'per-mint-v3',programId:program,router:mint},creator:mint};
 const reward=creatorRewardRow(launch,{mint,cluster:'devnet',overview:row},wallet,'devnet');assert.equal(reward.unclaimed,800n);assert.equal(reward.paid,0n);assert.equal(reward.ready,false);assert.equal(reward.status,'Automatic payout pending');
 row.automaticDisbursementEnabled=false;assert.equal(creatorRewardRow(launch,{mint,cluster:'devnet',overview:row},wallet,'devnet').ready,true);
 row.collections[0].creatorWalletPayoutVerified=true;
 assert.equal(creatorRewardRow(launch,{mint,cluster:'devnet',overview:row},wallet,'devnet').paid,800n);
});
