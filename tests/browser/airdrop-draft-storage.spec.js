import { test, expect } from '@playwright/test';

const KEY = 'funded.airdrop.draft';
const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = []; failures.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
});
test.afterEach(async ({ page }) => expect(failures.get(page), 'No uncaught browser errors').toEqual([]));
const status = page => page.locator('#wizard-status');
const stored = page => page.evaluate(key => localStorage.getItem(key), KEY);
async function open(page) {
  await page.goto('/#airdrops'); await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('summary').filter({ hasText: 'Creator management and distribution evidence' }).click();
  await page.locator('#toggle-airdrop-wizard').click(); await expect(page.locator('#airdrop-wizard')).toBeVisible();
}
async function original(page) {
  await open(page); await page.locator('#wizard-token-name').fill('Preserved original');
  await page.locator('#wizard-token-symbol').fill('ORIG'); await page.locator('#save-airdrop-draft').click();
  await expect(status(page)).toContainText('Draft saved'); return stored(page);
}
async function snapshot(page) {
  return page.evaluate(() => Object.fromEntries(['wizard-token-name', 'wizard-token-symbol', 'wizard-allocation', 'wizard-window', 'wizard-snapshot', 'wizard-vesting'].map(id => [id, document.getElementById(id).value])));
}
async function fault(page, operation, mode) {
  await page.evaluate(({ key, operation, mode }) => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    let denyRead = mode === 'read';
    Storage.prototype.getItem = function (name) {
      if (this === localStorage && name === key && denyRead) throw new DOMException('Fixture draft read denied', 'SecurityError');
      return get.call(this, name);
    };
    const method = operation === 'delete' ? 'removeItem' : 'setItem', mutation = operation === 'delete' ? remove : set;
    Storage.prototype[method] = function (name, ...args) {
      if (this === localStorage && name === key) {
        if (mode === 'throw') throw new DOMException('Fixture draft mutation denied', 'SecurityError');
        if (mode === 'noop') return;
        if (mode === 'readback') { mutation.call(this, name, ...args); denyRead = true; return; }
      }
      return mutation.call(this, name, ...args);
    };
    window.qaRestoreDraftStorage = () => { Storage.prototype.getItem = get; Storage.prototype.setItem = set; Storage.prototype.removeItem = remove; };
  }, { key: KEY, operation, mode });
}

for (const operation of ['save', 'delete']) for (const mode of ['throw', 'noop', 'readback']) test(`airdrop draft ${operation} handles ${mode} storage failure without false success or losing current input`, async ({ page }) => {
  const prior = await original(page); await page.locator('#wizard-token-name').fill('Current unsaved form');
  await page.locator('#wizard-allocation').fill('17'); const form = await snapshot(page);
  await fault(page, operation, mode); await page.locator(`#${operation}-airdrop-draft`).click();
  await expect(status(page)).toContainText(/could not|cannot/i);
  await expect(status(page)).not.toContainText(operation === 'save' ? 'Draft saved locally' : 'draft deleted');
  expect(await snapshot(page)).toEqual(form); await expect(page.locator('#wizard-window')).toHaveValue('90');
  await expect(page.locator('#wizard-window')).toBeDisabled();
  if (mode === 'readback') {
    await expect(status(page)).toContainText(/verif|confirm|may/i);
    // The mutation may have succeeded; only inspect the result after restoring access.
  } else expect(await stored(page)).toBe(prior);
  await page.screenshot({ path: test.info().outputPath(`airdrop-${operation}-${mode}.png`) });
  await page.evaluate(() => qaRestoreDraftStorage());
  if (mode === 'readback') {
    const result = await stored(page);
    if (operation === 'delete') expect(result).toBeNull(); else expect(JSON.parse(result).name).toBe('Current unsaved form');
  }
  await page.locator(`#${operation}-airdrop-draft`).focus(); await page.keyboard.press('Enter');
  await expect(status(page)).toContainText(operation === 'save' ? 'Draft saved locally' : 'draft deleted');
  if (operation === 'delete') expect(await stored(page)).toBeNull();
  else { const result = JSON.parse(await stored(page)); expect(result.name).toBe('Current unsaved form'); expect(result.claimWindowDays).toBe(90); }
  expect(await snapshot(page)).toEqual(form);
});

test('denied airdrop draft restore preserves current form and avoids recommending deletion', async ({ page }) => {
  const prior = await original(page); await page.locator('#wizard-token-name').fill('Current unsaved form');
  const form = await snapshot(page); await fault(page, 'save', 'read'); await page.locator('#restore-airdrop-draft').click();
  await expect(status(page)).toContainText(/could not|cannot/i); await expect(status(page)).not.toContainText(/delete it/i);
  expect(await snapshot(page)).toEqual(form); await page.evaluate(() => qaRestoreDraftStorage()); expect(await stored(page)).toBe(prior);
  await page.locator('#restore-airdrop-draft').click(); await expect(status(page)).toContainText('Draft restored');
  await expect(page.locator('#wizard-token-name')).toHaveValue('Preserved original'); await expect(page.locator('#wizard-window')).toHaveValue('90');
});

for (const mode of ['invalid JSON', 'invalid allocation']) test(`airdrop restore rejects ${mode} without partially replacing current form or deleting saved data`, async ({ page }) => {
  const prior = await original(page); await page.locator('#wizard-token-name').fill('Current unsaved form');
  await page.locator('#wizard-allocation').fill('17'); const form = await snapshot(page);
  const corrupt = mode === 'invalid JSON' ? '{' : JSON.stringify({ ...JSON.parse(prior), allocationPercent: 51 });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: KEY, value: corrupt });
  await page.locator('#restore-airdrop-draft').click(); await expect(status(page)).toContainText(/invalid|unreadable|could not|cannot/i);
  expect(await snapshot(page)).toEqual(form); expect(await stored(page)).toBe(corrupt);
  await expect(page.locator('#wizard-window')).toHaveValue('90'); await expect(page.locator('#wizard-window')).toBeDisabled();
});
