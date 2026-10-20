import { test, expect } from '@playwright/test';
import { PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const [premierMint, holderMint] = [1, 2].map(value => new PublicKey(new Uint8Array(32).fill(value)).toBase58());
const creatorWallet = '11111111111111111111111111111111';
const launches = [
  { mint: premierMint, name: 'Fee premier QA', symbol: 'PREM', cluster: 'devnet', onchainVerified: true,
    creatorWallet, signature: 'premier-fixture-proof', creatorLaunchBurn: { tier: 'premier', status: 'verified',
      amountTokens: 100, receipt: { verified: true, atomicWithPumpLaunch: true, signature: 'premier-fixture-proof' } } },
  { mint: holderMint, name: 'Holder rewards QA', symbol: 'HOLD', cluster: 'devnet', onchainVerified: true,
    creatorWallet, feeDistribution: { creatorDirected: { shares: { holderAirdropPercent: 10 } } } },
];

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`UX-008 combined Explore guidance and recovery at ${width}px (mocked launches)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('https://**/*', route => route.abort());
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Offline fixture' } }));
    await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
    await page.route('**/api/launches', route => route.fulfill({ json: launches }));
    await page.route('**/api/pump/explore?*', route => route.fulfill({ json: { items: [], fetchedAt: new Date().toISOString() } }));
    await page.goto('/#explore');
    await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
    await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(2);

    const toggle = page.locator('#explore-filter-toggle');
    const filters = page.locator('#explore-filter-popover');
    await toggle.click();
    await page.locator('#explore-promotion-filter').selectOption('premier');
    await expect(page.locator('#asset-grid')).toContainText('Fee premier QA');
    await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(1);
    await page.locator('#explore-reward-filter').selectOption('holder-fees');
    await expect(page.locator('#asset-grid .empty-state strong')).toHaveText('No tokens match this combination.');
    await expect(page.locator('#asset-grid .explore-empty-criteria')).toHaveText('Premier · Holder rewards');
    await expect(page.locator('#launch-list .explore-empty-criteria')).toHaveText('Premier · Holder rewards');
    await page.keyboard.press('Escape');
    await expect(filters).toBeHidden();
    await expect(toggle).toBeFocused();

    await page.locator('#explore-search').fill('Fee premier QA');
    await expect(page.locator('#asset-grid .explore-empty-criteria')).toHaveText('Premier · Holder rewards · Search: Fee premier QA');
    await expect(page.locator('#launch-list .explore-empty-criteria')).toHaveText('Premier · Holder rewards · Search: Fee premier QA');
    await page.locator('#asset-grid .explore-empty-criteria').evaluate(node => node.scrollIntoView({ behavior: 'instant', block: 'center' }));
    const summaryGeometry = await page.locator('#asset-grid .explore-empty-criteria').evaluate(node => {
      const box = node.getBoundingClientRect();
      const navigation = document.querySelector('.mobile-workspace-nav');
      const visibleBottom = navigation && getComputedStyle(navigation).position === 'fixed'
        ? navigation.getBoundingClientRect().top : innerHeight;
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        visibleBottom, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth };
    });
    expect(summaryGeometry.left, JSON.stringify(summaryGeometry)).toBeGreaterThanOrEqual(0);
    expect(summaryGeometry.right, JSON.stringify(summaryGeometry)).toBeLessThanOrEqual(summaryGeometry.viewportWidth);
    expect(summaryGeometry.top, JSON.stringify(summaryGeometry)).toBeGreaterThanOrEqual(0);
    expect(summaryGeometry.bottom, JSON.stringify(summaryGeometry)).toBeLessThanOrEqual(summaryGeometry.visibleBottom);
    expect(summaryGeometry.documentWidth, JSON.stringify(summaryGeometry)).toBeLessThanOrEqual(summaryGeometry.viewportWidth);
    await page.screenshot({ path: `test-results/ux-008-combination-${width}.png` });

    const clear = page.locator('#asset-grid [data-explore-empty-action="clear"]');
    await clear.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(2);
    await expect(page.locator('#explore-promotion-filter')).toHaveValue('all');
    await expect(page.locator('#explore-reward-filter')).toHaveValue('all');
    await expect(page.locator('#explore-search')).toHaveValue('');

    await page.locator('#explore-search').fill('missing token');
    await expect(page.locator('#asset-grid .empty-state strong')).toHaveText('No token matches your search.');
    await page.locator('#explore-search').fill('Fee premier QA');
    await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(1);
    await expect(page.locator('#asset-grid')).toContainText('Fee premier QA');

    await page.locator('#explore-search').fill('');
    await toggle.click();
    await page.locator('#explore-promotion-filter').selectOption('pro');
    await expect(page.locator('#asset-grid .empty-state strong')).toHaveText('No Pro tokens match this view.');
    await page.locator('#explore-reward-filter').selectOption('holder-fees');
    await expect(page.locator('#asset-grid .empty-state strong')).toHaveText('No tokens match this combination.');
    await page.locator('#explore-promotion-filter').selectOption('all');
    await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(1);
    await expect(page.locator('#asset-grid')).toContainText('Holder rewards QA');
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
