import { test, expect } from '@playwright/test';
import { marketingAgencyCapabilities } from '../../server/marketing-agency-policy.mjs';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/fee-policy') return route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } });
    if (path === '/api/marketing-agency') return route.fulfill({ json: { ...marketingAgencyCapabilities(),
      funding: { status: 'unavailable', collectedLamports: null, spentLamports: null }, history: [], launches: [] } });
    return route.fulfill({ status: 503, json: { error: 'Offline QA fixture' } });
  });
  await page.route('https://**/*', route => route.abort());
});

for (const width of [1440, 390]) test(`dedicated agency menu, clear readiness and own-coin triggers at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/#marketing-agency');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#marketing-agency')).toBeVisible();
  await expect(page.locator('.primary-nav a[href="#marketing-agency"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-route-label]')).toHaveText('AI Marketing');
  await expect(page.locator('.agency-agent')).toHaveCount(3);
  await expect(page.locator('.agency-agent').nth(1)).toContainText('$100,000');
  await expect(page.locator('.agency-agent').nth(2)).toContainText('$300,000');
  await expect(page.locator('[data-agency-status]')).toContainText('Not activated');
  await expect(page.locator('[data-agency-funded]')).toHaveText('Unavailable');
  await expect(page.locator('[data-agency-history]')).toContainText('No agency execution history has been verified');
  await expect(page.locator('.agency-policy')).toContainText('1% referrals · 2% AI agency');
  await expect(page.locator('.agency-policy')).toContainText('each buy and burn the launched coin once');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (width === 1440) await page.screenshot({ path: 'tmp/agency-desktop.png', fullPage: true, animations: 'disabled' });
  else await page.screenshot({ path: 'tmp/agency-mobile.png', fullPage: true, animations: 'disabled' });
  if (width === 1440) expect(await page.locator('#marketing-agency').evaluate(n => n.getBoundingClientRect().left >= document.querySelector('.sidebar').getBoundingClientRect().right)).toBe(true);
});

test('team preview updates equal selected budgets without altering the active fee policy', async ({ page }) => {
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('#token-name').fill('Agency QA');
  await page.locator('#token-symbol').fill('AQA');
  await page.locator('#launch-next').click();
  await expect(page.locator('#launch-agency-options')).toBeVisible();
  await page.locator('[data-launch-agency][value="x-promotion"]').check();
  await expect(page.locator('[data-agency-split]')).toContainText('1 selected agent');
  await page.locator('[data-launch-agency][value="buyback-300k"]').check();
  await expect(page.locator('[data-agency-split]')).toContainText('2 selected agents');
  await expect(page.locator('[data-agency-split]')).toContainText('no funds move');
  await page.locator('[data-launch-agency][value="x-promotion"]').uncheck();
  await page.locator('[data-launch-agency][value="buyback-300k"]').uncheck();
  await expect(page.locator('[data-agency-split]')).toContainText('remains in reserve');
  await page.goto('/#capital-flow');
  await expect(page.locator('#marketing-agency')).not.toBeVisible();
  await expect(page.locator('#capital-flow')).toBeVisible();
});

test('failed capability load is unavailable with working retry, never zero funds or ready', async ({ page }) => {
  await page.route('**/api/marketing-agency', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/#marketing-agency');
  await expect(page.locator('[data-agency-status]')).toContainText('Agency status unavailable');
  await expect(page.locator('[data-agency-funded]')).toHaveText('Unavailable');
  await page.unroute('**/api/marketing-agency');
  await page.locator('[data-agency-refresh]').click();
  await expect(page.locator('[data-agency-status]')).toContainText('Not activated');
});

test('unverified active API claims cannot advertise working agency agents', async ({ page }) => {
  await page.route('**/api/marketing-agency', route => route.fulfill({ json: {
    ...marketingAgencyCapabilities(), active: true, executionEnabled: true,
    funding: { status: 'verified', collectedLamports: '100000000000' } } }));
  await page.goto('/#marketing-agency');
  await expect(page.locator('[data-agency-status]')).toContainText('Agency status unavailable');
  await expect(page.locator('[data-agency-funded]')).toHaveText('Unavailable');
});
