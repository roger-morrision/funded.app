import test from 'node:test';
import assert from 'node:assert/strict';
import {approveCreatorPayoutBatch,creatorActionPath,creatorPayoutActions} from '../src/features/fees/creator-payout-actions.js';
test('a missing frozen referral beneficiary is excluded from payable approval batches',()=>{
 const row={settlement:'finalized',referralPayable:[true,false,false],allocationPlan:{status:'allocated-not-funded',
  creatorDirected:{holderLamports:'0',xLamports:'0'},protocol:{referralLamports:['60','25','15']}}};
 const actions=creatorPayoutActions(row).filter(action=>action.action.startsWith('referral-payout/'));
 assert.deepEqual(actions.map(action=>action.amount),['60','0','0']);
});
test('batch approves independent payouts once, stops at uncertain result, and refreshes partial progress',async()=>{
 const submitted=[],messages=[];let signs=0;
 const tx={serialize:()=>new Uint8Array([1])},session={address:'creator',provider:{signAllTransactions:async rows=>{signs++;return rows;}}};
 const state={getCoinMintAddress:()=> 'mint',captureWalletSession:()=>session,currentCoinFeeOverview:{creatorWallet:'creator'},creatorClaimsInFlight:new Set(),
 getSolana:async()=>({Transaction:{from:()=>tx}}),base64ToBytes:()=>new Uint8Array(),bytesToBase64:()=> 'signed',
 assertWalletSessionCurrent(){},isWalletSessionCurrent:()=>true,showToast:msg=>messages.push(msg),renderCoinFeeDashboard(){},
 apiRequest:async(path,options={})=>{
 if(path.endsWith('/fee-activity'))return {available:true,data:{overview:{}}};
 if(options.body.creatorSignedTransaction){submitted.push(path);return {data:{status:submitted.length===1?'finalized':'verification-pending'}};}
 return {available:true,data:{mint:'mint',collectionSignature:'source',recipient:'recipient',transaction:'unsigned',status:'awaiting-creator-signature'}};
 }};
 await approveCreatorPayoutBatch(state,{textContent:'Batch',isConnected:true},['community-funding','operations-payout','referral-payout/1'].map(action=>({action,source:'source'})));
 assert.equal(signs,1);assert.equal(submitted.length,2);assert.match(messages[0],/1 payouts finalized.*reconciliation/);assert.equal(state.creatorClaimsInFlight.size,0);
 assert.equal(creatorActionPath('mint','source','referral-payout/1'),'/api/tokens/mint/v3-referral-payout/source/1');
});
