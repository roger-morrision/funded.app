import { test, expect } from '@playwright/test';
import { PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const launches = [71, 72].map((value, index) => ({
  mint: new PublicKey(new Uint8Array(32).fill(value)).toBase58(),
  name: `Scroll fixture ${index}`, symbol: `SC${index}`, cluster: 'devnet', onchainVerified: true,
  creatorWallet: '11111111111111111111111111111111',
}));

for (const width of [390, 1440]) {
  test(`FQA-013 / UX-014 overflow table keyboard navigation at ${width}px (mocked launches)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.route('https://**/*', route => route.abort());
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Offline fixture' } }));
    await page.route('**/api/x/me', route => route.fulfill({ json: { authenticated: false, configured: false } }));
    await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
    await page.route('**/api/launches', route => route.fulfill({ json: launches }));
    await page.route('**/api/pump/explore?*', route => route.fulfill({ json: { items: [], fetchedAt: new Date().toISOString() } }));
    await page.goto('/#explore');
    await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
    await page.locator('[data-explore-view="table"]').click();
    const table = page.locator('.scanner-scroll');
    await expect(table).toHaveRole('table');
    await expect(table).toHaveAccessibleName('Verified launch table');
    await expect(table).toHaveAttribute('tabindex', '0');
    await expect(page.locator('#scanner-scroll-help')).toBeVisible();
    await expect(table).toHaveAccessibleDescription(/Scroll horizontally.*Left and Right arrow keys/i);
    await expect(table.getByRole('columnheader')).toHaveCount(11);
    await expect(table.getByRole('row')).toHaveCount(3);

    // Enter from the preceding visible control in the actual document tab order.
    await table.evaluate(element => {
      [...document.querySelectorAll('#explore button,#explore a[href],#explore input,#explore select')]
        .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length
          && (element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING))
        .at(-1)?.focus();
    });
    await page.keyboard.press('Tab');
    await expect(table).toBeFocused();
    expect(await table.evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle !== 'none')).toBe(true);
    await page.keyboard.down('ArrowRight');
    await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await page.keyboard.up('ArrowRight');
    // Native scrolling reaches the final column without adding keyboard handlers.
    for (let index = 0; index < 35; index++) await page.keyboard.press('ArrowRight', { delay: 20 });
    await expect.poll(() => table.evaluate(element => element.scrollWidth - element.clientWidth - element.scrollLeft), { timeout: 10000 }).toBeLessThan(2);
    const end = await table.evaluate(element => element.scrollLeft);
    await page.keyboard.down('ArrowLeft');
    await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeLessThan(end);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.press('Tab');
    await expect(table.locator('.scanner-token-link').first()).toBeFocused();
    let escaped = false;
    for (let index = 0; index < 30; index++) {
      await page.keyboard.press('Tab');
      if (!await table.evaluate(element => element.contains(document.activeElement))) { escaped = true; break; }
    }
    expect(escaped).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    // Resizing and switching layouts must recalculate overflow rather than leave
    // an unnecessary focus stop or a stale instruction behind.
    await page.locator('[data-explore-view="grid"]').click();
    await expect(table).toBeHidden();
    await expect(table).not.toHaveAttribute('tabindex');
    await expect(page.locator('#scanner-scroll-help')).toBeHidden();
    await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(2);
    await page.locator('[data-explore-view="table"]').click();
    await expect(table).toHaveAttribute('tabindex', '0');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(table).toHaveAttribute('tabindex', '0');
    await expect(page.locator('#scanner-scroll-help')).toBeVisible();
  });
}

test('FQA-013 focus and help follow actual overflow (isolated layout fixture)', async ({ page }) => {
  await page.goto('/tests/image-preparation.html');
  await page.evaluate(async () => {
    document.body.innerHTML = '<p id="scanner-scroll-help" hidden>Scroll horizontally</p><p id="scanner-note">Units</p><div class="scanner-scroll" role="table" style="width:400px;overflow:auto"><div class="scanner-head" style="width:300px;height:40px"></div></div>';
    const { initializeExploreTableScroll } = await import('/src/features/explore/table-scroll.js');
    initializeExploreTableScroll();
  });
  const table = page.locator('.scanner-scroll');
  await expect(table).not.toHaveAttribute('tabindex');
  await expect(page.locator('#scanner-scroll-help')).toBeHidden();
  await page.locator('.scanner-head').evaluate(element => element.style.width = '600px');
  await expect(table).toHaveAttribute('tabindex', '0');
  await expect(page.locator('#scanner-scroll-help')).toBeVisible();
  await table.evaluate(element => element.style.width = '700px');
  await expect(table).not.toHaveAttribute('tabindex');
  await expect(page.locator('#scanner-scroll-help')).toBeHidden();
  await expect(table).toHaveAttribute('aria-describedby', 'scanner-note');
});
