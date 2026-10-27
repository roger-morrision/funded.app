import { test, expect, chromium } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

for (const scale of [1.25, 1.5]) {
  test.describe(`FQA-016 fractional desktop scale ${scale}`, () => {
    test('Home content stays clear of the tablet sidebar at a fractional CSS width (mocked APIs)', async ({}, testInfo) => {
      const nativeLaunchWidth=process.platform==='win32'?({1.25:1195,1.5:1197})[scale]:({1.25:1177,1.5:1179})[scale];
      const browser = await chromium.launch({ headless: true,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        args: [`--force-device-scale-factor=${scale}`, `--window-size=${nativeLaunchWidth},1000`] });
      const page = await browser.newPage({ viewport: null });
      try {
      await page.route('https://**/*', route => route.abort());
      await page.route('**/api/**', route => new URL(route.request().url()).pathname === '/api/fee-policy'
        ? route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } })
        : route.fulfill({ status: 503, json: { error: 'Offline fractional-layout fixture' } }));
      const clearance = async label => {
        await expect(page.locator('body')).toHaveClass(/workspace-ready/);
        await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
        await page.evaluate(() => document.fonts.ready);
        const media = await page.evaluate(() => ({
          roundedWidth: innerWidth, dpr: devicePixelRatio,
          oldTablet: matchMedia('(max-width:1179px)').matches,
          desktop: matchMedia('(min-width:1180px)').matches,
          tablet: matchMedia('(width < 1180px)').matches,
        }));
        expect(media, 'Exercise the real fractional gap, not a rounded integer viewport').toMatchObject({ roundedWidth: 1179, oldTablet: false, desktop: false, tablet: true });
        await testInfo.attach(`${label} viewport`, { body: JSON.stringify(media), contentType: 'application/json' });
        await page.screenshot({ path: testInfo.outputPath(`${label.replaceAll(' ', '-')}.png`) });
        await expect(page.locator('#sidebar')).toHaveCSS('width', '220px');
        await expect(page.locator('.main-content')).toHaveCSS('margin-left', '220px');
        const geometry = await page.evaluate(() => {
          const sidebar = document.querySelector('#sidebar').getBoundingClientRect();
          const main = document.querySelector('.main-content').getBoundingClientRect();
          const hero = document.querySelector('.hero-section h1').getBoundingClientRect();
          return { sidebarRight: sidebar.right, mainLeft: main.left, mainRight: main.right, heroLeft: hero.left,
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        expect(geometry.mainLeft).toBeGreaterThanOrEqual(geometry.sidebarRight);
        expect(geometry.heroLeft).toBeGreaterThanOrEqual(geometry.sidebarRight);
        expect(geometry.overflow).toBe(false);
        await testInfo.attach(label, { body: JSON.stringify({ media, geometry }), contentType: 'application/json' });
      };
      await page.goto('/#overview');await clearance('direct Home');
      await page.screenshot({ path: testInfo.outputPath('fractional-home.png') });
      await page.locator('.primary-nav > a[href="#marketing-agency"]').click();
      await expect(page.locator('#marketing-agency')).toBeVisible();
      await expect(page.locator('.main-content')).toHaveCSS('margin-left', '220px');
      await page.locator('.primary-nav > a[href="#overview"]').click();
      await expect(page.locator('body')).toHaveClass(/page-route-overview/);await clearance('native Home');
      await page.reload();await clearance('reloaded Home');
      } finally { await browser.close(); }
    });
  });
}
