import { test, expect } from '@playwright/test';
import { PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const listedMint = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const absentMint = new PublicKey(new Uint8Array(32).fill(8)).toBase58();
const favoriteKey = 'funded.app.community.watchlist';
const guestFavoriteKey = 'funded.app.watchlist.guest.v1';
const followedKey = 'funded.app.followed.wallets.v1';
const launches = [{ mint: listedMint, name: 'Browse recovery fixture', symbol: 'BROWSE',
  cluster: 'devnet', onchainVerified: true, creatorWallet: '11111111111111111111111111111111' }];

for (const [width, height] of [[390, 844], [1440, 900]]) {
  for (const cohort of ['following', 'favorites', 'absent favorite']) {
    test(`UX-009 ${cohort} Table recovery at ${width}px (mocked launches)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(({ favoriteKey, guestFavoriteKey, followedKey, absentMint, cohort }) => {
        localStorage.setItem(favoriteKey, JSON.stringify(cohort === 'absent favorite' ? [absentMint] : []));
        localStorage.setItem(guestFavoriteKey, JSON.stringify({ mints: cohort === 'absent favorite' ? [absentMint] : [],
          importId: '00000000-0000-4000-8000-000000000009', targetAccount: null }));
        localStorage.setItem(followedKey, '[]');
      }, { favoriteKey, guestFavoriteKey, followedKey, absentMint, cohort });
      await page.route('https://**/*', route => route.abort());
      await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Offline fixture' } }));
      await page.route('**/api/x/me', route => route.fulfill({ json: { authenticated: false, configured: false } }));
      await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
      await page.route('**/api/launches', route => route.fulfill({ json: launches }));
      await page.route('**/api/pump/explore?*', route => route.fulfill({ json: { items: [], fetchedAt: new Date().toISOString() } }));
      await page.goto('/#explore');
      await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
      await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(1);
      const storageKeys = [favoriteKey, guestFavoriteKey, followedKey];
      const baselineStorage = await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), storageKeys);
      const tab = cohort === 'following' ? 'following' : 'favorites';
      const expectedReason = cohort === 'following' ? 'No followed wallets yet.'
        : cohort === 'favorites' ? 'No favorite tokens yet.' : 'Saved tokens are unavailable in this feed.';

      for (const activation of ['pointer', 'keyboard']) {
        await page.locator(`.explore-tabs button[data-explore-tab="${tab}"]`).click();
        await expect(page.locator('#asset-grid .empty-state strong')).toHaveText(expectedReason);
        await expect(page.locator('#asset-grid .explore-empty-action')).toHaveText('View all tokens');
        await page.locator('button[data-explore-view="table"]').click();
        await page.locator('#explore-search').fill('edited search');
        await expect(page.locator('#launch-list .empty-state strong')).toHaveText(expectedReason);
        const action = page.locator('#launch-list .explore-empty-action');
        await expect(action).toHaveText('View all tokens');
        const geometry = await action.evaluate(node => {
          const box = node.getBoundingClientRect();
          const scroll = node.closest('.scanner-scroll');
          const viewport = scroll.getBoundingClientRect();
          return { left: box.left, right: box.right, scrollLeft: scroll.scrollLeft,
            viewportLeft: viewport.left, viewportRight: viewport.right, pageWidth: document.documentElement.scrollWidth, windowWidth: innerWidth };
        });
        expect(geometry.scrollLeft, JSON.stringify(geometry)).toBe(0);
        expect(geometry.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.viewportLeft);
        expect(geometry.right, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewportRight);
        expect(geometry.pageWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.windowWidth);
        if (activation === 'pointer') await action.click();
        else {
          await page.keyboard.press('Shift');
          await action.focus();
          await expect(action).toBeFocused();
          expect(await action.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
          await page.keyboard.press('Enter');
        }
        await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#launch-list .scanner-row')).toHaveCount(1);
        await expect(page.locator('#explore-search')).toHaveValue('');
        await expect(page.locator('#explore-search')).toBeFocused();
        await expect(page.locator('.explore-tabs button[data-explore-tab="trending"]')).toHaveAttribute('aria-pressed', 'true');
        const searchVisible = await page.locator('#explore-search').evaluate(node => {
          const box = node.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
        });
        expect(searchVisible).toBe(true);
        expect(await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), storageKeys)).toEqual(baselineStorage);
      }
      if (cohort === 'following') {
        await page.locator('button[data-explore-view="grid"]').click();
        await page.locator('.explore-tabs button[data-explore-tab="following"]').click();
        const gridAction = page.locator('#asset-grid .explore-empty-action');
        await gridAction.evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await gridAction.click();
        await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(1);
        await expect(page.locator('#explore-search')).toBeFocused();
        const focusGeometry = await page.locator('#explore-search').evaluate(node => {
          const box = node.getBoundingClientRect();
          const header = document.querySelector('.topbar')?.getBoundingClientRect();
          const nav = document.querySelector('.mobile-workspace-nav');
          const navBox = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect() : null;
          return { top: box.top, bottom: box.bottom, visibleTop: header && ['fixed', 'sticky'].includes(getComputedStyle(document.querySelector('.topbar')).position) ? header.bottom : 0,
            visibleBottom: navBox?.top ?? innerHeight };
        });
        expect(focusGeometry.top, JSON.stringify(focusGeometry)).toBeGreaterThanOrEqual(focusGeometry.visibleTop);
        expect(focusGeometry.bottom, JSON.stringify(focusGeometry)).toBeLessThanOrEqual(focusGeometry.visibleBottom);
      }
    });
  }
}
