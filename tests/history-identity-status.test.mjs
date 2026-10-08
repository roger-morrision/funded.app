import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateExploreRows } from '../explore-pagination.js';
import { portfolioTokenIdentity } from '../token-identity.js';
import { referralStatusLabel, referralClaimStatusLabel } from '../referral-status.js';

test('history pages cover every item once and clamp after a shorter refresh',()=>{
  const rows=Array.from({length:23},(_,i)=>i);
  assert.deepEqual([1,2,3].flatMap(page=>paginateExploreRows(rows,page).rows),rows);
  assert.equal(paginateExploreRows(rows.slice(0,4),3).page,1);
  assert.deepEqual(paginateExploreRows([],3).rows,[]);
});
test('token labels resolve the configured mint and launch registry without inventing names',()=>{
  assert.equal(portfolioTokenIdentity('funded',{fundedMint:'funded',asset:{symbol:'OTHER'}}).label,'$FUNDED');
  assert.equal(portfolioTokenIdentity('mint',{launch:{symbol:'QA',name:'QA launch'}}).description,'QA launch');
  assert.equal(portfolioTokenIdentity('mint',{asset:{symbol:'COIN'}}).label,'COIN');
  const unknown=portfolioTokenIdentity('12345678901234567890');
  assert.equal(unknown.label,'Unnamed token'); assert.equal(unknown.address,'123456…567890');
  assert.equal(portfolioTokenIdentity('mint',{asset:{symbol:'mint',name:'mint'}}).label,'Unnamed token');
});
test('referral status differentiates wallet approval, empty rewards, and outages',()=>{
  assert.equal(referralStatusLabel('disconnected'),'Connect wallet');
  assert.equal(referralStatusLabel('verification'),'Verify wallet');
  assert.equal(referralStatusLabel('checking'),'Checking rewards…');
  assert.equal(referralStatusLabel('ready',0),'No rewards ready');
  assert.equal(referralStatusLabel('ready',0.001),'Ready to claim');
  assert.equal(referralStatusLabel('unavailable'),'Rewards unavailable');
  assert.equal(referralClaimStatusLabel('verification-pending'),'Checking payment');
  assert.equal(referralClaimStatusLabel('awaiting-wallet-signature'),'Ready to review');
  assert.equal(referralClaimStatusLabel('unknown'),'Status unavailable');
});
