import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

test('mocked funded V3 X reward can be selected but still requires a wallet', async ({ page }) => {
  const mint='FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH';
  const signature='3'.repeat(64);
  await page.route('**/api/**', route => route.fulfill({ status:503,
    json:{ error:'offline fixture' } }));
  await page.route('**/api/fee-policy', route => route.fulfill({ json:{ split:PROTOCOL_FEE_SPLIT } }));
  await page.route('**/api/x/me', route => route.fulfill({ json:{
    available:true, authenticated:true, configured:true,
    user:{ id:'12345', username:'qa' } } }));
  await page.route('**/api/x-fee/claims', route => route.fulfill({ json:{
    handle:'@qa', claims:[{ id:signature, scope:'per-mint-v3', mint,
      status:'ready', amountSol:0.005, receiptVerified:false, canPrepare:true }] } }));
  await page.goto('/#payments');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('.x-claim-heading')).toContainText('claim available SOL');
  await expect(page.locator('.x-claim-heading')).not.toContainText('pending activation');
  await page.getByRole('tab',{name:'X claims'}).click();
  const row=page.locator(`#sol-claim-list [data-claim-id="${signature}"]`);
  await expect(row).toContainText('Verify to claim');
  await row.getByRole('button',{name:'Select reward'}).click();
  await expect(page.locator('#selected-claim-review')).toBeVisible();
  await expect(page.locator('#claim-binding-review')).toBeVisible();
  await expect(page.locator('#sol-claim-submit')).toBeDisabled();
  await expect(page.locator('#sol-claim-status')).toContainText('Connect the receiving wallet');
});
