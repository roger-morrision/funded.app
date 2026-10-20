import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
const mint = '9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
const signature = 'fixture-premier-launch';
const launch = { mint, cluster: 'devnet', onchainVerified: true, creatorWallet: mint,
  signature, name: 'Premier layout fixture', symbol: 'PKG',
  creatorLaunchBurn: { tier: 'premier', amountTokens: 250000, status: 'verified',
    receipt: { verified: true, atomicWithPumpLaunch: true, signature } } };

for (const width of [360, 390, 430, 1440]) {
  test(`FQA-014 / UX-015 trade action leaves token links reachable at ${width}px (mocked API)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.route('https://**/*', route => route.abort());
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Offline layout fixture' } }));
    await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
    await page.route('**/api/launches', route => route.fulfill({ json: [launch] }));
    await page.goto(`/token/${mint}`);
    await expect(page.locator('.coin-hero-card')).toHaveAttribute('data-launch-tier', 'premier');
    await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
    const action = page.locator('.mobile-trade-open');
    if (width === 1440) { await expect(action).toBeHidden(); return; }
    await expect(action).toBeVisible();
    await expect(action).toHaveAccessibleName(/^(Trade token|View trade status)$/);
    for (const top of [0, 160, 450, 850]) {
      await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), top);
      const overlaps = await action.evaluate(button => {
        const a = button.getBoundingClientRect();
        return [...document.querySelectorAll('#coin-page a[href],#coin-page button,#coin-page input,#coin-page summary')]
          .filter(element => element !== button && element.getClientRects().length)
          .filter(element => { const b = element.getBoundingClientRect();
            return b.bottom > 64 && b.top < innerHeight - 84
              && Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1
              && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1; })
          .map(element => element.textContent.trim());
      });
      expect(overlaps).toEqual([]);
    }
    const packageLink = page.locator('.coin-package-rail .is-premier');
    await packageLink.scrollIntoViewIfNeeded();
    await packageLink.evaluate(link => link.scrollIntoView({ behavior: 'instant', block: 'center' }));
    expect(await packageLink.evaluate(link => {
      const r = link.getBoundingClientRect();
      return [.1, .5, .9].every(dx => [.1, .5, .9].every(dy =>
        link.contains(document.elementFromPoint(r.x + r.width * dx, r.y + r.height * dy))));
    })).toBe(true);
    await page.evaluate(() => scrollTo({ top: 200, behavior: 'instant' }));
    await packageLink.evaluate(link => link.focus({ preventScroll: true }));
    await page.keyboard.press('Tab');
    await expect(page.locator('#coin-profile-about-tab')).toBeFocused();
    const sequence = [];
    for (let index = 0; index < 20; index++) {
      sequence.push(await page.evaluate(() => ({ id: document.activeElement.id,
        trade: document.activeElement.classList.contains('mobile-trade-open'),
        top: document.activeElement.getBoundingClientRect().top + scrollY })));
      if (sequence.at(-1).trade) break;
      await page.keyboard.press('Tab');
    }
    expect(sequence.some(item => item.trade), JSON.stringify(sequence)).toBe(true);
    const tradeTop = sequence.at(-1).top;
    await expect(action).toBeFocused();
    const focusGeometry = await action.evaluate(element => {
      const box = element.getBoundingClientRect(), nav = document.querySelector('.mobile-workspace-nav').getBoundingClientRect();
      return { focusVisible: element.matches(':focus-visible'), outline: getComputedStyle(element).outlineStyle,
        top: Math.round(box.top), bottom: Math.round(box.bottom), navTop: Math.round(nav.top),
        clearOfNav: box.top >= 64 && box.bottom <= nav.top };
    });
    expect(focusGeometry).toMatchObject({ focusVisible: true, outline: 'solid', clearOfNav: true });
    await page.keyboard.press('Tab');
    await expect(action).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement.getBoundingClientRect().top + scrollY)).toBeGreaterThanOrEqual(tradeTop);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
