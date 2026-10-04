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

test('shared filters and saved searches survive reload without a wallet', async ({ page }) => {
  await page.goto('/explore?filters=1&f.explore-search=REVIEW');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#explore-search')).toHaveValue('REVIEW');
  await page.locator('#explore-search').fill('UPDATED');
  await expect(page.getByRole('link', { name: 'Share this search' })).toHaveAttribute('href', /f.explore-search=UPDATED/);
  await page.locator('#explore-search').fill('REVIEW');
  await page.getByLabel('Saved search name', { exact: true }).fill('My review search');
  await page.getByRole('button', { name: 'Save search', exact: true }).click();
  await page.reload();
  await page.getByLabel('Saved searches on this device').selectOption('0');
  await expect(page.locator('#explore-search')).toHaveValue('REVIEW');
  await expect(page.getByRole('link', { name: 'Share this search' })).toHaveAttribute('href', /filters=1/);
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await expect(page.getByLabel('Saved searches on this device').locator('option')).toHaveCount(1);
});

test('mobile controls fit and service status explains outages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.getByRole('button', { name: 'Save search', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/#docs');
  await page.getByRole('button', { name: 'Check service status' }).click();
  await expect(page.locator('#service-status [role=status]')).toContainText('unavailable');
  await expect(page.getByRole('button', { name: 'Check service status' })).toBeEnabled();
});

test('optional draft images stay bound to the saved settings and can be deleted', async ({ page }) => {
  await page.goto('/#launch');
  const result = await page.evaluate(async () => {
    const { saveDraftImage, readDraftImage, deleteDraftImage } = await import('/launch-draft-image.js');
    const draft = { name: 'Saved draft', version: 1 };
    await saveDraftImage(draft, new File([new Uint8Array([1,2,3])], 'fixture.png', { type: 'image/png' }));
    const restored = await readDraftImage(draft);
    const changed = await readDraftImage({ ...draft, name: 'Different draft' });
    await deleteDraftImage();
    return { size: restored?.size, changed, deleted: await readDraftImage(draft) };
  });
  expect(result).toEqual({ size: 3, changed: null, deleted: null });
});

test('launch image and settings restore after reload while consent resets', async ({ page }) => {
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('#token-name').fill('Recovery test');
  await page.locator('#token-symbol').fill('RECOVER');
  await expect(page.locator('.launch-optional-socials')).not.toHaveAttribute('open', '');
  await page.locator('.launch-optional-socials summary').click();
  await page.locator('#token-website').fill('https://example.org/recovery');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const context = canvas.getContext('2d'); context.fillStyle = '#336699'; context.fillRect(0, 0, 512, 512);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#token-image').setInputFiles({ name: 'recovery.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(page.locator('#image-preparation-status')).toContainText('Ready:');
  await page.locator('#token-website').fill('invalid website');
  await page.locator('.launch-optional-socials summary').click();
  await page.locator('#launch-next').click();
  await expect(page.locator('.launch-optional-socials')).toHaveAttribute('open', '');
  await expect(page.locator('#token-website')).toBeFocused();
  await page.locator('#token-website').fill('https://example.org/recovery');
  if (!await page.locator('.launch-draft-panel').evaluate(node => node.open)) await page.locator('.launch-draft-panel summary').click();
  await page.locator('#save-launch-image').check();
  await expect.poll(() => page.locator('#image-remove').isEnabled()).toBe(true);
  await page.locator('#save-launch-draft').click();
  await expect(page.locator('#launch-draft-status')).toContainText('Draft and prepared image saved');
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  if (!await page.locator('.launch-draft-panel').evaluate(node => node.open)) await page.locator('.launch-draft-panel summary').click();
  await page.locator('#restore-launch-draft').click();
  await expect(page.locator('#token-name')).toHaveValue('Recovery test');
  await expect(page.locator('#token-symbol')).toHaveValue('RECOVER');
  await expect(page.locator('#token-website')).toHaveValue('https://example.org/recovery');
  await expect(page.locator('.launch-optional-socials')).toHaveAttribute('open', '');
  await expect.poll(() => page.locator('#token-image').evaluate(input => input.files.length)).toBe(1);
  await expect(page.locator('#fee-route-agree')).not.toBeChecked();
  await expect(page.locator('#terms-agree')).not.toBeChecked();
  await page.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args) => {
      await new Promise(resolve => { window.releaseDraftRead = resolve; });
      return digest(...args);
    };
  });
  await page.locator('#restore-launch-draft').click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseDraftRead)).toBe('function');
  await page.locator('#token-name').fill('New edit during restore');
  await page.evaluate(() => window.releaseDraftRead());
  await expect(page.locator('#launch-draft-status')).toContainText('form changed');
  await expect(page.locator('#token-name')).toHaveValue('New edit during restore');
  await page.locator('#delete-launch-draft').click();
  await expect(page.locator('#launch-draft-status')).toContainText('deleted');
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  if (!await page.locator('.launch-draft-panel').evaluate(node => node.open)) await page.locator('.launch-draft-panel summary').click();
  await page.locator('#restore-launch-draft').click();
  await expect(page.locator('#launch-draft-status')).toContainText('No saved launch draft');
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
