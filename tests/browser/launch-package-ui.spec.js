import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Offline QA fixture"}' }));
  await page.route('https://**/*', route => route.abort());
});

for (const width of [1440, 390]) test(`launch package and X previews update at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#launch-route-shell')).toBeVisible();
  await page.locator('#token-name').fill('Sample Coin');
  await page.locator('#token-symbol').fill('SAMPLE');
  await expect(page.locator('#preview-name')).toHaveText('Sample Coin');
  await expect(page.locator('#preview-symbol')).toHaveText('SAMPLE');
  await expect(page.locator('#launch-x-post-preview')).toContainText('Sample Coin');
  await page.locator('.creator-burn-card[data-burn-tier="pro"]').click();
  await expect(page.locator('#launch-package-example')).toHaveAttribute('data-tier', 'pro');
  await expect(page.locator('#launch-x-post-preview')).toContainText('Pro launch');
  await page.locator('.creator-burn-card[data-burn-tier="premier"]').click();
  await expect(page.locator('#launch-package-example')).toHaveAttribute('data-tier', 'premier');
  await expect(page.locator('#launch-x-post-count')).toHaveText('2 posts');
  await expect(page.locator('#launch-x-followup')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Home opens the live launch form and old pilot links resolve there', async ({ page }) => {
  await page.goto('/#overview');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const create = page.locator('.hero-actions a.primary-button');
  await expect(create).toHaveAttribute('href', '#launch');
  await expect(create).toHaveText(/Create a coin/);
  await expect(page.locator('.home-hero-kicker')).not.toContainText(/pilot|devnet/i);
  await create.click();
  await expect(page.locator('#launch-route-shell')).toBeVisible();
  await page.goto('/#pilot');
  await expect(page.locator('#launch-route-shell')).toBeVisible();
});
