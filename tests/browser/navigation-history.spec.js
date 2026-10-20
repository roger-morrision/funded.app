import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const mint = 'BHFsQA2xqgGXVuHeTngQY8t6mNaaHwVZdXcYuzigNAHK';
for (const width of [1440, 390]) {
  test(`FQA-017 pathname and hash history restores the visible route at ${width}px (mocked APIs)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async value => { window.qaCopiedMint = value; } },
    }));
    await page.route('https://**/*', route => route.abort());
    await page.route('**/api/**', route => new URL(route.request().url()).pathname === '/api/fee-policy'
      ? route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } })
      : route.fulfill({ status: 503, json: { error: 'Offline navigation fixture' } }));
    const route = async (name, selector, active) => {
      await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
      await expect(page.locator('body')).toHaveClass(/workspace-ready/);
      await expect(page.locator('body')).toHaveClass(new RegExp(`page-route-${name}(?: |$)`));
      await expect(page.locator(selector)).toBeVisible();
      await expect(page.locator(`.primary-nav > a[href="#${active}"]`)).toHaveAttribute('aria-current', 'page');
      if (width === 390) await expect(page.locator('#sidebar')).toHaveAttribute('inert', '');
    };
    const agency = async (target = 'marketing-agency') => {
      if (width === 390) await page.locator('#open-menu').click();
      await page.locator(`.primary-nav > a[href="#${target}"]`).click();
      await route(target, target === 'overview' ? '.hero-section' : `#${target}`, target);
    };
    await page.goto('/#marketing-agency');
    await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
    for (const target of ['marketing-agency', 'overview', 'explore']) {
      await page.goto(`/token/${mint}`);
      await route('coin', '#coin-page', 'explore');
      await expect(page).toHaveTitle('Token · funded.vip');
      const directTitle = await page.title(), historyLength = await page.evaluate(() => history.length);
      await page.locator('#coin-copy-address').click();
      expect(await page.evaluate(() => window.qaCopiedMint)).toBe(mint);
      await agency(target);
      await expect(page).toHaveURL(new RegExp(`/#${target}$`));
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/token/${mint}$`));
      await route('coin', '#coin-page', 'explore');
      await expect(page).toHaveTitle(directTitle);
      await expect(page.locator('#marketing-agency')).not.toBeVisible();
      await page.evaluate(() => { window.qaCopiedMint = null; });
      await page.locator('#coin-copy-address').click();
      expect(await page.evaluate(() => window.qaCopiedMint)).toBe(mint);
      expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
      await page.reload();await route('coin', '#coin-page', 'explore');
      await page.goForward();await route(target, target === 'overview' ? '.hero-section' : `#${target}`, target);
    }
    await agency();
    if (width === 390) await page.locator('#open-menu').click();
    await page.locator('.primary-nav > a[href="#explore"]').click();
    await route('explore', '#explore', 'explore');
    await page.goBack();await route('marketing-agency', '#marketing-agency', 'marketing-agency');
    await page.goForward();await route('explore', '#explore', 'explore');
    await page.goto(`/#coin/${mint}`);await route('coin', '#coin-page', 'explore');
    await agency();await page.goBack();await route('coin', '#coin-page', 'explore');
    await page.goForward();await route('marketing-agency', '#marketing-agency', 'marketing-agency');
    await page.goto(`/wallet/${mint}`);await route('wallet', '#wallet-page', 'my-launches');
    await agency();await page.goBack();await route('wallet', '#wallet-page', 'my-launches');
    await page.goForward();await route('marketing-agency', '#marketing-agency', 'marketing-agency');
    await page.goto('/#creators');await expect(page).toHaveTitle(/^Creators [·|] funded.vip/);
    await agency();await expect(page).toHaveTitle('AI Marketing · funded.vip');
    await page.goBack();await expect(page).toHaveTitle(/^Creators [·|] funded.vip/);
    await page.goForward();await route('marketing-agency', '#marketing-agency', 'marketing-agency');
    await expect(page).toHaveTitle('AI Marketing · funded.vip');
  });
}
