import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline fixture"}' }));
  await page.route('https://**/*', route => route.abort());
});

test('service status explains each check without equating availability with payment success', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ cluster: 'devnet', status: 'degraded', observedAt: '2026-10-04T05:00:00Z', checks: [{ id: 'storage', status: 'operational' }, { id: 'network', status: 'wrong-network' }] }) }));
  await page.goto('/#docs');
  await page.getByRole('button', { name: 'Check service status' }).click();
  const panel = page.locator('#service-status');
  await expect(panel.locator('[role=status]')).toContainText('some services need attention');
  await expect(panel.locator('li').first()).toContainText('Saved records');
  await expect(panel.locator('li').last()).toContainText('Network does not match this app');
  await expect(panel.locator('.service-status-scope')).toContainText('transaction receipt');
  await expect(panel).toHaveAttribute('aria-busy', 'false');
});

test('payment history retains verified page and matching CSV when next page fails', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/creators/test-user/receipts*', route => {
    requests += 1;
    if (requests > 1) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline fixture"}' });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ cluster: 'devnet', commitment: 'finalized', status: 'onchain-indexed', checkedPayouts: 1, nextCursor: 'page-two', receipts: [{ signature: '1'.repeat(88), slot: 50, amountLamports: '18446744073709551615', paidAt: '2026-10-04T05:00:00Z' }] }) });
  });
  await page.goto('/#docs');
  await page.evaluate(async () => {
    const { mountReceiptHistory } = await import('/receipt-history-ui.js');
    const container = document.createElement('section'); container.id = 'receipt-usability-fixture'; document.querySelector('#docs').append(container);
    mountReceiptHistory(container, 'test-user', 'devnet');
  });
  const panel = page.locator('#receipt-usability-fixture');
  await panel.getByRole('button', { name: 'Load payment history' }).click();
  await expect(panel.locator('.receipt-history-card strong')).toHaveText('18446744073.709551615 SOL');
  await panel.getByRole('button', { name: 'Next page' }).click();
  await expect(panel.locator('[role=status]')).toContainText('Page 1 remains displayed');
  await expect(panel.locator('.receipt-history-card')).toHaveCount(1);
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download page as CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('funded-devnet-receipts-page-1.csv');
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv).toContain('18446744073.709551615');
  expect(csv).toContain('current verified page only');
});

test('empty payment history explains pending rewards and disables export', async ({ page }) => {
  await page.route('**/api/creators/empty-user/receipts', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ cluster: 'devnet', commitment: 'finalized', status: 'no-records', checkedPayouts: 0, receipts: [] }) }));
  await page.goto('/#docs');
  await page.evaluate(async () => {
    const { mountReceiptHistory } = await import('/receipt-history-ui.js');
    const container = document.createElement('section'); container.id = 'empty-receipt-fixture'; document.querySelector('#docs').append(container);
    mountReceiptHistory(container, 'empty-user', 'devnet');
  });
  const panel = page.locator('#empty-receipt-fixture');
  await panel.getByRole('button', { name: 'Load payment history' }).click();
  await expect(panel.locator('.receipt-history-empty')).toContainText('check pending amounts');
  await expect(panel.getByRole('button', { name: 'Download page as CSV' })).toBeDisabled();
  await expect(panel.locator('[data-history-rows]')).toHaveAttribute('aria-busy', 'false');
});
