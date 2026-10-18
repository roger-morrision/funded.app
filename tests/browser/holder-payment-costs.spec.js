import {test,expect} from '@playwright/test';

for(const width of [1280,390])test(`holder self-payment shows its signed net change and costs at ${width}px`,async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/Invalid token balance/.test(message.text()))errors.push(message.text());});
  await page.setViewportSize({width,height:900});
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline fixture'}}));
  await page.route('**/api/evidence/payment-history',route=>route.fulfill({json:{cluster:'devnet',status:'onchain-indexed',
    verifiedPayouts:[{source:'automatic-holder',to:'7'.repeat(44),signature:'9'.repeat(88),
      amountLamports:215886,actualReceivedLamports:-947354,feeLamports:5000,recipientRentLamports:1158240,
      feePayer:'7'.repeat(44),blockTime:1792332646,slot:512461000}]}}));
  await page.goto('/#payments');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('[data-reward-open="history"]').click();
  const row=page.locator('#payment-list .payment-history-row');await expect(row).toHaveCount(1);
  await expect(row.locator('.payment-amount')).toHaveText('-0.000947354SOL net change');
  await row.locator('summary').click();
  await expect(row.locator('.payment-history-gross')).toContainText('0.000215886 SOL');
  await expect(row.locator('.payment-history-details')).toContainText('Payment account rent 0.00115824 SOL');
  await expect(row.locator('.payment-history-fee')).toContainText('paid by receiver');
  await page.locator('#payment-history-type').selectOption('holder');await expect(row).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
});
