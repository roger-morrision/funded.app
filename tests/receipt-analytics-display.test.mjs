import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { exactLamports } from '../exact-lamports.js';
import { formatReceiptSol } from '../receipt-export.js';
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const renderer=app.slice(app.indexOf('function renderVerifiedReceiptEvidence(){'),app.indexOf('function renderOnchainReportState('));
function render(evidence,summary=null){
  const fields={span:{textContent:''},strong:{textContent:'—'},small:{innerHTML:''}};
  const card={querySelector:key=>fields[key]};
  const context={receiptEvidence:evidence,paymentHistoryEvidence:null,analyticsSummary:summary,receiptEvidenceChecked:true,exactLamports,formatReceiptSol,
    document:{querySelectorAll:()=>[],querySelector:key=>key==='[data-analytics-metric="fees"]'?card:null,addEventListener:()=>{}}};
  runInNewContext(renderer,context);context.renderVerifiedReceiptEvidence();return fields;
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
  assert.equal(exact.strong.textContent,'—');assert.match(exact.small.innerHTML,/no matching on-chain proof/);
  const missing=render(evidence,{recordedCollectedLamports:null,precisionStatus:'overflow'});
  assert.match(missing.small.innerHTML,/recorded amount unavailable/);assert.doesNotMatch(missing.small.innerHTML,/; 0 SOL/);
});
