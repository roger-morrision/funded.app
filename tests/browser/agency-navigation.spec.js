import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => new URL(route.request().url()).pathname === '/api/fee-policy'
    ? route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } })
    : route.fulfill({ status: 503, json: { error: 'Offline navigation fixture' } }));
});

for (const width of [1440, 1918, 1180, 1179, 1024, 901, 390]) {
  test(`FQA-016 / UX-017 Agency shares the responsive navigation at ${width}px (mocked APIs)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1918 ? 1043 : width === 390 ? 844 : 900 });
    const ready = async () => {
      await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
      await page.evaluate(() => document.fonts.ready);
    };
    const shell = async () => {
      await ready();
      if (width < 1180) await expect(page.locator('#sidebar')).toHaveCSS('width', width === 390 ? '250px' : '220px');
      const geometry = await page.locator('#sidebar').evaluate(e => {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        return { direction: s.flexDirection, position: s.position, width: Math.round(r.width), height: Math.round(r.height) };
      });
      if (width >= 1180) {
        expect(geometry).toMatchObject({ direction: 'row', position: 'sticky', height: 58 });
        await expect(page.locator('.main-content')).toHaveCSS('margin-left', '0px');
        expect(await page.locator('#marketing-agency').evaluate(e => !e.getClientRects().length || e.getBoundingClientRect().top >= document.querySelector('#sidebar').getBoundingClientRect().bottom)).toBe(true);
      } else expect(geometry).toMatchObject({ direction: 'column', width: width === 390 ? 250 : 220 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      return geometry;
    };
    await page.goto('/#marketing-agency');
    await expect(page.locator('#marketing-agency')).toBeVisible();
    const agency = await shell();
    await expect(page.locator('.primary-nav a[href="#marketing-agency"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-agency-status]')).toContainText('unavailable');
    await page.screenshot({ path: testInfo.outputPath('agency.png') });
    const destinations = await page.locator('.primary-nav > a').evaluateAll(rows => rows.map(e => e.getAttribute('href')));
    if (width === 390) {
      await expect(page.locator('#sidebar')).toHaveAttribute('inert', '');
      await page.locator('#open-menu').focus();await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.querySelector('#sidebar').contains(document.activeElement))).toBe(false);
      await page.locator('#open-menu').click();await expect(page.locator('#close-menu')).toBeFocused();
      await page.keyboard.press('Escape');await expect(page.locator('#open-menu')).toBeFocused();
      await expect(page.locator('#sidebar')).toHaveAttribute('inert', '');
      await expect(page.locator('.mobile-workspace-nav')).toBeVisible();
      await page.locator('#open-menu').click();
    }
    await page.locator('.primary-nav > a[href="#explore"]').click();
    await expect(page.locator('body')).toHaveClass(/page-route-explore/);
    expect(await shell()).toEqual(agency);
    expect(await page.locator('.primary-nav > a').evaluateAll(rows => rows.map(e => e.getAttribute('href')))).toEqual(destinations);
    if (width === 390) await page.locator('#open-menu').click();
    await page.locator('.primary-nav > a[href="#marketing-agency"]').click();
    await expect(page.locator('#marketing-agency')).toBeVisible();await shell();
    await page.reload();await expect(page.locator('#marketing-agency')).toBeVisible();await shell();
    if (width >= 1180) {
      for (const selector of ['#connect-button', '.top-actions .create-coin-button', '.nav-more > summary', width >= 1500 ? '.topbar .search-box' : '#header-search-trigger']) {
        await expect(page.locator(selector)).toBeVisible();
        expect(await page.locator(selector).evaluate(e => { const r = e.getBoundingClientRect();return [.1,.5,.9].every(dx => [.1,.5,.9].every(dy => e.contains(document.elementFromPoint(r.x+r.width*dx,r.y+r.height*dy)))); }), selector).toBe(true);
      }
      await page.locator('.nav-more > summary').click();await expect(page.locator('.nav-more-menu')).toBeVisible();
      await page.locator('.nav-more > summary').click();
      if (width < 1500) { await page.locator('#header-search-trigger').click();await expect(page.locator('#header-search-dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#header-search-trigger')).toBeFocused(); }
      await page.locator('.primary-nav > a[href="#overview"]').click();
      await expect(page.locator('body')).toHaveClass(/page-route-overview/);await shell();
      for (const selector of ['#connect-button', '.top-actions .create-coin-button', '.nav-more > summary', width >= 1500 ? '.topbar .search-box' : '#header-search-trigger']) {
        await expect(page.locator(selector)).toBeVisible();
        expect(await page.locator(selector).evaluate(e => { const r = e.getBoundingClientRect();return [.1,.5,.9].every(dx => [.1,.5,.9].every(dy => e.contains(document.elementFromPoint(r.x+r.width*dx,r.y+r.height*dy)))); }), `Home ${selector}`).toBe(true);
      }
      await page.goBack();await expect(page.locator('#marketing-agency')).toBeVisible();await shell();
      await page.goForward();await expect(page.locator('body')).toHaveClass(/page-route-overview/);await shell();
      await page.goto('/token/9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B');await shell();
      await page.locator('.primary-nav > a[href="#marketing-agency"]').click();await expect(page.locator('#marketing-agency')).toBeVisible();await shell();
    } else {
      if (width === 390) await page.locator('#open-menu').click();
      await page.locator('.primary-nav > a[href="#overview"]').click();
      await expect(page.locator('body')).toHaveClass(/page-route-overview/);await shell();
      await page.reload();await expect(page.locator('body')).toHaveClass(/page-route-overview/);await shell();
      if (width === 1179) {
        await page.locator('#desktop-sidebar-toggle').click();
        await expect(page.locator('#sidebar')).toHaveCSS('width', '76px');
        await expect(page.locator('.main-content')).toHaveCSS('margin-left', '76px');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.locator('#desktop-sidebar-toggle').click();await shell();
      }
      await page.goBack();await expect(page.locator('#marketing-agency')).toBeVisible();await shell();
      await page.goForward();await expect(page.locator('body')).toHaveClass(/page-route-overview/);await shell();
      await page.goto('/token/9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B');await shell();
      if (width === 390) await page.locator('#open-menu').click();
      await page.locator('.primary-nav > a[href="#marketing-agency"]').click();await expect(page.locator('#marketing-agency')).toBeVisible();await shell();
    }
  });
}
