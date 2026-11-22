import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCoinRewardsPolicy } from '../src/features/coin/promotion-view.js';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';

test('fee section shows the matching saved policy and clears it on token changes',()=>{
  const content={innerHTML:''};
  const summary={parentElement:{classList:{toggle(){}}}};
  const value={replaceChildren(){},append(){}};
  const document={querySelector:key=>({'#coin-fee-route':summary,'#coin-fee-route-value':value,'#coin-fee-distribution-content':content}[key]||null),
    querySelectorAll:()=>[],createTextNode:text=>text};
  const launch={mint:'token-a',cluster:'devnet',onchainVerified:true,policySignature:'fixture-signature',feeDistribution:buildFeeDistributionPolicy({creatorWalletPercent:80})};
  const render=(mint,policy)=>renderCoinRewardsPolicy(policy,mint,{coinSummaryLaunch:launch,EXPLORE_CLUSTER:'devnet'},
    {document,verifiedLaunchPolicyForMint:()=>null});
  render('token-a',launch);
  assert.match(content.innerHTML,/saved-fee-chart/);
  assert.match(content.innerHTML,/Share of collected creator fees/);
  render('token-b',null);
  assert.doesNotMatch(content.innerHTML,/saved-fee-chart/);
  assert.match(content.innerHTML,/No verified creator-fee distribution/);
});
