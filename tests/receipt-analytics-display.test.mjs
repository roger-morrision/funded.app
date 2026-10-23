import test from 'node:test';
import assert from 'node:assert/strict';
import { renderVerifiedReceiptEvidence } from '../src/features/payments/receipt-view.js';
function render(evidence,summary=null){
  const fields={span:{textContent:''},strong:{textContent:'—'},small:{innerHTML:''}};
  const card={querySelector:key=>fields[key]};
  const document={querySelectorAll:()=>[],querySelector:key=>key==='[data-analytics-metric="fees"]'?card:null};
  renderVerifiedReceiptEvidence({receiptEvidence:evidence,paymentHistoryEvidence:null,analyticsSummary:summary,receiptEvidenceChecked:true}, { document });
  return fields;
}
test('verified collection total preserves lamports when safe individual amounts exceed safe aggregate precision',()=>{
  const result=render({status:'onchain-indexed',verifiedCollections:[{collectedLamports:Number.MAX_SAFE_INTEGER},{collectedLamports:2}]});
  assert.equal(result.strong.textContent,'9007199.254740993 SOL');
  assert.match(result.small.innerHTML,/2 confirmed fee claims/);
  assert.equal(render({status:'onchain-indexed',verifiedCollections:[{collectedLamports:15}]}).strong.textContent,'0.000000015 SOL');
});
test('invalid amounts and totals outside supported exact bounds remain unavailable',()=>{
  for(const value of [null,true,9007199254740992,'15.1']){
    const result=render({status:'onchain-indexed',verifiedCollections:[{collectedLamports:value}]});
    assert.equal(result.strong.textContent,'—');assert.match(result.small.innerHTML,/total unavailable/);
  }
  assert.equal(render({status:'onchain-indexed',verifiedCollections:[{collectedLamports:'18446744073709551615'},{collectedLamports:'1'}]}).strong.textContent,'—');
});
test('overflow ledger hints use exact strings while null without exact evidence never becomes zero',()=>{
  const evidence={status:'unverified-records',coverage:{recordedCollections:2}};
  const exact=render(evidence,{recordedCollectedLamports:null,precisionStatus:'overflow',exactLamports:{recordedCollectedLamports:'9007199254740993'}});
  assert.match(exact.small.innerHTML,/9007199\.254740993 SOL recorded in the ledger/);
  assert.equal(exact.strong.textContent,'—');assert.match(exact.small.innerHTML,/confirmation unavailable/);
  const missing=render(evidence,{recordedCollectedLamports:null,precisionStatus:'overflow'});
  assert.match(missing.small.innerHTML,/recorded amount unavailable/);assert.doesNotMatch(missing.small.innerHTML,/; 0 SOL/);
});

// FQA-076 / UX-057: supplied collection evidence, exact units and sparse UTC dates.
import { availableCollectionHistory } from '../src/features/analytics/dashboard-view.js';
const collectionAlphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const collectionRow = (i, patch = {}) => ({ signature:'1'.repeat(63) + collectionAlphabet[i+1],
  mint:'1'.repeat(31)+'2', slot:100+i, collectedLamports:'1', blockTime:1792627200, ...patch });
const collectionEvidence = (rows = [], patch = {}) => ({ cluster:'devnet', scope:'verified-v3-collections',
  commitment:'finalized', status:'onchain-indexed', generatedAt:'2026-10-23T04:00:00Z', verifiedCollections:rows,
  coverage:{ recordedCollections:rows.length, verifiedCollections:rows.length }, ...patch });
const collectionModel = evidence => availableCollectionHistory({ receiptEvidence:evidence,
  receiptEvidenceChecked:true, EXPLORE_CLUSTER:'devnet' });
const unavailableCollection = evidence => {
  const result = collectionModel(evidence); assert.equal(result.state,'unavailable');
  assert.deepEqual(result.rows,[]); assert.equal(result.totalLamports,null); assert.equal(result.coverage,null);
};

