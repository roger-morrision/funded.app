import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

test('mobile collection and allocation labels never imply recipient payments', async ({ page }) => {
  const mint = '26ds5kv2n8JuWZ2uRu1goxEw7xy7YirpdsqdiLycy1Zg';
  const signature = '3'.repeat(64);
  await page.setViewportSize({width:390, height:844});
  await page.route('**/api/**', route => route.fulfill({status:503, json:{error:'Offline fee-label fixture'}}));
  await page.route('**/api/fee-policy', route => route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route(`**/api/tokens/${mint}/fee-activity`, route => route.fulfill({json:{
    mint, cluster:'devnet', overview:{available:true, scope:'per-mint-v3'},
    collections:[{signature, collectedLamports:'2462530', recordedAt:'2026-10-17T00:00:00Z'}],
    claims:[{claimSignature:signature, grossCreatorFees:'0.00246253', asset:'SOL',
      status:'allocated-not-funded', claimedAt:'2026-10-17T00:00:00Z'}],
  }}));
  await page.route('https://**/*', route => route.abort());
  await page.goto(`/token/${mint}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.getByRole('tab', {name:/^Fee collections/}).click();
  const table = page.locator('#coin-activity-list .coin-fee-table');
  await expect(table).toContainText('0.00246253 SOL');
  const labels = () => table.locator('tbody tr').first().locator('td').evaluateAll(cells =>
    cells.map(cell => getComputedStyle(cell,'::before').content.replaceAll('"','')));
  expect(await labels()).toEqual(['none','Event','Amount collected','USD estimate','Collection transaction']);
  await page.getByRole('tab', {name:/^Allocations/}).click();
  await expect(table).toContainText('Allocated not funded');
  expect(await labels()).toEqual(['none','Event','Gross fees','Allocation status','Related collection']);
  await page.screenshot({path:test.info().outputPath('mobile-fee-labels-mocked.png'), fullPage:true});
});
