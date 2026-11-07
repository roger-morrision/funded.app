import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
for(const width of[320, 1440])test(`launch packages keep balance visible and required content intact at ${width}px (mocked APIs)`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.route('https://**/*',r=>r.abort());
 await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Offline fixture'}}));await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/#launch');await page.locator('body.product-flows-ready').waitFor();
 await page.locator('#token-name').fill('Simple launch');await page.locator('#token-symbol').fill('SIMPLE');await page.locator('#launch-next').click();
 await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','2');
 for(const tier of ['standard','pro','premier','standard']){
  await page.locator(`button[data-burn-tier="${tier}"]`).click();await expect(page.locator('.launch-tier-balance')).toBeVisible();await expect(page.locator('#launch-tier-wallet-balance')).toContainText('Connect wallet');await expect(page.locator('#launch-tier-quote-status')).toBeVisible();
  expect(await page.evaluate(()=>document.querySelector('.creator-burn-tiers').nextElementSibling.classList.contains('launch-tier-balance'))).toBe(true);
  for(const id of['token-description','token-roadmap','token-banner'])await expect(page.locator('#'+id)).toHaveAttribute('aria-required',String(tier!=='standard'));
 }
 await expect(page.locator('#airdrop-button')).toHaveCount(0);await expect(page.locator('#launch-button')).toBeDisabled();
 await page.locator('.launch-tier-balance').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`launch-balance-${width}.png`),animations:'disabled'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});
