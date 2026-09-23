import assert from 'node:assert/strict';
import { createReceiptEvidenceReader } from '../server/receipt-service.mjs';
import { selectReceiptCandidates } from '../server/receipt-candidates.mjs';

const signature = '3'.repeat(88), router = '2'.repeat(44), recipient = '4'.repeat(44), mint = '5'.repeat(44);
const state = { collections: { source: { cluster:'devnet', signature, status:'collected', attribution:'mint-verified', onchainVerified:true, mint, router:recipient, collectedLamports:100000 } },
  payouts: { paid: { cluster:'devnet', signature, status:'paid', source:'mint-router-settle-mint', from:router, to:recipient, amountLamports:100000, obligationId:'owned', claimId:'owned' } },
  obligations: { owned: { claimSignature:'source' } } };
const transaction = { slot:123, transaction:{signatures:[signature],message:{accountKeys:[router,recipient]}},
  meta:{err:null,preBalances:[1000000,10000],postBalances:[900000,110000]} };
let reads=0, calls=0;
const options = { cluster:'devnet', store:{readReceiptCandidates:async()=>{reads++;return selectReceiptCandidates(state,'devnet');}},
  connectionFactory:()=>({getGenesisHash:async()=>'devnet-fixture',getTransaction:async()=>{calls++;return transaction;}}), officialGenesis:async()=>'devnet-fixture' };
const read = createReceiptEvidenceReader(options);
const concurrent = await Promise.all(Array.from({length:20},()=>read()));
assert.equal(reads,1);assert.equal(calls,2);
assert.ok(concurrent.every(result=>result.status==='onchain-indexed'&&result.verifiedPayouts.length===1));
const own=await read(state);assert.equal(own.scope,'creator-recent');assert.equal(own.commitment,'confirmed');
assert.equal(calls,4);
await read(structuredClone(state));assert.equal(calls,4,'Identical scoped reads coalesce.');
const tampered=structuredClone(state);tampered.payouts.paid.amountLamports=99999;
const rejected=await read(tampered);assert.equal(rejected.status,'partial');assert.equal(rejected.verifiedPayouts.length,0);assert.equal(calls,6,'Changed payload cannot reuse previous proof.');
assert.equal((await createReceiptEvidenceReader({...options,cluster:'mainnet-beta'})()).status,'unavailable');
assert.equal((await createReceiptEvidenceReader({...options,officialGenesis:async()=>'wrong-chain'})()).status,'unavailable');
assert.equal((await createReceiptEvidenceReader({...options,officialGenesis:async()=>{throw new Error('offline');}})()).status,'unavailable');
const absent=createReceiptEvidenceReader({...options,connectionFactory:()=>({getGenesisHash:async()=>'devnet-fixture',getTransaction:async()=>null})});
assert.equal((await absent()).unavailableRecords,2);
const noRecords=createReceiptEvidenceReader({...options,connectionFactory:()=>{throw new Error('Empty state must not contact RPC');}});
assert.equal((await noRecords({})).status,'no-records');
const truncated=createReceiptEvidenceReader({...options,store:{readReceiptCandidates:async()=>{
  const selected=selectReceiptCandidates(state,'devnet');selected.coverage.recordedPayouts=100;return selected;
}}});
assert.equal((await truncated()).status,'partial','A checked window must not claim complete coverage.');

let release, entered;
const gate=new Promise(resolve=>{release=resolve;}), started=new Promise(resolve=>{entered=resolve;});
const busy=createReceiptEvidenceReader({...options,maxActive:1,officialGenesis:async()=>{entered();await gate;return 'devnet-fixture';}});
const first=busy(state);await started;
const denied=await busy(tampered);assert.equal(denied.status,'unavailable');assert.match(denied.reason,/busy/);
release();assert.equal((await first).status,'onchain-indexed');
const after=structuredClone(state);after.payouts.paid.paidAt='2026-09-21';
assert.equal((await busy(after)).status,'onchain-indexed','Active capacity is released after completion.');
console.log('Receipt service: proof checks, cache invalidation, coalescing, chain isolation, missing RPC data, partial coverage and aggregate admission limits passed (mocked RPC).');
