import { test, expect } from '@playwright/test';

const KEY = 'funded.app.community.watchlist';
const MINT = 'So11111111111111111111111111111111111111112';
const OTHER = '11111111111111111111111111111111';
const faults = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = []; faults.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
});
test.afterEach(async ({ page }) => expect(faults.get(page), 'No uncaught browser exceptions').toEqual([]));
async function seed(page, raw) {
  await page.addInitScript(({ key, raw }) => {
    if (!sessionStorage.getItem('qa-watch-seeded')) {
      localStorage.setItem(key, raw); sessionStorage.setItem('qa-watch-seeded', 'true');
    }
    window.qaWatchEvents = 0; window.addEventListener('funded:watchlist-added', () => window.qaWatchEvents++);
  }, { key: KEY, raw });
}
async function ready(page) { await expect(page.locator('body')).toHaveClass(/workspace-ready/); }
async function fault(page, mode) {
  await page.evaluate(({ key, mode }) => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    let readDenied = mode === 'read'; window.qaWatchWrites = 0;
    Storage.prototype.getItem = function (name) {
      if (this === localStorage && name === key && readDenied) throw new DOMException('Fixture read denied', 'SecurityError');
      return get.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name === key) {
        window.qaWatchWrites++;
        if (mode === 'write') throw new DOMException('Fixture quota exceeded', 'QuotaExceededError');
        if (mode === 'noop') return;
        if (mode === 'readback') { set.call(this, name, value); readDenied = true; return; }
      }
      return set.call(this, name, value);
    };
    window.qaRestoreWatchStorage = () => { Storage.prototype.getItem = get; Storage.prototype.setItem = set; };
  }, { key: KEY, mode });
}
const coinStatus = page => page.locator('#coin-page [data-watchlist-status]');
const portfolioStatus = page => page.locator('#community [data-watchlist-status]');
const raw = page => page.evaluate(key => localStorage.getItem(key), KEY);

