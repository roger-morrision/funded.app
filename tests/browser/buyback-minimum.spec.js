import {test,expect} from '@playwright/test';
for(const width of [1280,390])test(`small buyback allocations explain retained funds without hiding reconciliation at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline fixture'}}));
  await page.route('**/api/buyback/status',route=>route.fulfill({json:{cluster:'devnet',automationEnabled:true,minimumOrderLamports:'10000',
    dashboard:{status:'verified',thresholdLamports:'100000',collectedLamports:'103938',triggerReached:true},receipts:[],pending:[
      {mint:'52TdgMLp41CtiLrAqqZ1N889RPfWMMzxwpF8MoaZFvN1',amountLamports:'8911',status:'below-minimum-order'},
      {mint:'26ds5kv2n8JuWZ2uRu1goxEw7xy7YirpdsqdiLycy1Zg',amountLamports:'5000',status:'verification-pending'}]}}));
  await page.goto('/#buybacks');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const disclosure=page.locator('.concise-buyback-queue');
  await disclosure.locator('summary').click();
  const rows=page.locator('.reward-buyback-list p');await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('0.000008911 SOL retained');
  await expect(rows.nth(0)).toContainText('below 0.00001 SOL order minimum; retained in its vault');
  await expect(rows.nth(0)).not.toContainText('ready for the next batch');
  await expect(rows.nth(1)).toContainText('in progress');
  await expect(page.locator('.reward-buyback-stats')).toContainText('Unspent allocations');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
