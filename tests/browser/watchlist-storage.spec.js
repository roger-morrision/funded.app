import { test, expect } from '@playwright/test';

const KEY = 'funded.app.watchlist.guest.v1';
const MINT = 'So11111111111111111111111111111111111111112';
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const found = []; errors.set(page, found); page.on('pageerror', error => found.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/x/me', route => route.fulfill({ json: { authenticated: false, configured: true } }));
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
async function seed(page, mints) {
  await page.addInitScript(({ key, mints }) => {
    if (!sessionStorage.getItem('qa-seeded')) {
      localStorage.setItem(key, JSON.stringify({ mints, importId: crypto.randomUUID(), targetAccount: null }));
      sessionStorage.setItem('qa-seeded', 'true');
    }
    window.qaWatchEvents = 0;
    window.addEventListener('funded:watchlist-added', () => window.qaWatchEvents++);
  }, { key: KEY, mints });
}
async function ready(page) { await expect(page.locator('body')).toHaveClass(/workspace-ready/); }
async function fault(page, mode) {
  await page.evaluate(({ key, mode }) => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    let denyRead = mode === 'read'; window.qaWatchWrites = 0;
    Storage.prototype.getItem = function (name) {
      if (this === localStorage && name === key && denyRead) throw new DOMException('Read denied', 'SecurityError');
      return get.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name === key) {
        window.qaWatchWrites++;
        if (mode === 'write') throw new DOMException('Quota exceeded', 'QuotaExceededError');
        if (mode === 'noop') return;
        if (mode === 'readback') { set.call(this, name, value); denyRead = true; return; }
      }
      return set.call(this, name, value);
    };
    window.qaRestore = () => { Storage.prototype.getItem = get; Storage.prototype.setItem = set; };
  }, { key: KEY, mode });
}
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)).mints, KEY);
const notice = page => page.locator('#coin-page [data-watchlist-status]');

