import { test, expect } from '@playwright/test';

// Deterministic UI checks: approved default policy, unavailable data services,
// no wallets or writes. This is mocked UI coverage, not financial acceptance.
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/api/fee-policy') return route.fulfill({
      contentType: 'application/json', body: '{"revision":0}',
    });
    if (url.pathname.startsWith('/api/')) return route.fulfill({
      status: 503, contentType: 'application/json', body: '{"error":"Service temporarily unavailable"}',
    });
    return route.continue();
  });
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
  await expect(page.locator('html')).not.toHaveClass(/route-booting/);
});

async function openSearch(page, query) {
  await page.locator('#header-search-trigger').click();
  const input = page.locator('#header-search-input');
  await expect(input).toBeFocused();
  await input.fill(query);
  return input;
}

async function openHelp(page) {
  if (page.viewportSize().width <= 700) await page.locator('#open-menu').click();
  await page.locator('#help-menu-trigger').click();
  const dialog = page.locator('#help-topics-panel');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveJSProperty('open', true);
  return dialog;
}

test('search opens a matching page with Arrow and Enter', async ({ page }) => {
  const input = await openSearch(page, 'docs');
  const option = page.getByRole('option', { name: /Docs & help/ });
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page).toHaveURL(/#docs$/);
  await expect(page.locator('#header-search-dialog')).not.toBeVisible();
  await expect(page.locator('#docs-guide-article')).toBeVisible();
});

test('Portfolio navigation focuses its visible heading', async ({ page }) => {
  if (page.viewportSize().width <= 700) await page.locator('#open-menu').click();
  await page.locator('#sidebar a[href="#portfolio"]').click();
  await expect(page.getByRole('heading',{name:'Your holdings. Your rewards. Together.',level:1})).toBeFocused();
});

test('search navigation focuses the destination heading', async ({ page }) => {
  const input = await openSearch(page, 'create');
  await input.press('Enter');
  await expect(page).toHaveURL(/#launch$/);
  await expect(page.getByRole('heading', { name: 'Launch your token. Share its success.', level: 1 })).toBeFocused();
});

test('a delayed first creator result can be opened with Enter', async ({ page }) => {
  const settings = await (await page.request.get('/build-settings.json')).json();
  await page.route('**/api/creators?*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ cluster: settings.cluster, creators: [{ id: '927419', name: 'Aurora Fixture', handle: 'aurora_fixture' }] }),
  }));
  const input = await openSearch(page, 'Aurora Fixture');
  const option = page.getByRole('option', { name: /Aurora Fixture/ });
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/creator\/x\/927419$/);
});

test('reopening search retries a failed token lookup', async ({ page }) => {
  const mint = 'So11111111111111111111111111111111111111112';
  let lookups = 0;
  await page.route('**/api/tokens/market?*', route => {
    lookups++;
    return route.fulfill(lookups === 1 ? { status: 503, body: '{}' } : {
      contentType: 'application/json',
      body: JSON.stringify({ items: [{ mint, name: 'Recovered token', symbol: 'SOL' }] }),
    });
  });
  await page.locator('#explore-search').fill(mint);
  const failed = page.waitForResponse(response => response.url().includes('/api/tokens/market?') && response.status() === 503);
  await page.locator('#header-search-trigger').click();
  await failed;
  await page.keyboard.press('Escape');
  await page.locator('#header-search-trigger').click();
  await expect(page.getByRole('option', { name: /Recovered token/ })).toBeVisible();
});

test('search restores page matches when reopened with an existing query', async ({ page }) => {
  await page.locator('#explore-search').fill('docs');
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator('#header-search-trigger').click();
    await expect(page.getByRole('option', { name: /Docs & help/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#header-search-trigger')).toBeFocused();
  }
});

test('unmatched search preserves the query in Explore', async ({ page }) => {
  const input = await openSearch(page, 'no-such-project-94832');
  await expect(page.locator('.header-search-empty')).toContainText('Press Enter to search Explore');
  await input.press('Enter');
  await expect(page.locator('#header-search-dialog')).not.toBeVisible();
  await expect(page.locator('#explore-search')).toHaveValue('no-such-project-94832');
});

test('late token lookup preserves an explicit wallet selection', async ({ page }) => {
  const mint = 'So11111111111111111111111111111111111111112';
  const other = '11111111111111111111111111111111';
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/tokens/market?*', async route => {
    await pending;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ mint, name: 'Wrapped SOL', symbol: 'SOL' }] }) });
  });
  await page.evaluate(({ mint, other }) => {
    window.fundedVerifiedSearchCandidates = () => [
      { mint: `wallet:${mint}`, type: 'wallet', name: 'Wallet profile', symbol: 'WALLET', subtitle: mint, href: `/wallet/${mint}`, marketCap: '', stage: '' },
      { mint: `creator:${other}`, type: 'creator', name: 'Selected creator', symbol: 'CREATOR', subtitle: other, href: `/wallet/${other}`, marketCap: '', stage: '' },
    ];
  }, { mint, other });
  try {
    const input = await openSearch(page, mint);
    await input.press('ArrowDown');
    const selected = page.getByRole('option', { name: /Selected creator/ });
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    release();
    await expect(page.getByRole('option', { name: /Wrapped SOL/ })).toBeVisible();
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    await expect(input).toHaveAttribute('aria-activedescendant', await selected.getAttribute('id'));
    await expect(input).toBeFocused();
  } finally { release(); }
});

test('help contains focus, blocks the background and restores its trigger', async ({ page }) => {
  const dialog = await openHelp(page);
  expect(await dialog.evaluate(node => node.matches(':modal'))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.locator('#explore-search').evaluate(node => node.focus());
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  const trigger = page.viewportSize().width <= 700 ? '#open-menu' : '#help-menu-trigger';
  await expect(page.locator(trigger)).toBeFocused();
  await expect(page.locator('#help-menu-trigger')).toHaveAttribute('aria-expanded', 'false');
});

test('help guide links navigate and dismiss the overlay', async ({ page }) => {
  const dialog = await openHelp(page);
  await dialog.locator('[data-help-topic="launch"]').click();
  await dialog.locator('.help-topics-answer a').click();
  await expect(page).toHaveURL(/#docs\/launch$/);
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#docs-guide-article')).toBeVisible();
});

test('help and search fit a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openSearch(page, 'claim');
  const search = page.locator('#header-search-dialog');
  let bounds = await search.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await page.keyboard.press('Escape');
  const help = await openHelp(page);
  bounds = await help.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
  await expect(help.getByRole('button', { name: 'Close help topics' })).toBeInViewport();
});

test('public routes stay usable during a service outage', async ({ page }) => {
  // Nineteen route transitions plus trace/context cleanup need more time than
  // a single interaction on a busy Windows host.
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const route of ['overview', 'explore', 'top100', 'portfolio', 'rewards', 'calls', 'creators', 'referrals', 'bonuses', 'airdrops', 'leaderboard', 'list', 'buybacks', 'docs', 'launch', 'profile', 'privacy', 'analytics-detail', 'capital-flow']) {
    await page.goto(`/#${route}`);
    await expect(page.locator('#main-content')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), route).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});
