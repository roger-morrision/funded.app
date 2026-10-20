import { test, expect } from '@playwright/test';
import { PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const launches = [66, 67].map((value, index) => ({
  mint: new PublicKey(new Uint8Array(32).fill(value)).toBase58(),
  name: `QA recovery ${index}`, symbol: `QR${index}`, cluster: 'devnet', onchainVerified: true,
  creatorWallet: '11111111111111111111111111111111',
}));
const savedMint = new PublicKey(new Uint8Array(32).fill(68)).toBase58();

async function prepare(page, width, fixture) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.addInitScript(mint => {
    localStorage.setItem('funded.app.community.watchlist', JSON.stringify([mint]));
    localStorage.setItem('funded.app.watchlist.guest.v1', JSON.stringify({ mints: [mint],
      importId: '00000000-0000-4000-8000-000000000011', targetAccount: null }));
    localStorage.setItem('funded.app.followed.wallets.v1', '[]');
  }, savedMint);
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Controlled offline fixture' } }));
  await page.route('**/api/x/me', route => route.fulfill({ json: { authenticated: false, configured: false } }));
  await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
  await page.route('**/api/launches', route => route.fulfill(fixture.available
    ? { json: launches } : { status: 503, json: { error: 'Controlled outage' } }));
  await page.route('**/api/pump/explore?*', async route => {
    if (!fixture.available) return route.fulfill({ status: 503, json: { error: 'Controlled outage' } });
    fixture.retryStarted?.();
    if (fixture.hold) await fixture.hold;
    return route.fulfill({ json: { items: [], fetchedAt: new Date().toISOString() } });
  });
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
  await expect(page.locator('#asset-grid [data-explore-empty-action="retry"]')).toBeVisible();
  await page.waitForTimeout(400);
}

for (const width of [390, 1440]) {
  for (const activation of ['pointer', 'keyboard']) {
    test(`FQA-011 first ${activation} Grid retry reveals recovered feed at ${width}px (mocked APIs)`, async ({ page }) => {
      const fixture = { available: false };
      await prepare(page, width, fixture);
      const saved = await page.evaluate(() => localStorage.getItem('funded.app.watchlist.guest.v1'));
      await page.locator('#explore-search').fill('QA recovery');
      fixture.available = true;
      const retry = page.locator('#asset-grid [data-explore-empty-action="retry"]');
      if (activation === 'pointer') await retry.click();
      else { await page.keyboard.press('Shift'); await retry.focus(); await page.keyboard.press('Enter'); }
      await expect(page.locator('#launch-list .scanner-row')).toHaveCount(2);
      await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(2);
      await expect(page.locator('#explore-search')).toBeFocused();
      await expect(page.locator('#explore-search')).toHaveValue('QA recovery');
      const visibleFocus = await page.locator('#explore-search').evaluate(node => {
        const box = node.getBoundingClientRect();
        const nav = document.querySelector('.mobile-workspace-nav');
        const bottom = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : innerHeight;
        return box.top >= 0 && box.bottom <= bottom && box.left >= 0 && box.right <= innerWidth;
      });
      expect(visibleFocus).toBe(true);
      await expect(page.locator('button[data-explore-view="grid"]')).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => localStorage.getItem('funded.app.watchlist.guest.v1'))).toBe(saved);
    });
  }

  test(`FQA-011 failed Grid retry keeps a usable truthful outage at ${width}px (mocked APIs)`, async ({ page }) => {
    const fixture = { available: false };
    await prepare(page, width, fixture);
    const saved = await page.evaluate(() => localStorage.getItem('funded.app.watchlist.guest.v1'));
    await page.locator('#explore-search').fill('unchanged query');
    await page.locator('#explore-filter-toggle').click();
    await page.locator('#explore-promotion-filter').selectOption('premier');
    await page.keyboard.press('Escape');
    await page.locator('#asset-grid [data-explore-empty-action="retry"]').click();
    await expect(page.locator('#asset-grid .empty-state strong')).toHaveText('Tokens are temporarily unavailable.');
    await expect(page.locator('#asset-grid [data-explore-empty-action="retry"]')).toBeVisible();
    await expect(page.locator('#asset-grid [data-explore-empty-action="retry"]')).toBeFocused();
    await expect(page.locator('#explore-search')).toHaveValue('unchanged query');
    await expect(page.locator('#explore-promotion-filter')).toHaveValue('premier');
    expect(await page.evaluate(() => localStorage.getItem('funded.app.watchlist.guest.v1'))).toBe(saved);
  });

  test(`FQA-011 Table outage retry still recovers at ${width}px (mocked APIs)`, async ({ page }) => {
    const fixture = { available: false };
    await prepare(page, width, fixture);
    await page.locator('button[data-explore-view="table"]').click();
    await expect(page.locator('#launch-list .empty-state strong')).toHaveText('Tokens are temporarily unavailable.');
    fixture.available = true;
    await page.locator('#launch-list [data-verified-feed-retry]').click();
    await expect(page.locator('#launch-list .scanner-row')).toHaveCount(2);
    await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
  });

  for (const departure of ['search', 'table', 'route']) {
    test(`FQA-011 late retry completion respects ${departure} at ${width}px (mocked APIs)`, async ({ page }) => {
      let release;
      const hold = new Promise(resolve => { release = resolve; });
      let started;
      const requestStarted = new Promise(resolve => { started = resolve; });
      const fixture = { available: false, hold, retryStarted: started };
      await prepare(page, width, fixture);
      fixture.available = true;
      await page.locator('#asset-grid [data-explore-empty-action="retry"]').click();
      await requestStarted;
      if (departure === 'search') await page.locator('#explore-search').click();
      else if (departure === 'table') await page.locator('button[data-explore-view="table"]').click();
      else {
        const home = width === 390
          ? page.getByRole('navigation', { name: 'Mobile workspace' }).getByRole('link', { name: 'Home' })
          : page.locator('#sidebar a.nav-item[href="#overview"]');
        await home.click();
        await expect(page.locator('body')).toHaveClass(/page-route-overview/);
      }
      release();
      await expect(page.locator('#launch-list .scanner-row')).toHaveCount(2);
      if (departure === 'search') await expect(page.locator('#explore-search')).toBeFocused();
      else if (departure === 'table') {
        await expect(page.locator('button[data-explore-view="table"]')).toBeFocused();
        await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
      } else {
        await expect(page).toHaveURL(/#overview$/);
        await expect(page.locator('#explore-search')).not.toBeFocused();
      }
    });
  }
}
