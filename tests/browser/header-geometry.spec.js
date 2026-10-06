import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Offline layout fixture"}' }));
  await page.route('https://**/*', route => route.abort());
});

for (const width of [1440, 1024, 901, 390]) test(`launch navigation remains usable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#launch-route-title')).toBeVisible();
  if (width >= 1180 || width <= 700) await expect(page.locator('#header-search-trigger')).toBeVisible();
  await expect(page.locator('#connect-button')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const selector of width >= 1180 || width <= 700 ? ['#header-search-trigger', '#connect-button'] : ['#connect-button']) {
    expect(await page.locator(selector).evaluate(element => {
      const box = element.getBoundingClientRect();
      const point = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return element === point || element.contains(point);
    }), `${selector} must not be covered`).toBe(true);
  }
});

test('mobile menu restores keyboard focus after closing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('#open-menu').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#open-menu')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#close-menu')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#open-menu')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#open-menu')).toBeFocused();
});
