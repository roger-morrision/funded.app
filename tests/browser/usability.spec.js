import { test, expect } from '@playwright/test';

const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = []; failures.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable fixture"}' }));
  await page.route('https://**/*', route => route.abort());
});
test.afterEach(async ({ page }) => expect(failures.get(page), 'No uncaught browser exceptions').toEqual([]));

async function open(page, route) {
  await page.goto(`/#${route}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
}

test('a stalled optional fee-status provider does not block the workspace', async ({ page }) => {
  let requested = false;
  let feeStatusFinished = false;
  page.on('requestfailed', request => { if (request.url().endsWith('/api/x-fee/status')) feeStatusFinished = true; });
  page.on('response', response => { if (response.url().endsWith('/api/x-fee/status')) feeStatusFinished = true; });
  await page.route('**/api/x-fee/status', () => { requested = true; });
  await page.goto('/#explore', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  expect(requested).toBe(true);
  expect(feeStatusFinished, 'The workspace becomes usable before the optional status request finishes').toBe(false);
  await expect(page.getByLabel('Saved search name', { exact: true })).toBeVisible();
});

test('an unavailable optional module leaves navigation usable and explains reload recovery', async ({ page }) => {
  await page.route('**/pilot-metrics.js*', route => route.abort('failed'));
  await open(page, 'explore');
  await expect(page.locator('#bootstrap-status')).toContainText('Reload');
  await expect(page.getByLabel('Saved search name', { exact: true })).toBeVisible();
  await page.goto('/#docs');
  await page.getByRole('button', { name: 'Check service status' }).click();
  await expect(page.locator('#service-status [role=status]')).toContainText('unavailable');
});

test('desktop primary destinations are unique and More closes with keyboard focus restored', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, 'explore');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  for (const destination of ['overview', 'explore', 'my-launches', 'payments']) {
    await expect(nav.locator(`a[href="#${destination}"]`)).toHaveCount(1);
    await expect(nav.locator(`a[href="#${destination}"]`)).toBeVisible();
  }
  const more = nav.locator('.nav-more');
  const summary = more.locator('summary');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('open', '');
  await page.keyboard.press('Tab');
  await expect(more.locator('a').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).not.toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
});

test('primary portfolio and rewards remain reachable on compact desktop Home', async ({ page }) => {
  for (const width of [901, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, 'overview');
    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    for (const destination of ['my-launches', 'payments']) {
      await expect(nav.locator(`a[href="#${destination}"]`)).toHaveCount(1);
      await expect(nav.locator(`a[href="#${destination}"]`)).toBeVisible();
    }
    for (const control of await nav.locator('a[href="#my-launches"], a[href="#payments"], .nav-more > summary').all()) {
      expect(await control.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), 'Primary navigation must not be covered by search, network or wallet controls').toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('mobile header actions do not overlap and touched controls have usable hit areas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['overview', 'launch']) {
    await open(page, route);
    const label = await page.locator('#route-context').boundingBox();
    const wallet = await page.locator('#connect-button').boundingBox();
    expect(label.x + label.width).toBeLessThanOrEqual(wallet.x);
    const targets = route === 'overview' ? '.home-market-window button, #home-ticker-back, #home-ticker-forward' : '#launch-close';
    for (const target of await page.locator(targets).all()) {
      expect((await target.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
  }
});

test('unavailable feeds stay truthful and retry from Home and both Explore layouts', async ({ page }) => {
  await open(page, 'overview');
  for (const kind of ['funded', 'coin', 'x']) {
    await expect(page.locator(`[data-home-reward-grid="${kind}"]`)).toContainText('Verified reward data is unavailable');
  }
  async function retry() {
    const response = page.waitForResponse(response => response.url().includes('/api/pump/explore'));
    await page.getByRole('button', { name: 'Retry verification', exact: true }).click();
    await response;
    await expect(page.getByRole('button', { name: 'Retry verification', exact: true })).toBeEnabled();
  }
  await retry();
  await open(page, 'explore');
  for (const layout of ['table', 'grid']) {
    await page.locator(`button[data-explore-view="${layout}"]`).click();
    await retry();
  }
});

test('saved search validation and clipboard fallback are usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'explore');
  const input = page.getByLabel('Saved search name', { exact: true });
  const save = page.getByRole('button', { name: 'Save search', exact: true });
  await save.click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#saved-search-feedback')).toContainText('Enter a name');
  await input.fill('A short list'); await save.click();
  await expect(page.locator('#saved-search-feedback')).toContainText('Saved');
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  const remove = page.getByRole('button', { name: 'Delete selected', exact: true });
  expect((await remove.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Permission denied fixture'); }; });
  await page.getByRole('button', { name: 'Copy search link', exact: true }).click();
  const fallback = page.getByLabel('Search link to copy', { exact: true });
  await expect(fallback).toBeVisible(); await expect(fallback).toBeFocused();
  await expect(fallback).toHaveValue(/\/explore\?filters=1/);
  await remove.click();
  await expect(page.getByLabel('Saved searches on this device')).toBeDisabled();
  await expect(page.locator('#saved-search-feedback')).toHaveText('Saved search deleted.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
