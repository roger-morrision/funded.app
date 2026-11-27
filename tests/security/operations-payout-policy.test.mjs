import test from 'node:test';import assert from 'node:assert/strict';
import {createOperationsPayoutPolicy} from '../../server/operations-payout-policy.mjs';

function fixture(){const state={operationsPayoutRequests:{}};
 return{state,store:{read:async()=>structuredClone(state),update:async fn=>fn(state)}};}

test('a requested operations payout cannot be claimed before an approval',async()=>{
 const {store}=fixture(),policy=createOperationsPayoutPolicy({store,env:{}});
 await policy.request({admin:'admin-a',mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:1000});
 const claimed=await policy.claim({mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:'1000'});
 assert.equal(claimed,null);
});

test('a different admin approving unlocks exactly one matching claim, consumed once',async()=>{
 const {store}=fixture(),policy=createOperationsPayoutPolicy({store,env:{}});
 const requested=await policy.request({admin:'admin-a',mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:1000});
 await policy.approve({admin:'admin-b',requestId:requested.id});
 const claimed=await policy.claim({mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:'1000'});
 assert.ok(claimed);assert.equal(claimed.status,'consumed');
 const second=await policy.claim({mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:'1000'});
 assert.equal(second,null);
});

test('the requesting admin cannot approve their own request',async()=>{
 const {store}=fixture(),policy=createOperationsPayoutPolicy({store,env:{}});
 const requested=await policy.request({admin:'admin-a',mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:1000});
 await assert.rejects(policy.approve({admin:'admin-a',requestId:requested.id}),/different admin/);
});

test('an approval only unlocks the exact mint, recipient and amount it names',async()=>{
 const {store}=fixture(),policy=createOperationsPayoutPolicy({store,env:{}});
 const requested=await policy.request({admin:'admin-a',mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:1000});
 await policy.approve({admin:'admin-b',requestId:requested.id});
 assert.equal(await policy.claim({mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:'999'}),null);
 assert.equal(await policy.claim({mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-2',amount:'1000'}),null);
 assert.equal(await policy.claim({mint:'mint-2',quoteMint:null,category:1,recipient:'recipient-1',amount:'1000'}),null);
});

test('only category 1 may use this approval flow',async()=>{
 const {store}=fixture(),policy=createOperationsPayoutPolicy({store,env:{}});
 await assert.rejects(policy.request({admin:'admin-a',mint:'mint-1',quoteMint:null,category:2,recipient:'recipient-1',amount:1000}),/category-1/);
});

test('a mint cannot have two open requests at once',async()=>{
 const {store}=fixture(),policy=createOperationsPayoutPolicy({store,env:{}});
 await policy.request({admin:'admin-a',mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:1000});
 await assert.rejects(policy.request({admin:'admin-a',mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-2',amount:500}),/already has an open/);
});

test('a cancelled request can never be approved or claimed',async()=>{
 const {store}=fixture(),policy=createOperationsPayoutPolicy({store,env:{}});
 const requested=await policy.request({admin:'admin-a',mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:1000});
 await policy.cancel({admin:'admin-a',requestId:requested.id});
 await assert.rejects(policy.approve({admin:'admin-b',requestId:requested.id}),/pending/);
 assert.equal(await policy.claim({mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:'1000'}),null);
});

test('a request above the per-request cap is rejected',async()=>{
 const {store}=fixture(),policy=createOperationsPayoutPolicy({store,env:{FUNDED_OPERATIONS_PAYOUT_MAX_LAMPORTS:'1000'}});
 await assert.rejects(policy.request({admin:'admin-a',mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:1001}),/exceeds/);
});

test('an on-chain approval can only be recorded for a consumed request, and makes it pending disbursement',async()=>{
 const {store}=fixture(),policy=createOperationsPayoutPolicy({store,env:{}});
 const requested=await policy.request({admin:'admin-a',mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:1000});
 await assert.rejects(policy.recordOnChainApproval({requestId:requested.id,withdrawalId:'ab',signature:'sig-1',creator:'creator-1'}),/consumed/);
 await policy.approve({admin:'admin-b',requestId:requested.id});
 const claimed=await policy.claim({mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:'1000'});
 const approvedOnChain=await policy.recordOnChainApproval({requestId:claimed.id,withdrawalId:'ab',signature:'sig-1',creator:'creator-1'});
 assert.equal(approvedOnChain.status,'onchain_approved');
 const pending=await policy.pendingDisbursement();
 assert.equal(pending.length,1);assert.equal(pending[0].id,claimed.id);assert.equal(pending[0].creator,'creator-1');
});

test('a disbursement can only be recorded for an on-chain-approved request, and clears it from pending',async()=>{
 const {store}=fixture(),policy=createOperationsPayoutPolicy({store,env:{}});
 const requested=await policy.request({admin:'admin-a',mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:1000});
 await assert.rejects(policy.recordOnChainDisbursement({requestId:requested.id,signature:'sig-2'}),/on-chain-approved/);
 await policy.approve({admin:'admin-b',requestId:requested.id});
 const claimed=await policy.claim({mint:'mint-1',quoteMint:null,category:1,recipient:'recipient-1',amount:'1000'});
 await policy.recordOnChainApproval({requestId:claimed.id,withdrawalId:'ab',signature:'sig-1',creator:'creator-1'});
 const disbursed=await policy.recordOnChainDisbursement({requestId:claimed.id,signature:'sig-2'});
 assert.equal(disbursed.status,'onchain_disbursed');
 assert.equal((await policy.pendingDisbursement()).length,0);
});
