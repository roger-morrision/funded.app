import test from 'node:test';
import assert from 'node:assert/strict';
import { payoutCoverage } from '../server/payout-coverage.mjs';
import { payoutCoverageLabel } from '../src/features/explore/payout-coverage.js';
const to='5'.repeat(44),signature='3'.repeat(64),paymentAccount='6'.repeat(44);
const row={to,signature,amountLamports:25};

test('operations, automatic, creator, daily and referral aliases use one receipt universe',()=>{
  const recorded=['operations','automatic','creator','daily','referral'].map(source=>({...row,source}));
  const result=payoutCoverage(recorded,recorded);
  assert.equal(result.recorded,1);assert.equal(result.verified,1);assert.equal(result.verifiedTotalLamports,'25');
  const operations=[1,2,3].map(n=>({...row,signature:String(n+2).repeat(64)}));
  assert.deepEqual(payoutCoverage(operations,operations),
    {scope:'v3-sol-recipient-receipts',status:'verified',recorded:3,verified:3,reason:null,verifiedTotalLamports:'75'});
});

test('recovered account aliases bridge transaction references and partial evidence retains verified totals',()=>{
  const result=payoutCoverage([{to,paymentAccount},{...row,paymentAccount},{to,signature:'4'.repeat(64)}],
    [{...row,paymentAccount},{...row,paymentAccount}]);
  assert.equal(result.recorded,2);assert.equal(result.verified,1);assert.equal(result.status,'partial');
  assert.equal(result.verifiedTotalLamports,'25');
});

test('unknown scope and conflicting replay evidence report unavailable without inventing a denominator',()=>{
  for(const result of [payoutCoverage([], [row]),payoutCoverage([{to}], [row]),
    payoutCoverage([row],[row,{...row,amountLamports:26}])]){
    assert.equal(result.status,'unavailable');assert.equal(result.recorded,null);assert.equal(result.verified,null);assert(result.reason);
  }
  assert.equal(payoutCoverage([row],[row,{...row,amountLamports:26}]).verifiedTotalLamports,null);
  assert.equal(payoutCoverage([],[row,{...row,amountLamports:26}]).verifiedTotalLamports,null);
});

test('coverage text requires a fresh same-scope invariant and keeps a useful unavailable explanation',()=>{
  const now=Date.parse('2026-10-19T05:00:00Z');
  const summary={payoutEvidenceAt:new Date(now).toISOString(),recordedPayouts:3,verifiedPayoutCount:2,
    feePayoutStats:{cluster:'devnet',commitment:'finalized'},payoutCoverage:{scope:'v3-sol-recipient-receipts',status:'partial'}};
  assert.equal(payoutCoverageLabel(summary,'devnet',now).text,'2 of 3 payouts verified · checked 05:00 UTC');
  for(const change of [{verifiedPayoutCount:4},{recordedPayouts:null},{payoutEvidenceAt:'2020-01-01'},
    {payoutCoverage:{status:'unavailable',reason:'Receipt scope is unavailable.'}}]){
    const result=payoutCoverageLabel({...summary,...change},'devnet',now);
    assert.match(result.text,/Receipt coverage unavailable/);assert(result.reason);
  }
});
