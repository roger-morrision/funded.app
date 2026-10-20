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
    await expect(page.locator('#coin-page-title')).toHaveText('Fee premier QA');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
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
      await page.evaluate(() => {
        document.querySelector('#coin-creator-by').hidden = true;
        document.querySelector('#coin-launched-by')?.remove();
      });
      await page.evaluate(top => document.scrollingElement.scrollTo({ top, behavior: 'instant' }), top);
      await link.evaluate(element => element.focus({ preventScroll: true }));
      await page.keyboard.press('Tab');
      await expect(about).toBeFocused();
      await clear(about);
      const before = await about.evaluate(e => ({ y: e.getBoundingClientRect().top, scrollY }));
      await page.evaluate(() => {
        const owner = document.querySelector('#coin-creator-by');
        owner.textContent = 'Fee owner 84c4eV…U9xDPS'; owner.hidden = false;
        const creator = document.createElement('span'); creator.id = 'coin-launched-by';
        creator.textContent = 'Launched by 8ZCtLW…Gvn1Wk'; owner.parentElement.append(creator);
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      expect(await about.evaluate(e => ({ y: e.getBoundingClientRect().top, scrollY }))).toEqual(before);
      await expect(about).toBeFocused();await clear(about);
      if (top === 0) await page.screenshot({ path: testInfo.outputPath('about-focused.png') });
      await page.keyboard.press('ArrowRight');
      await expect(updates).toBeFocused();await expect(updates).toHaveAttribute('aria-selected', 'true');
      await clear(updates);
      await page.keyboard.press('ArrowLeft');await expect(about).toBeFocused();await clear(about);
      await page.keyboard.press('Tab');await expect(page.locator('#coin-profile-about')).toBeFocused();
      if (width !== 1440) await clear(page.locator('#coin-profile-about'));
      if (width === 390 && top === 0) {
        await page.locator('#coin-profile-about').evaluate(e => {
          const paragraph = document.createElement('div');paragraph.id = 'long-profile-fixture';
          paragraph.style.whiteSpace = 'pre-wrap';
          paragraph.textContent = 'Long project profile.\n'.repeat(100);e.append(paragraph);
        });
        expect(await page.locator('#coin-profile-about').evaluate(e => e.getBoundingClientRect().height > innerHeight)).toBe(true);
        await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
        await expect(page.locator('#coin-profile-about')).toBeFocused();
        const scrollPosition = await page.evaluate(() => document.scrollingElement.scrollTop);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop)).toBeGreaterThan(scrollPosition);
        await page.locator('#long-profile-fixture').evaluate(e => e.remove());
      }
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