for (const [label, initial, width] of [['save', [], 390], ['remove', [MINT], 1440]]) test(`native coin ${label} failure preserves selection and explicit keyboard retry persists at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await seed(page, JSON.stringify(initial));
  await page.goto(`/token/${MINT}`); await ready(page);
  const button = page.locator('#coin-watch'); await expect(button).toHaveAttribute('aria-pressed', String(initial.length > 0));
  await fault(page, 'write'); await button.click();
  await expect(coinStatus(page)).toBeVisible(); await expect(coinStatus(page)).toContainText(/could not be updated/i);
  await expect(button).toHaveAttribute('aria-pressed', String(initial.length > 0));
  await page.screenshot({ path: test.info().outputPath(`coin-${label}-${width}-storage-failure.png`), fullPage: true });
  expect(await raw(page)).toBe(JSON.stringify(initial)); expect(await page.evaluate(() => qaWatchEvents)).toBe(0);
  await page.evaluate(() => qaRestoreWatchStorage()); await button.focus(); await page.keyboard.press('Enter');
  const next = initial.length ? [] : [MINT];
  await expect(button).toHaveAttribute('aria-pressed', String(!initial.length)); expect(JSON.parse(await raw(page))).toEqual(next);
  expect(await page.evaluate(() => qaWatchEvents)).toBe(initial.length ? 0 : 1);
  await page.reload(); await ready(page); await expect(button).toHaveAttribute('aria-pressed', String(!initial.length));
  expect(JSON.parse(await raw(page))).toEqual(next);
});

test('Portfolio no-op removal reports unverified persistence and keeps the row until successful retry', async ({ page }) => {
  await seed(page, JSON.stringify([MINT])); await page.goto('/#community'); await ready(page);
  const remove = page.locator(`[data-remove-watch="${MINT}"]`); await expect(remove).toBeVisible();
  await fault(page, 'noop'); await remove.click();
  await expect(portfolioStatus(page)).toBeVisible(); await expect(portfolioStatus(page)).toContainText(/could not be verified|cannot verify/i);
  await expect(remove).toBeVisible(); await expect(page.locator('#watch-count')).toHaveText('1 saved');
  await page.screenshot({ path: test.info().outputPath('portfolio-write-unconfirmed.png'), fullPage: true });
  expect(JSON.parse(await raw(page))).toEqual([MINT]); expect(await page.evaluate(() => qaWatchEvents)).toBe(0);
  await page.evaluate(() => qaRestoreWatchStorage()); await remove.click();
  await expect(remove).toHaveCount(0); await expect(page.locator('#watch-count')).toHaveText('0 saved');
  expect(JSON.parse(await raw(page))).toEqual([]); await page.reload(); await ready(page); await expect(page.locator('#watch-count')).toHaveText('0 saved');
});

test('a denied fresh watchlist read never overwrites previously saved tokens', async ({ page }) => {
  await seed(page, JSON.stringify([OTHER])); await page.goto(`/token/${MINT}`); await ready(page);
  await fault(page, 'read'); await page.locator('#coin-watch').click();
  await expect(coinStatus(page)).toContainText(/could not be updated/i);
  await expect(page.locator('#coin-watch')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => ({ writes: qaWatchWrites, events: qaWatchEvents }))).toEqual({ writes: 0, events: 0 });
  await page.evaluate(() => qaRestoreWatchStorage()); expect(JSON.parse(await raw(page))).toEqual([OTHER]);
  await page.locator('#coin-watch').click(); await expect(page.locator('#coin-watch')).toHaveAttribute('aria-pressed', 'true');
  expect(JSON.parse(await raw(page))).toEqual([OTHER, MINT]);
});

for (const [label, stored] of [['JSON', '{'], ['object', '{"saved":true}'], ['mint', '["not-a-solana-mint"]']]) test(`malformed watchlist ${label} cannot crash startup or be silently replaced`, async ({ page }) => {
  await seed(page, stored); await page.goto(`/token/${MINT}`); await ready(page);
  await fault(page, 'observe'); await page.locator('#coin-watch').click();
  await expect(coinStatus(page)).toBeVisible(); await expect(coinStatus(page)).toContainText(/could not be updated/i);
  await expect(page.locator('#coin-watch')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => ({ writes: qaWatchWrites, events: qaWatchEvents }))).toEqual({ writes: 0, events: 0 });
  expect(await raw(page)).toBe(stored);
});

test('write followed by unreadable confirmation reports uncertainty without a success event', async ({ page }) => {
  await seed(page, '[]'); await page.goto(`/token/${MINT}`); await ready(page); await fault(page, 'readback');
  await page.locator('#coin-watch').click();
  await expect(coinStatus(page)).toContainText(/could not be verified|cannot verify/i);
  await expect(page.locator('#coin-watch')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => ({ writes: qaWatchWrites, events: qaWatchEvents }))).toEqual({ writes: 1, events: 0 });
  await page.locator('.nav-item[href="#my-launches"]').click();
  await page.getByRole('navigation', { name: 'Portfolio sections' }).getByRole('link', { name: 'Watchlist', exact: true }).click();
  await expect(portfolioStatus(page)).toBeVisible();
  await expect(portfolioStatus(page)).toContainText('saved selection may have changed');
  await expect(portfolioStatus(page)).not.toContainText('Nothing was changed');
  // The write may have succeeded. Restore access before inspecting storage; do
  // not interpret an unreadable result as an empty or unchanged watchlist.
  await page.evaluate(() => qaRestoreWatchStorage()); expect(JSON.parse(await raw(page))).toEqual([MINT]);
  await page.goto(`/token/${MINT}`); await ready(page); await expect(page.locator('#coin-watch')).toHaveAttribute('aria-pressed', 'true');
});

for (const [label, initial, next] of [['Save', [], [MINT]], ['Remove', [MINT], []]]) test(`direct ${label} retry after uncertain persistence preserves the displayed intention`, async ({ page }) => {
  await seed(page, JSON.stringify(initial)); await page.goto(`/token/${MINT}`); await ready(page);
  const button = page.locator('#coin-watch'); await expect(button).toHaveAttribute('aria-pressed', String(initial.length > 0));
  await fault(page, 'readback'); await button.click();
  await expect(coinStatus(page)).toContainText('saved selection may have changed');
  await expect(button).toHaveAttribute('aria-pressed', String(initial.length > 0));
  expect(await page.evaluate(() => qaWatchEvents)).toBe(0);
  // Restore access without navigating or rerendering the initiating control.
  // The next native click must retry its displayed intention, not toggle the
  // already-written durable value back to the opposite selection.
  await page.evaluate(() => qaRestoreWatchStorage()); await button.click();
  await expect(button).toHaveAttribute('aria-pressed', String(next.length > 0));
  expect(JSON.parse(await raw(page))).toEqual(next);
  expect(await page.evaluate(() => qaWatchEvents)).toBe(0);
  await expect(coinStatus(page)).toContainText(next.length ? 'Token saved' : 'Token removed');
});

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

test('Explore native watch action does not announce success when saving fails', async ({ page }) => {
  await seed(page, '[]'); await verifiedFeed(page); await page.goto('/#explore'); await ready(page);
  await page.locator('button[data-explore-view="grid"]').click();
  const watch = page.locator(`#asset-grid .watch-button[data-mint="${MINT}"]`); await expect(watch).toBeVisible();
  await fault(page, 'write'); await watch.click();
  await expect(page.locator('#toast')).toContainText(/could not be updated/i);
  await expect(watch).toHaveAttribute('aria-pressed', 'false'); expect(await raw(page)).toBe('[]');
  expect(await page.evaluate(() => qaWatchEvents)).toBe(0);
  await page.evaluate(() => qaRestoreWatchStorage()); await watch.click();
  await expect(watch).toHaveAttribute('aria-pressed', 'true'); expect(JSON.parse(await raw(page))).toEqual([MINT]);
  expect(await page.evaluate(() => qaWatchEvents)).toBe(1);
});