for (const mode of ['write', 'noop', 'read', 'readback']) for (const remove of [false, true]) {
  test(`guest favorite ${remove ? 'remove' : 'save'} survives ${mode} failure and explicit retry`, async ({ page }) => {
    const initial = remove ? [MINT] : [], next = remove ? [] : [MINT];
    await seed(page, initial); await page.goto(`/token/${MINT}`); await ready(page);
    const button = page.locator('#coin-watch');
    await expect(button).toHaveAttribute('aria-pressed', String(remove));
    await fault(page, mode); await button.click();
    await expect(notice(page)).toContainText(/denied|quota|could not|couldn't|cannot|unavailable/i);
    await expect(button).toHaveAttribute('aria-pressed', String(remove));
    expect(await page.evaluate(() => window.qaWatchEvents)).toBe(0);
    await page.evaluate(() => window.qaRestore());
    expect(await saved(page)).toEqual(mode === 'readback' ? next : initial);
    await button.focus(); await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', String(!remove));
    expect(await saved(page)).toEqual(next);
    await page.reload(); await ready(page);
    await expect(button).toHaveAttribute('aria-pressed', String(!remove));
  });
}
for (const value of ['{', '{"mints":true}', '{"mints":["invalid"],"importId":"bad"}']) {
  test(`malformed guest storage is preserved: ${value}`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: KEY, value });
    await page.goto(`/token/${MINT}`); await ready(page);
    await page.locator('#coin-watch').click();
    await expect(notice(page)).toContainText(/could not|unavailable/i);
    await expect(page.locator('#coin-watch')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(value);
  });
}
test('unknown sign-in state does not overwrite guest favorites', async ({ page }) => {
  await page.route('**/api/x/me', route => route.fulfill({ status: 503, json: {} }));
  await seed(page, [MINT]); await page.goto(`/token/${MINT}`); await ready(page);
  await page.locator('#coin-watch').click();
  await expect(notice(page)).toContainText('Sign in or retry');
  expect(await saved(page)).toEqual([MINT]);
});
for (const width of [390, 1440]) test(`unavailable token can be removed from Favorites at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await seed(page, [MINT]); await page.goto('/#community'); await ready(page);
  const row = page.locator('.watchlist-unavailable');
  await expect(row).toBeVisible(); await expect(page.locator('#watch-count')).toHaveText('1 favorite');
  await fault(page, 'noop'); await row.getByRole('button', { name: 'Remove saved token' }).click();
  await expect(page.locator('#toast')).toContainText('could not be saved');
  await expect(row).toBeVisible(); expect(await saved(page)).toEqual([MINT]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`favorites-${width}.png`) });
  await page.evaluate(() => window.qaRestore());
  await row.getByRole('button', { name: 'Remove saved token' }).click();
  await expect(row).toHaveCount(0); await expect(page.locator('#watch-count')).toHaveText('0 favorites');
  expect(await saved(page)).toEqual([]);
});

const rawMints = async page => JSON.stringify(await saved(page));
async function verifiedFeed(page) {
  const bytes = Buffer.alloc(82); bytes.writeBigUInt64LE(1000000000n, 36); bytes[44] = 6; bytes[45] = 1;
  const account = { data: [bytes.toString('base64'), 'base64'], owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', lamports: 1000000, executable: false, rentEpoch: 0 };
  await page.route('**/api/pump/explore?*', route => route.fulfill({ json: { cluster: 'devnet', items: [{ mint: MINT, name: 'Synthetic watch fixture', symbol: 'WATCH', createdTimestamp: 1, lastTradeTimestamp: 1 }], fetchedAt: new Date().toISOString() } }));
  const rpc = route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: request.method === 'getMultipleAccounts'
      ? { jsonrpc: '2.0', id: request.id, result: { context: { slot: 1 }, value: request.params[0].map(mint => mint === MINT ? account : null) } }
      : { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'No additional evidence in offline fixture' } } });
  };
  await page.route('**/api/solana/rpc*', rpc); await page.route('https://api.devnet.solana.com/**', rpc);
}

for (const [width, view] of [[1440, 'grid'], [390, 'table']]) test(`Explore Following filters tokens in place at ${width}px with ${view} view`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await seed(page, []); await verifiedFeed(page); await page.goto('/#explore'); await ready(page);
  await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
  const watch = page.locator(`#asset-grid .watch-button[data-mint="${MINT}"]`);
  await expect(watch).toHaveCount(1);
  await page.locator('#explore-search').fill('WATCH');
  await page.locator('#explore-sort').selectOption('recent-trade');
  await page.locator('[data-explore-window="6h"]').click();
  await page.locator(`button[data-explore-view="${view}"]`).click();
  const url = page.url();
  await page.evaluate(() => { window.qaExplorePage = document.querySelector('#explore'); });
  const following = page.locator('button[data-explore-tab="following"]');
  await following.click();
  await expect(following).toHaveAttribute('aria-pressed', 'true');
  await expect(watch).toHaveCount(0);
  await expect(page).toHaveURL(url);
  expect(await page.evaluate(() => window.qaExplorePage === document.querySelector('#explore'))).toBe(true);
  await expect(page.locator('#explore')).toBeVisible();
  await expect(page.locator('#explore-search')).toHaveValue('WATCH');
  await expect(page.locator('#explore-sort')).toHaveValue('recent-trade');
  await expect(page.locator('[data-explore-window="6h"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`button[data-explore-view="${view}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('button[data-explore-tab="trending"]').click();
  await expect(watch).toHaveCount(1);
  await page.locator('button[data-explore-view="grid"]').click();
  await watch.click();
  await expect(watch).toHaveAttribute('aria-pressed', 'true');
  await page.locator(`button[data-explore-view="${view}"]`).click();
  await following.focus(); await page.keyboard.press('Enter');
  await expect(following).toHaveAttribute('aria-pressed', 'true');
  await expect(watch).toHaveCount(1);
  await expect(page).toHaveURL(url);
  await expect(page.locator('#explore-sort')).toHaveValue('recent-trade');
});

test('Explore native watch action does not announce success when saving fails', async ({ page }) => {
  await seed(page, []); await verifiedFeed(page); await page.goto('/#explore'); await ready(page);
  await page.locator('button[data-explore-view="grid"]').click();
  const watch = page.locator(`#asset-grid .watch-button[data-mint="${MINT}"]`); await expect(watch).toBeVisible();
  await fault(page, 'write'); await watch.click();
  await expect(page.locator('#toast')).toContainText(/could not be saved/i);
  await expect(watch).toHaveAttribute('aria-pressed', 'false'); expect(await rawMints(page)).toBe('[]');
  expect(await page.evaluate(() => qaWatchEvents)).toBe(0);
  await page.evaluate(() => qaRestore()); await watch.click();
  await expect(watch).toHaveAttribute('aria-pressed', 'true'); expect(JSON.parse(await rawMints(page))).toEqual([MINT]);
  expect(await page.evaluate(() => qaWatchEvents)).toBe(1);
});
