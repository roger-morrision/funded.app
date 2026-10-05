import { test, expect } from '@playwright/test';

const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const found = []; errors.set(page, found);
  page.on('pageerror', error => found.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable fixture"}' }));
  await page.route('https://**/*', route => route.abort());
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'No uncaught browser errors').toEqual([]));
async function open(page, hash) {
  await page.goto(`/#${hash}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
}

test('launch form has no draft controls and keeps edits while navigating', async ({ page }) => {
  await open(page, 'launch');
  await expect(page.locator('.launch-draft-panel, #save-launch-draft, #restore-launch-draft, #delete-launch-draft')).toHaveCount(0);
  await page.locator('#token-name').fill('Current launch');
  await page.locator('#token-symbol').fill('CURRENT');
  await page.evaluate(() => { location.hash = '#explore'; });
  await page.evaluate(() => { location.hash = '#launch'; });
  await expect(page.locator('#token-name')).toHaveValue('Current launch');
});
