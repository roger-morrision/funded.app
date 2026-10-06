import { test, expect } from '@playwright/test';

const pageErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Offline test fixture' }) }));
  await page.route('https://**/*', route => route.abort());
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), 'No uncaught browser exceptions').toEqual([]);
});

test('shared filters and current search survive reload without a wallet', async ({ page }) => {
  await page.goto('/explore?filters=1&f.explore-search=REVIEW');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#explore-search')).toHaveValue('REVIEW');
  await expect(page.locator('.explore-saved-searches')).toHaveCount(0);
  await page.goto('/#explore');
  await page.locator('#explore-search').fill('UPDATED');
  await page.reload();
  await expect(page.locator('#explore-search')).toHaveValue('UPDATED');
});

test('global search carries its query into Explore', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('#header-search-trigger').click();
  await page.locator('#header-search-input').fill('FRESHQUERY');
  await page.locator('#header-search-input').press('Enter');
  await expect(page).toHaveURL(/#explore$/);
  await expect(page.locator('#explore-search')).toHaveValue('FRESHQUERY');
});

test('mobile controls fit and service status explains outages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#explore-search')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/#docs');
  await page.getByRole('button', { name: 'Check service status' }).click();
  await expect(page.locator('#service-status [role=status]')).toContainText('unavailable');
  await expect(page.getByRole('button', { name: 'Check service status' })).toBeEnabled();
});

test('wallet cancellation retries and account/network changes clear launch consent', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1');
    const handlers = {};
    let attempts = 0;
    const key = value => ({ toBase58: () => value, toString: () => value });
    const provider = {
      isPhantom: true, isConnected: false, publicKey: null,
      on: (event, handler) => { (handlers[event] ||= []).push(handler); },
      connect: async () => {
        if (++attempts === 1) throw new Error('User rejected the request');
        provider.isConnected = true;
        provider.publicKey = key('11111111111111111111111111111111');
        return { publicKey: provider.publicKey };
      },
      signTransaction: async () => { throw new Error('Unexpected signing request'); },
    };
    window.phantom = { solana: provider };
    window.walletFixtureEvent = (event, value) => {
      if (event === 'accountChanged') provider.publicKey = key(value);
      for (const handler of handlers[event] || []) handler(event === 'accountChanged' ? provider.publicKey : value);
    };
  });
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('#connect-button').click();
  await expect(page.locator('#launch-status')).toContainText('User rejected');
  await page.locator('#connect-button').click();
  await expect(page.locator('#launch-status')).toContainText('Ready to sign');
  await expect(page.locator('#header-wallet-balance')).toBeVisible();
  for (const event of ['chainChanged', 'accountChanged']) {
    await page.evaluate(() => {
      for (const id of ['fee-route-agree', 'terms-agree']) document.getElementById(id).checked = true;
    });
    await page.evaluate(event => window.walletFixtureEvent(event, event === 'accountChanged' ? 'So11111111111111111111111111111111111111112' : 'mainnet-beta'), event);
    await expect(page.locator('#fee-route-agree')).not.toBeChecked();
    await expect(page.locator('#terms-agree')).not.toBeChecked();
  }
});

test('chat wallet hiding persists on this device and can be reversed', async ({ page }) => {
  const mint = '9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
  await page.route(`**/api/tokens/${mint}/chat`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    enabled: true, messages: [{ id: 'chat-fixture', author: 'So11111111111111111111111111111111111111112', text: 'A useful fixture message', createdAt: new Date().toISOString() }],
  }) }));
  await page.goto(`/token/${mint}`);
  await expect(page.locator('#coin-community-feed')).toContainText('A useful fixture message');
  await page.getByRole('button', { name: 'Hide this wallet', exact: true }).click();
  await expect(page.locator('#coin-community-feed')).not.toContainText('A useful fixture message');
  await page.reload();
  await expect(page.locator('#coin-community-feed')).toContainText('Messages from hidden wallets');
  await page.locator('[data-chat-unhide]').click();
  await expect(page.locator('#coin-community-feed')).toContainText('A useful fixture message');
});
