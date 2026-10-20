import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
const mint = 'BHFsQA2xqgGXVuHeTngQY8t6mNaaHwVZdXcYuzigNAHK';
const signature = 'fixture-premier-launch';
const launch = { mint, cluster: 'devnet', onchainVerified: true, creatorWallet: mint,
  signature, name: 'Fee premier QA', symbol: 'PREM',
  creatorLaunchBurn: { tier: 'premier', amountTokens: 250000, status: 'verified',
    receipt: { verified: true, atomicWithPumpLaunch: true, signature } } };

for (const reducedMotion of ['no-preference', 'reduce']) for (const width of [360, 390, 430, 1440]) {
  test(`FQA-015 / UX-016 focused profile controls clear fixed navigation at ${width}px, motion ${reducedMotion} (mocked API)`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.route('https://**/*', route => route.abort());
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Offline layout fixture' } }));
    await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
    await page.route('**/api/launches', route => route.fulfill({ json: [launch] }));
    await page.goto(`/token/${mint}`);
    await expect(page.locator('.coin-hero-card')).toHaveAttribute('data-launch-tier', 'premier');
    await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
    const link = page.locator('.coin-package-rail .is-premier');
    const about = page.locator('#coin-profile-about-tab'), updates = page.locator('#coin-profile-updates-tab');
    const clear = async control => {
      const geometry = await control.evaluate(element => {
        const r = element.getBoundingClientRect(), style = getComputedStyle(element);
        const margin = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
        const nav = document.querySelector('.mobile-workspace-nav'), header = document.querySelector('.topbar');
        const top = header?.getClientRects().length ? header.getBoundingClientRect().bottom : 0;
        const bottom = nav?.getClientRects().length ? nav.getBoundingClientRect().top : innerHeight;
        return { top: r.top, bottom: r.bottom, viewportTop: top, viewportBottom: bottom, margin,
          visible: r.top - margin >= top && r.bottom + margin <= bottom,
          hit: element.contains(document.elementFromPoint(r.x + r.width / 2, r.bottom - 3)),
          outline: style.outlineStyle, focusVisible: element.matches(':focus-visible') };
      });
      expect(geometry, JSON.stringify(geometry)).toMatchObject({ visible: true, hit: true, outline: 'solid', focusVisible: true });
    };
    for (const top of [0, 200]) {
      await page.evaluate(top => document.scrollingElement.scrollTo({ top, behavior: 'instant' }), top);
      await link.evaluate(element => element.focus({ preventScroll: true }));
      await page.keyboard.press('Tab');
      await expect(about).toBeFocused();
      await clear(about);
      if (top === 0) await page.screenshot({ path: testInfo.outputPath('about-focused.png') });
      await page.keyboard.press('ArrowRight');
      await expect(updates).toBeFocused();await expect(updates).toHaveAttribute('aria-selected', 'true');
      await clear(updates);
      await page.keyboard.press('ArrowLeft');await expect(about).toBeFocused();await clear(about);
      await page.keyboard.press('Tab');await expect(page.locator('#coin-profile-about')).toBeFocused();
      await page.keyboard.press('Shift+Tab');await expect(about).toBeFocused();await clear(about);
      const refresh = await page.evaluate(() => {
        const content = document.querySelector('.main-content');
        const before = [scrollY, content.scrollTop], focused = document.activeElement;
        window.fundedSetCoinProfileMetadata({});
        return { stationary: scrollY === before[0] && content.scrollTop === before[1], sameFocus: document.activeElement === focused };
      });
      expect(refresh).toEqual({ stationary: true, sameFocus: true });
      await page.keyboard.press('Shift+Tab');await expect(link).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
