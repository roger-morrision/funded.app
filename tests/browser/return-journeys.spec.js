import { test, expect } from '@playwright/test';

const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const found = []; errors.set(page, found);
  page.on('pageerror', error => found.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable fixture"}' }));
  await page.route('https://**/*', route => route.abort());
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'No uncaught browser errors').toEqual([]));
async function open(page, hash) {
  await page.goto(`/#${hash}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
}

test('home guide can be dismissed and reopened across reload without a wallet or network writes', async ({ page }) => {
  const writes = [];
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'overview');
  const guide = page.locator('#getting-started');
  await expect(guide).toBeVisible(); await expect(guide).toHaveAttribute('open', '');
  await expect(guide.getByRole('link', { name: /Browse launches/ })).toBeVisible();
  await guide.getByRole('button', { name: 'Hide guide', exact: true }).click();
  await expect(guide).not.toHaveAttribute('open', '');
  await expect(guide.locator('summary')).toBeFocused();
  await page.reload(); await expect(guide).not.toHaveAttribute('open', '');
  await guide.locator('summary').click(); await expect(guide).toHaveAttribute('open', '');
  await page.reload(); await expect(guide).toHaveAttribute('open', '');
  expect(writes, 'Device guide preference must not send analytics or authenticated writes').toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('resume saved draft opens explicit Restore without replacing current input', async ({ page }) => {
  await open(page, 'launch');
  await page.locator('#token-name').fill('Stored draft');
  await page.locator('#token-symbol').fill('STORED');
  await page.locator('.launch-draft-panel summary').click();
  await page.locator('#save-launch-draft').click();
  await expect(page.locator('#launch-draft-status')).toContainText('saved');
  await page.locator('#token-name').fill('Unsaved current edit');
  await page.evaluate(() => { location.hash = 'overview'; });
  await page.getByRole('link', { name: 'Resume saved draft', exact: true }).click();
  await expect(page.locator('#restore-launch-draft')).toBeFocused();
  await expect(page.locator('#token-name')).toHaveValue('Unsaved current edit');
  await page.locator('#restore-launch-draft').click();
  await expect(page.locator('#token-name')).toHaveValue('Stored draft');
});

test('deleted saved search can be restored without automatically changing current filters', async ({ page }) => {
  await open(page, 'explore');
  await page.locator('#explore-search').fill('ORIGINAL');
  await page.getByLabel('Saved search name', { exact: true }).fill('Return list');
  await page.getByRole('button', { name: 'Save search', exact: true }).click();
  await page.locator('#explore-search').fill('CURRENT');
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
  const undo = page.getByRole('button', { name: 'Undo deletion', exact: true });
  await expect(undo).toBeFocused();
  await undo.click();
  await expect(page.locator('#explore-search')).toHaveValue('CURRENT');
  await page.getByLabel('Saved searches on this device').selectOption('0');
  await expect(page.locator('#explore-search')).toHaveValue('ORIGINAL');
  await page.reload();
  await expect(page.getByLabel('Saved searches on this device').locator('option')).toContainText(['Choose a saved search', 'Return list']);
});

test('saved search changes from another tab refresh choices without overwriting active filters', async ({ page, context }) => {
  await open(page, 'explore');
  await page.locator('#explore-search').fill('ACTIVE EDIT');
  const other = await context.newPage();
  other.on('pageerror', error => errors.get(page).push(error.message));
  await other.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await other.route('https://**/*', route => route.abort());
  await open(other, 'explore');
  await other.locator('#explore-search').fill('OTHER TAB');
  await other.getByLabel('Saved search name', { exact: true }).fill('Cross-tab list');
  await other.getByRole('button', { name: 'Save search', exact: true }).click();
  await expect(page.getByLabel('Saved searches on this device').locator('option')).toContainText(['Choose a saved search', 'Cross-tab list']);
  await expect(page.locator('#explore-search')).toHaveValue('ACTIVE EDIT');
  await page.getByLabel('Saved searches on this device').selectOption('0');
  await expect(page.locator('#explore-search')).toHaveValue('OTHER TAB');
  await other.close();
});
