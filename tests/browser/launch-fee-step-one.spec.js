import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
for(const width of [320, 1440])test(`step two keeps the compact fee breakdown visible at ${width}px (mocked APIs)`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('https://**/*',r=>r.abort());await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Offline fixture'}}));
  await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.goto('/#launch');await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
  await page.locator('#token-name').fill('Community coin');await page.locator('#token-symbol').fill('COMM');await page.locator('#launch-next').click();
  const overview=page.locator('#launch-fee-overview');await expect(overview).toBeVisible();await expect(overview.locator(':scope > summary')).toHaveCount(0);
  await expect(overview.locator('[data-fee-category] > strong')).toHaveText(['80%','8%','3%','4%','5%']);
  await expect(page.locator('[data-launch-step-target]')).toHaveCount(2);await expect(page.locator('#launch-button')).toBeVisible();await expect(page.locator('#launch-button')).toBeDisabled();
  const creator=page.locator('#creator-wallet-share'),holders=page.locator('#holder-airdrop-share'),x=page.locator('#x-share'),recipient=page.locator('#x-recipient');
  await creator.fill('60');await holders.fill('20');await expect(page.locator('#launch-summary-creator')).toHaveText('60%');await expect(page.locator('#launch-summary-holders')).toHaveText('20%');
  await page.locator('#launch-back').click();await page.locator('#launch-next').click();await expect(creator).toHaveValue('60');await expect(holders).toHaveValue('20');await expect(overview).toBeVisible();
  await holders.fill('10');await x.fill('10');await expect(recipient).toBeEnabled();await recipient.fill('@rewarded');await expect(page.locator('#launch-summary-x')).toHaveText('10%');
  await expect(page.locator('#fee-route-agree')).not.toBeChecked();await expect(page.locator('#terms-agree')).not.toBeChecked();await expect(page.locator('#launch-button')).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await overview.screenshot({path:info.outputPath(`fee-breakdown-${width}.png`)});
});
