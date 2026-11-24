import { test, expect } from '@playwright/test';

async function mockServices(page, baseURL) {
  const origin = new URL(baseURL).origin;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/api/fee-policy') return route.fulfill({ contentType: 'application/json', body: '{"revision":0}' });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable in UI test"}' });
    return route.continue();
  });
}

test('slow startup exposes recovery and removes it after readiness', async ({ page, baseURL }) => {
  await mockServices(page, baseURL);
  await page.clock.install();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/fee-policy', async route => {
    await pending;
    await route.fulfill({ contentType: 'application/json', body: '{"revision":0}' });
  });
  try {
    await page.goto('/#explore', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#bootstrap-status')).toBeHidden();
    await page.clock.fastForward(10_100);
    await expect(page.locator('#bootstrap-status')).toBeVisible();
    await expect(page.locator('[data-bootstrap-message]')).toContainText('Still loading');
    await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
    await expect(page.locator('#bootstrap-reload')).toBeVisible();
    release();
    await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state', 'ready');
    await expect(page.locator('#bootstrap-status')).toBeHidden();
    await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false);
  } finally { release(); }
});

test('an unavailable fee policy keeps actions gated with visible recovery', async ({ page, baseURL }) => {
  await mockServices(page, baseURL);
  await page.route('**/api/fee-policy', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state', 'failed');
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  await expect(page.locator('#bootstrap-reload')).toBeVisible();
  await expect(page.locator('#bootstrap-dismiss')).toBeHidden();
});

test('a stalled fee policy times out instead of leaving a frozen app', async ({ page, baseURL }) => {
  await mockServices(page, baseURL);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/fee-policy', async route => { await pending; await route.abort().catch(() => {}); });
  try {
    await page.goto('/#launch', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state', 'failed', { timeout: 20_000 });
    await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
    await expect(page.locator('#bootstrap-reload')).toBeVisible();
  } finally { release(); }
});

test('optional module failure shows guidance while core navigation works', async ({ page, baseURL }) => {
  await mockServices(page, baseURL);
  await page.route('**/assets/page-experience-*.js', route => route.abort());
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state', 'degraded');
  await expect(page.locator('#bootstrap-status')).toBeVisible();
  await expect(page.locator('[data-bootstrap-message]')).toContainText('Some features could not load');
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false);
  await page.getByRole('button', { name: 'Continue with available features' }).click();
  await expect(page.locator('#bootstrap-status')).toBeHidden();
  if (page.viewportSize().width <= 700) await page.locator('#open-menu').click();
  await page.locator('#sidebar a[href="#portfolio"]').click();
  await expect(page).toHaveTitle(/^Portfolio/);
});
