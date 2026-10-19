import test from 'node:test';
import assert from 'node:assert/strict';
import {referralRatePresentation} from '../src/features/fees/referral-rate-copy.js';
import {referralGuide,referralFaqs} from '../src/features/help/product-guidance.js';
import {setActiveProtocolFeeSplit,buildFeeDistributionPolicy} from '../distribution-policy.js';
import {PROTOCOL_FEE_SPLIT} from '../config/protocol-fee-split.js';
import {agencyProtocolSplit} from '../agency-mint-router-v3.js';
test('approved 1% referral display and guidance distinguish the pending update from historical saved rates',()=>{
  try{
    setActiveProtocolFeeSplit(PROTOCOL_FEE_SPLIT);
    const saved=buildFeeDistributionPolicy({creatorWalletPercent:80});
    const copy=referralRatePresentation();assert.deepEqual(copy.levels.map(row=>row.rate),[0.6667,0.2,0.1333]);
    assert.equal(copy.total,1);assert.equal(copy.pending,true);assert.match(copy.scope,/Awaiting V3 agency activation/);
    assert.match(referralGuide(),/Level 1: 0\.6667%/);assert.match(referralGuide(),/Level 2: 0\.2%/);assert.match(referralGuide(),/Level 3: 0\.1333%/);
    assert.match(referralFaqs()[0][2],/1% total/);assert.match(referralGuide(),/published deployment uses L1 2%/);
    assert.equal(saved.fixedFunded.appReferral.effectivePercentOfCreatorFees,3);
    setActiveProtocolFeeSplit(agencyProtocolSplit());
    const published=referralRatePresentation();assert.equal(published.pending,false);assert.equal(published.total,1);
    assert.match(published.scope,/Published rates/);assert.doesNotMatch(published.guide,/Until activation/);
    assert.equal(saved.fixedFunded.appReferral.effectivePercentOfCreatorFees,3);
  }finally{setActiveProtocolFeeSplit(PROTOCOL_FEE_SPLIT);}
});
