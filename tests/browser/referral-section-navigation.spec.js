import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const liveBase = process.env.UX003_LIVE_BASE;
test.beforeEach(async ({ page }) => {
  if (liveBase) {
    await page.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
      ? route.continue() : route.abort());
  } else {
    await page.route('**/api/**', route => new URL(route.request().url()).pathname === '/api/fee-policy'
      ? route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } })
      : route.fulfill({ status: 503, json: { error: 'Offline navigation fixture' } }));
    await page.route('https://**/*', route => route.abort());
  }
});

async function ready(page, hash) {
  await page.goto(`${liveBase || ''}/#${hash}`);
  await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
  await page.evaluate(() => document.fonts.ready);
}

async function visibleGuide(page) {
  await expect(page).toHaveURL(/#referral-faq$/);
  await expect(page.locator('body')).toHaveClass(/page-route-referrals/);
  const heading = page.locator('#referral-faq h2');
  await expect(heading).toBeFocused();
  // Wait beyond the route/layout callbacks and default smooth-scroll duration.
  await page.waitForTimeout(600);
  const geometry = await heading.evaluate(node => {
    const box = node.getBoundingClientRect();
    const header = document.querySelector('.topbar').getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, headerBottom: header.bottom,
      height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth,
      guideVisible: document.querySelector('#referral-faq .faq-grid').getBoundingClientRect().top < innerHeight,
      mobileRoute: document.querySelector('.mobile-workspace-nav a[aria-current="page"]')?.hash };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(Math.max(0, geometry.headerBottom));
  expect(geometry.bottom).toBeLessThan(geometry.height);
  expect(geometry.guideVisible).toBe(true);
  expect(geometry.overflow).toBe(false);
  expect(geometry.mobileRoute).toBe('#payments');
  await expect(heading).toHaveAttribute('tabindex', '-1');
  await expect(heading).toBeFocused();
}

for (const width of [390, 1440]) for (const reducedMotion of ['no-preference', 'reduce']) {
  test.describe(`${width}px ${reducedMotion}`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion });

    test('both guide links reveal visible focus by click, Enter and repeated activation', async ({ page }) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const selector of ['.referral-tier-strip a[href="#referral-faq"]', '#route-guide a[href="#referral-faq"]']) {
        for (const keyboard of [false, true]) {
          await ready(page, 'referrals');
          const link = page.locator(selector);
          if (keyboard) { await link.focus(); await link.press('Enter'); } else await link.click();
          await visibleGuide(page);
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
          await link.focus(); await link.press('Enter');
          await visibleGuide(page);
          await page.keyboard.press('Tab');
          await expect(page.locator('#referral-faq h2')).not.toBeFocused();
        }
      }
      expect(errors).toEqual([]);
    });

    test('direct fragment, reload and history reveal the guide; ordinary routes start at top', async ({ page }) => {
      await ready(page, 'referral-faq');
      await visibleGuide(page);
      await page.reload();
      await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
      await visibleGuide(page);
      await page.locator(width === 390 ? '.mobile-workspace-nav a[href="#launch"]' : '.topbar a[href="#launch"]').click();
      await expect(page).toHaveURL(/#launch$/);
      await page.waitForTimeout(600);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await expect(page.getByRole('heading', { name: 'Launch a token', exact: true })).toBeInViewport();
      await page.goBack();
      await visibleGuide(page);
      await page.goForward();
      await expect(page).toHaveURL(/#launch$/);
      await page.waitForTimeout(600);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await page.goBack();
      await visibleGuide(page);
    });
  });
}
