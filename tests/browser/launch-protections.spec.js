import {test,expect} from '@playwright/test';

for (const width of [390,1440]) test(`launch explains ticker protection and developer token lock at ${width}px (mocked APIs)`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Local UI fixture'}}));
  await page.goto('/#launch');
  await page.locator('body.workspace-ready.product-experience-ready.product-flows-ready').waitFor();
  await expect(page.locator('#token-symbol-help')).toContainText('case-insensitive');
  await expect(page.locator('#token-symbol-help')).toContainText('12 hours');
  await page.locator('#token-name').fill('Protection test');await page.locator('#token-symbol').fill('PROTECT');await page.locator('#launch-next').click();await expect(page.locator('#creator-fee-lock-help')).toBeVisible();
  await expect(page.locator('#creator-fee-lock-help')).not.toContainText('fee hold');
  await expect(page.locator('#creator-fee-lock-help')).toContainText('locked on-chain for 12 hours');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('creator dashboard explains a locked balance before the first collection (mocked overview)',async({page})=>{
  await page.goto('/tests/launch-review.html');
  await page.evaluate(async()=>{
    const root=document.createElement('div');root.id='coin-fee-dashboard';document.body.append(root);
    const {createCreatorFeesController}=await import('/src/app/controllers/creator-fees.js');
    const controller=createCreatorFeesController({renderCoinSummary(){},connectedWalletAddress:'creator'});
    controller.renderCoinFeeDashboard({available:true,scope:'per-mint-v3',creatorWallet:'creator',collections:[],
      creatorFeeLock:{applies:true,locked:true,unlockAt:'2030-01-01T12:00:00Z'}});
  });
  await expect(page.locator('#coin-fee-dashboard')).toContainText('locked for 12 hours');
  await expect(page.locator('#coin-fee-dashboard')).toContainText('Unlocks');
  await expect(page.locator('#coin-fee-dashboard')).toContainText('token trading remains available');
});
