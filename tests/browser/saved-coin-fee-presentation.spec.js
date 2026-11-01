import{test,expect}from'@playwright/test';
// Local renderer fixture: real view + policy validation, no RPC or transaction flow.
for(const width of[390,1440])test(`saved legacy and agency coin policies keep their own allocation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.route('**/fee-renderer-fixture',r=>r.fulfill({contentType:'text/html',body:'<link rel="stylesheet" href="/styles/fee-distribution-summary.css"><section id="coin-page"><div class="coin-stat-strip"><div id="coin-fee-route"><strong id="coin-fee-route-value"></strong></div></div></section>'}));await page.goto('/fee-renderer-fixture');
 const render=async agency=>page.evaluate(async agency=>{
  const{buildFeeDistributionPolicy}=await import('/distribution-policy.js'),{renderCoinRewardsPolicy}=await import('/src/features/coin/promotion-view.js');
  const fundedSplit=agency?{operationsPercent:40,referralLevelPercents:[3,1.25,0.75],communityPercent:20,buybackPercent:25,agencyPercent:10}:{operationsPercent:40,referralLevelPercents:[10,3,2],communityPercent:20,buybackPercent:25};
  const policy={mint:'coin-fixture',cluster:'devnet',onchainVerified:true,policySignature:'fixture-only',feeDistribution:buildFeeDistributionPolicy({creatorWalletPercent:50,holderAirdropPercent:20,solClaimPercent:10,xRecipient:'@sample'},{fundedSplit})};
  renderCoinRewardsPolicy(policy,policy.mint,{EXPLORE_CLUSTER:'devnet'},{verifiedLaunchPolicyForMint:()=>null});
 },agency);
 await render(false);const details=page.locator('.coin-fixed-fee-details');await details.locator(':scope > summary').click();await expect(details.locator('[data-fee-category="referrals"] strong')).toHaveText('3%');await expect(details.locator('[data-fee-category="agency"]')).toHaveCount(0);
 await details.locator(':scope > summary').focus();await render(true);await expect(details.locator(':scope > summary')).toBeFocused();await expect(details).toHaveAttribute('open','');await expect(details.locator('[data-fee-category="referrals"] strong')).toHaveText('1%');await expect(details.locator('[data-fee-category="agency"] strong')).toHaveText('2%');await expect(page.locator('#coin-fee-route-value')).toContainText('Creator 50% · Holders 20%');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
