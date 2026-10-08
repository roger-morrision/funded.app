import { test, expect } from '@playwright/test';

const mint = '9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
const creator = '9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w';

test('favorite tokens and followed creator wallets persist and can be removed', async ({ page }) => {
  const launch = { mint, cluster: 'devnet', onchainVerified: true, creatorWallet: creator, name: 'Favorite QA token', symbol: 'FAV' };
  await page.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"mocked offline API"}' }));
  await page.route('**/api/launches', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([launch]) }));
  await page.route('**/api/x/me', route => route.fulfill({ json: { authenticated: false, configured: true } }));

  await page.goto(`/wallet/${creator}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const follow = page.locator('#wallet-follow');
  await expect(follow).toBeVisible();
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');

  await page.goto(`/token/${mint}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('#coin-watch').click();
  await expect(page.locator('#coin-watch')).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/#community');
  await expect(page.locator('#followed-wallet-rows .followed-wallet-row')).toHaveCount(1);
  await expect(page.locator('#followed-wallet-rows')).toContainText('Creator');
  await expect(page.locator('#watchlist-items .saved-token-row')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#followed-wallet-rows .followed-wallet-row')).toHaveCount(1);
  await expect(page.locator('#watchlist-items .saved-token-row')).toHaveCount(1);

  await page.locator('#followed-wallet-rows [data-unfollow-wallet]').click();
  await expect(page.locator('#followed-wallet-rows .followed-wallet-row')).toHaveCount(0);
  await page.locator('#watchlist-items .watch-button').click();
  await expect(page.locator('#watchlist-items .saved-token-row')).toHaveCount(0);
});