test('collection history requires settled same-cluster finalized evidence and coherent safe coverage', () => {
  for (const checked of [undefined,false,0,'true']) {
    const value = availableCollectionHistory({ receiptEvidence:collectionEvidence(), receiptEvidenceChecked:checked, EXPLORE_CLUSTER:'devnet' });
    assert.equal(value.state,'loading'); assert.equal(value.totalSol,null); assert.deepEqual(value.rows,[]);
  }
  const good = collectionEvidence([collectionRow(0)]);
  for (const patch of [{cluster:'mainnet-beta'},{scope:'ledger'},{commitment:'confirmed'}, {status:'unavailable'},
    {status:'unverified-records'},{verifiedCollections:null}, {coverage:null},
    ...[undefined,null,true,-1,1.5,'1',Number.MAX_SAFE_INTEGER+1].map(x=>({coverage:{recordedCollections:x,verifiedCollections:1}})),
    ...[undefined,null,true,-1,1.5,'1',2].map(x=>({coverage:{recordedCollections:1,verifiedCollections:x}})),
    {coverage:{recordedCollections:0,verifiedCollections:1}}, {coverage:{recordedCollections:2,verifiedCollections:1}}]) {
    unavailableCollection({...good,...patch});
  }
  for (const evidence of [undefined,null,[],{},'evidence']) unavailableCollection(evidence);
  for (const cluster of [undefined,'testnet','DEVNET','']) assert.equal(availableCollectionHistory({
    receiptEvidence:good,receiptEvidenceChecked:true,EXPLORE_CLUSTER:cluster }).state,'unavailable');
  assert.equal(availableCollectionHistory({receiptEvidence:{...good,cluster:'mainnet-beta'},receiptEvidenceChecked:true,
    EXPLORE_CLUSTER:'mainnet-beta'}).state,'available'); // Pure schema coverage only; no mainnet request.
});

test('collection dates aggregate exactly by UTC transaction day without inventing missing days', () => {
  const rows = [collectionRow(0,{blockTime:Date.parse('2026-10-21T23:59:59Z')/1000,collectedLamports:3}),
    collectionRow(1,{blockTime:Date.parse('2026-10-22T00:00:00Z')/1000,collectedLamports:5}),
    collectionRow(2,{blockTime:Date.parse('2026-10-21T00:00:00Z')/1000,collectedLamports:'7'}),
    collectionRow(3,{blockTime:Date.parse('2026-10-18T09:00:00Z')/1000,collectedLamports:'11'}),
    collectionRow(4,{blockTime:null,collectedLamports:'13'})];
  const model = collectionModel(collectionEvidence(rows));
  assert.deepEqual(model.rows.map(x=>[x.day,x.receipts,x.collectedLamports]),[
    ['2026-10-22',1,'5'],['2026-10-21',2,'10'],['2026-10-18',1,'11'],[null,1,'13']]);
  assert.equal(model.rows.at(-1).label,'Date unavailable'); assert.equal(model.totalLamports,'39');
  assert.equal(model.totalSol,'0.000000039'); assert.equal(model.rows.some(x=>x.day==='2026-10-20'),false);
});

test('invalid or unknown block times retain exact amounts in the final undated bucket', () => {
  const times = [undefined,null,0,-1,0.5,'1792627200',NaN,Infinity,Number.MAX_SAFE_INTEGER+1,
    8640000000001,253402300800]; // Date overflow and year10000, respectively.
  const model = collectionModel(collectionEvidence(times.map((blockTime,i)=>collectionRow(i,{blockTime,collectedLamports:'3'}))));
  assert.equal(model.state,'available'); assert.deepEqual(model.rows,[{day:null,label:'Date unavailable',
    receipts:times.length,collectedLamports:String(3*times.length),collectedSol:'0.000000033'}]);
});

