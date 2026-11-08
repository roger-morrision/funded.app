import test from 'node:test';
import {PublicKey} from '@solana/web3.js';
import assert from 'node:assert/strict';
import {createPaymentHistoryLoader} from '../src/features/payments/history-loader.js';
import {createExploreRegistryController} from '../src/app/controllers/explore-registry.js';
import {createPaymentHistoryReader} from '../server/payment-history.mjs';
import {filterPaymentHistory} from '../src/features/payments/receipt-view.js';
const row={signature:'2'.repeat(64),to:'3'.repeat(32),source:'v3-referral',amountLamports:12,actualReceivedLamports:12};
const data={cluster:'devnet',status:'onchain-indexed',verifiedPayouts:[row],generatedAt:'2026-11-08T00:00:00Z'};
const app=apiRequest=>({apiRequest,EXPLORE_CLUSTER:'devnet',paymentHistoryEvidence:null,renderVerifiedReceiptEvidence(){this.renders=(this.renders||0)+1;}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('failed refresh retains only same-network verified history, marked stale; retry replaces it',async()=>{
 let fail=false;const state=app(async()=>{if(fail)throw Error('offline');return {available:true,data};});const load=createPaymentHistoryLoader(state);
 await load();fail=true;await load();assert.equal(state.paymentHistoryEvidence.status,'partial');assert.equal(state.paymentHistoryEvidence.refreshFailed,true);
 assert.deepEqual(state.paymentHistoryEvidence.verifiedPayouts,[row]);assert.equal(state.paymentHistoryEvidence.generatedAt,data.generatedAt);
 fail=false;await load();assert.equal(state.paymentHistoryEvidence.refreshFailed,undefined);
 fail=true;state.EXPLORE_CLUSTER='mainnet-beta';await load();assert.deepEqual(state.paymentHistoryEvidence.verifiedPayouts,[]);
});
test('initial failure is unavailable, concurrent retries share one request, and cancellation publishes nothing',async()=>{
 let calls=0;const wait=deferred(),state=app(async()=>{calls++;await wait.promise;throw Error('offline');});const load=createPaymentHistoryLoader(state);
 const a=load(),b=load();assert.equal(a,b);wait.resolve();await a;assert.equal(calls,1);assert.equal(state.paymentHistoryEvidence.status,'unavailable');
 const stop=new AbortController();const saved=state.paymentHistoryEvidence;state.apiRequest=async()=>{stop.abort();return {available:true,data};};await load(stop.signal);assert.equal(state.paymentHistoryEvidence,saved);
});
test('payment results render before an unrelated analytics request completes',async()=>{
 const wait=deferred(),state=app(async path=>path==='/api/evidence/payment-history'?{available:true,data}:wait.promise);
 Object.assign(state,{assets:[],renderExplorePayoutStats(){},renderOnchainReportState(){},renderHomeKpiDashboard(){}});
 const controller=createExploreRegistryController(state),flight=controller.loadReceiptEvidence();await new Promise(r=>setImmediate(r));
 assert.deepEqual(state.paymentHistoryEvidence,data);assert.equal(state.renders,1);assert.equal(state.receiptEvidenceLoading,true);
 wait.resolve(null);await flight;assert.equal(state.receiptEvidenceLoading,false);
});
test('request timeout does not strand subsequent refreshes',async()=>{
 const state=app((_path,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
 const load=createPaymentHistoryLoader(state,{timeoutMs:10});const keepAlive=setTimeout(()=>{},1000);
 try{await load();assert.equal(state.paymentHistoryEvidence.status,'unavailable');state.apiRequest=async()=>({available:true,data});await load();assert.equal(state.paymentHistoryEvidence.status,'onchain-indexed');}finally{clearTimeout(keepAlive);}
});
test('V3 history includes verified referral receipts without waiting on legacy evidence',async()=>{
 const key=n=>new PublicKey(new Uint8Array(32).fill(n)).toBase58();
 const mint=key(4),recipient=key(3),programId=key(5),authority=key(6),source='7'.repeat(64),sig='2'.repeat(64);
 const route={scope:'per-mint-v3',programId,initialAuthority:authority,protocolSplit:{}};
 const payment={status:'finalized',collectionSignature:source,level:1,signature:sig,mint,recipient,amount:'12',category:2,programId,balanceDeltaVerified:true};
 const state={launches:{[mint]:{cluster:'devnet',onchainVerified:true,creatorWallet:authority,pumpFeeRoute:route}},collections:{[source]:{signature:source,mint,cluster:'devnet',scope:'per-mint-v3',programId,status:'collected',onchainVerified:true}},v3Settlements:{[source]:{status:'finalized',mint,collectionSignature:source,settlementSignature:'8'.repeat(64),referralUpline:[recipient],allocationPlan:{status:'allocated-not-funded',protocol:{referralLamports:['12','0','0']}}}},v3ReferralPayouts:{[source+':1']:payment}};
 const read=createPaymentHistoryReader({v3Only:true,cluster:'devnet',readEvidence:()=>{throw Error('Legacy scan must not run');},rewardsStore:{read:async()=>({})},store:{read:async()=>state},connectionFactory:()=>({getGenesisHash:async()=>'devnet',getTransaction:async()=>({transaction:{message:{accountKeys:[authority]}}})}),officialGenesis:async()=>'devnet',loadReferralPayment:async()=>({signature:sig,recipient,mint,programId,category:2,amount:'12',balanceDeltaVerified:true,slot:123,withdrawal:'9'.repeat(32),feePayer:authority,feeLamports:5000,blockTime:123456})});
 const result=await read();assert.equal(result.verifiedPayouts.length,1);assert.equal(result.checkedReferral,1);assert.equal(result.payoutCoverage.verified,1);
 assert.equal(result.verifiedPayouts[0].source,'v3-referral');assert.equal(filterPaymentHistory(result.verifiedPayouts,{type:'referral'}).length,1);
});
