import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedFeePresentation,feeDistributionPresentation,feeDistributionMarkup} from '../src/features/fees/distribution-summary.js';

test('the new-launch presentation accounts for every percent and separates the app allocation from ecosystem budgets',()=>{
  const fee=approvedFeePresentation(),model=feeDistributionPresentation(fee);
  assert.deepEqual(model.rows.map(row=>[row.key,row.percent]),[['creator',80],['operations',8],['referrals',1],['community',4],['buyback',5],['agency',2]]);
  assert.equal(model.total,100);assert.equal(model.operations,8);assert.equal(model.benefits,92);assert.equal(model.ecosystem,12);
  const markup=feeDistributionMarkup({fee});assert.match(markup,/not trade volume/);assert.match(markup,/Trading, launch and optional promotion charges, plus network costs, are separate/);
  assert.match(markup,/top 3 per category/);assert.match(markup,/eligible coin holders and a named X account/);assert.match(markup,/Unused budgets stay reserved/);assert.match(markup,/finalized receipts/);
});

test('historical and alternative policies keep their actual gross rates and cannot be presented as the new 8 percent policy',()=>{
  const fee={...approvedFeePresentation(),operationsEffectivePercent:6,communityEffectivePercent:6};
  assert.equal(feeDistributionPresentation(fee).operations,6);assert.equal(feeDistributionPresentation(fee).benefits,94);assert.equal(feeDistributionPresentation(fee).ecosystem,14);
  const legacy={...fee,appReferralEffectivePercent:3};delete legacy.agencyEffectivePercent;
  assert.equal(feeDistributionPresentation(legacy).rows.length,5);assert.match(feeDistributionMarkup({fee:legacy}),/3%<\/strong><span>Referral/);
  for(const overrides of[{agencyEffectivePercent:1},{creatorPercent:81},{operationsEffectivePercent:NaN},{appReferralEffectivePercent:-1}])assert.throws(()=>feeDistributionPresentation({...approvedFeePresentation(),...overrides}),/100%/);
});