test('duplicate identities and malformed signatures, mints or slots fail the whole optional view closed', () => {
  const first = collectionRow(0);
  for (const second of [first,{...first,collectedLamports:'99'},{...first,blockTime:null}])
    unavailableCollection(collectionEvidence([first,second]));
  for (const patch of [{signature:''},{signature:'0'.repeat(64)},{signature:'1'.repeat(63)},
    {signature:'1'.repeat(65)},{signature:'z'.repeat(88)}, {mint:''},{mint:'0'.repeat(32)},
    {mint:'1'.repeat(31)},{mint:'1'.repeat(33)},{mint:'z'.repeat(44)},
    ...[undefined,null,0,-1,0.5,'100',Number.MAX_SAFE_INTEGER+1].map(slot=>({slot}))])
    unavailableCollection(collectionEvidence([first,collectionRow(1,patch)]));
  for (const row of [null,[],false,'row']) unavailableCollection(collectionEvidence([first,row]));
});

test('exact collection units preserve precision and reject invalid amounts and group or grand overflow', () => {
  for (const amount of [undefined,null,true,false,0,'0',-1,'-1',0.1,'1.1','01',' 1','1e3',
    Number.MAX_SAFE_INTEGER+1,'18446744073709551616'])
    unavailableCollection(collectionEvidence([collectionRow(0),collectionRow(1,{collectedLamports:amount})]));
  const precise = collectionModel(collectionEvidence([collectionRow(0,{collectedLamports:Number.MAX_SAFE_INTEGER}),
    collectionRow(1,{collectedLamports:2})]));
  assert.equal(precise.totalLamports,'9007199254740993'); assert.equal(precise.totalSol,'9007199.254740993');
  assert.equal(precise.rows[0].collectedSol,precise.totalSol);
  const max = collectionRow(0,{collectedLamports:'18446744073709551615'});
  assert.equal(collectionModel(collectionEvidence([max])).totalSol,'18446744073.709551615');
  for (const blockTime of [max.blockTime,null,max.blockTime-86400])
    unavailableCollection(collectionEvidence([max,collectionRow(1,{blockTime})]));
});

test('partial-empty, coherent empty and populated coverage remain distinct', () => {
  const partialEmpty = collectionModel(collectionEvidence([],{status:'partial',coverage:{recordedCollections:12,verifiedCollections:0}}));
  assert.equal(partialEmpty.state,'partial-empty'); assert.deepEqual(partialEmpty.coverage,{recorded:12,verified:0,partial:true});
  for (const status of ['no-records','onchain-indexed']) assert.equal(collectionModel(collectionEvidence([],{status})).state,'empty');
  unavailableCollection(collectionEvidence([],{status:'no-records',coverage:{recordedCollections:1,verifiedCollections:0}}));
  unavailableCollection(collectionEvidence([collectionRow(0)],{status:'no-records'}));
  const partial = collectionModel(collectionEvidence([collectionRow(0)],{status:'partial',coverage:{recordedCollections:12,verifiedCollections:1}}));
  assert.equal(partial.state,'partial'); assert.deepEqual(partial.coverage,{recorded:12,verified:1,partial:true});
});

test('checked time describes freshness only and recovery derives entirely from the latest evidence', () => {
  const rows = [collectionRow(0,{blockTime:null,verifiedAt:'2026-10-22T00:00:00Z',recordedAt:'2026-10-21T00:00:00Z'})];
  const valid = collectionEvidence(rows); const first = collectionModel(valid);
  assert.equal(first.checkedAt,'2026-10-23T04:00:00.000Z'); assert.equal(first.rows[0].day,null);
  for (const generatedAt of [undefined,null,0,'yesterday','2026-02-30T00:00:00Z','2026-10-23T04:00:00+00:00','+010000-01-01T00:00:00.000Z']) {
    const result = collectionModel({...valid,generatedAt}); assert.equal(result.checkedAt,null); assert.deepEqual(result.rows,first.rows);
  }
  unavailableCollection({...valid,status:'unavailable'});
  assert.deepEqual(collectionModel(valid),first); assert.deepEqual(valid.verifiedCollections,rows);
});
