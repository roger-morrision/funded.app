import {test,expect} from '@playwright/test';
test('operations payments display their label, amount and proof under the protocol filter',async({page})=>{
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline fixture'}}));
  await page.route('**/api/evidence/payment-history',route=>route.fulfill({json:{cluster:'devnet',status:'onchain-indexed',checkedOperations:1,
    verifiedPayouts:[{source:'v3-operations',to:'8'.repeat(44),signature:'9'.repeat(88),amountLamports:16328,
      actualReceivedLamports:16328,feeLamports:10000,feePayer:'7'.repeat(44),blockTime:1792336800,slot:512479001}]}}));
  await page.goto('/#payments');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('[data-reward-open="history"]').click();await page.locator('#payment-history-type').selectOption('operations');
  const row=page.locator('#payment-list .payment-history-row');await expect(row).toHaveCount(1);
  await expect(row).toContainText('Operations & marketing');await expect(row.locator('.payment-amount')).toHaveText('0.000016328SOL received');
  await expect(row.locator('a[href*="/tx/"]')).toHaveAttribute('href',/cluster=devnet/);
  await page.locator('#payment-history-type').selectOption('creator');await expect(row).toHaveCount(0);
  await page.goto('/#analytics-detail');
  const analyticsRow=page.locator('.recipients-panel .payment-row');
  await expect(analyticsRow).toContainText('Operations & marketing ·');
  await expect(analyticsRow).not.toContainText('Recipient ·');
  await expect(analyticsRow).toContainText('0.000016328 SOL received');
  await expect(analyticsRow.locator('a[href*="/tx/"]')).toHaveAttribute('href',/9{88}\?cluster=devnet$/);
});
