import { test, expect } from '@playwright/test';
import { PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const launches = [66, 67].map((value, index) => ({
  mint: new PublicKey(new Uint8Array(32).fill(value)).toBase58(),
  name: `Tier focus QA ${index}`, symbol: `TF${index}`, cluster: 'devnet', onchainVerified: true,
  creatorWallet: '11111111111111111111111111111111',
}));
const savedMint = new PublicKey(new Uint8Array(32).fill(68)).toBase58();

async function prepare(page, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.addInitScript(mint => {
    localStorage.setItem('funded.app.community.watchlist', JSON.stringify([mint]));
    localStorage.setItem('funded.app.followed.wallets.v1', '[]');
  }, savedMint);
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Controlled unavailable fixture' } }));
  await page.route('**/api/x/me', route => route.fulfill({ json: { authenticated: false, configured: false } }));
  await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
  await page.route('**/api/launches', route => route.fulfill({ json: launches }));
  await page.route('**/api/pump/explore?*', route => route.fulfill({ json: { items: [], fetchedAt: new Date().toISOString() } }));
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
  await page.locator('button[data-explore-view="table"]').click();
  await expect(page.locator('#launch-list [data-tier-info-mint]')).toHaveCount(2);
}

async function open(page) {
  const trigger = page.locator('#launch-list [data-tier-info-mint]').first();
  await trigger.click();
  const dialog = page.locator('#explore-tier-dialog');
  await expect(dialog).toHaveJSProperty('open', true);
  expect(await dialog.evaluate(node => node.matches(':modal'))).toBe(true);
  await expect(page.locator('#explore-tier-close')).toBeFocused();
  return { trigger, dialog };
}

async function close(page, activation) {
  if (activation === 'pointer') await page.locator('#explore-tier-close').click();
  else await page.keyboard.press(activation);
  await expect(page.locator('#explore-tier-dialog')).toHaveJSProperty('open', false);
}

for (const width of [390, 1440]) {
  for (const activation of ['pointer', 'Enter', 'Space', 'Escape']) {
    for (const replaced of [false, true]) {
      test(`UX-010 ${replaced ? 'replaced' : 'current'} tier trigger returns focus after ${activation} at ${width}px (mocked APIs)`, async ({ page }) => {
        await prepare(page, width);
        await page.locator('#explore-search').fill('Tier focus');
        const saved = await page.evaluate(() => localStorage.getItem('funded.app.community.watchlist'));
        const { trigger } = await open(page);
        if (replaced) {
          const detached = await trigger.evaluate(node => {
            const replacement = node.cloneNode(true);
            node.replaceWith(replacement);
            return !node.isConnected && replacement.isConnected;
          });
          expect(detached).toBe(true);
        }
        await close(page, activation);
        await expect(trigger).toBeFocused();
        await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#explore-search')).toHaveValue('Tier focus');
        expect(await page.evaluate(() => localStorage.getItem('funded.app.community.watchlist'))).toBe(saved);
        const visibleFocus = await trigger.evaluate(node => {
          const rect = node.getBoundingClientRect();
          const scroll = node.closest('.scanner-scroll').getBoundingClientRect();
          const nav = document.querySelector('.mobile-workspace-nav');
          const bottom = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : innerHeight;
          return rect.left >= scroll.left && rect.right <= scroll.right && rect.top >= 0 && rect.bottom <= bottom;
        });
        expect(visibleFocus).toBe(true);
      });
    }
  }

  test(`UX-010 missing tier trigger returns to visible Search at ${width}px (mocked list rerender)`, async ({ page }) => {
    await prepare(page, width);
    const { trigger } = await open(page);
    await trigger.evaluate(node => node.remove());
    await close(page, 'Escape');
    await expect(page.locator('#explore-search')).toBeFocused();
    await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test(`UX-010 route change prevents late tier focus at ${width}px (mocked route)`, async ({ page }) => {
    await prepare(page, width);
    await open(page);
    await page.evaluate(() => { location.hash = '#overview'; });
    await expect(page.locator('body')).toHaveClass(/page-route-overview/);
    await close(page, 'Escape');
    await expect(page.locator('#explore-search')).not.toBeFocused();
    await expect(page).toHaveURL(/#overview$/);
  });

  test(`UX-010 superseding control keeps focus at ${width}px (mocked close timing)`, async ({ page }) => {
    await prepare(page, width);
    await open(page);
    await page.evaluate(() => {
      document.querySelector('#explore-tier-dialog').close();
      document.querySelector('#explore-search').focus();
    });
    await expect(page.locator('#explore-search')).toBeFocused();
  });

  test(`UX-010 queued close does not consume a newer tier dialog at ${width}px (mocked rapid reopen)`, async ({ page }) => {
    await prepare(page, width);
    await open(page);
    await page.evaluate(() => {
      document.querySelector('#explore-tier-dialog').close();
      const next = document.querySelectorAll('#launch-list [data-tier-info-mint]')[1];
      next.focus();
      next.click();
    });
    await expect(page.locator('#explore-tier-dialog')).toHaveJSProperty('open', true);
    await page.waitForTimeout(50);
    await page.locator('#launch-list [data-tier-info-mint]').nth(1).evaluate(node => node.replaceWith(node.cloneNode(true)));
    await close(page, 'Escape');
    await expect(page.locator('#launch-list [data-tier-info-mint]').nth(1)).toBeFocused();
  });
}
