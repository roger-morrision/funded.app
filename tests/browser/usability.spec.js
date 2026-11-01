import {requiredFeePolicyForCompiled,browserModuleRoute} from '../fixtures/compiled-artifact-fixture.js';
import { test, expect } from '@playwright/test';

const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = []; failures.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => requiredFeePolicyForCompiled(route) ?? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable fixture"}' }));
  await page.route('https://**/*', route => route.abort());
});
test.afterEach(async ({ page }) => expect(failures.get(page), 'No uncaught browser exceptions').toEqual([]));

async function open(page, route) {
  await page.goto(`/#${route}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
}

for (const width of [1280, 900, 620, 390, 320]) test(`Explore Filters stay in view and close from the same toggle at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 750 });
  await open(page, 'explore');
  await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
  const toggle = page.locator('#explore-filter-toggle');
  const popover = page.locator('#explore-filter-popover');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(popover).toBeVisible();
  const assertInsideViewport = async () => {
    const box = await popover.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  };
  await assertInsideViewport();
  await page.locator('#explore-promotion-filter').selectOption('standard');
  await page.locator('#explore-clear-filters').click();
  await expect(page.locator('#explore-promotion-filter')).toHaveValue('all');
  await assertInsideViewport();
  await page.setViewportSize({ width, height: 600 });
  await assertInsideViewport();
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(popover).toBeHidden();
});

for (const width of [390, 1440]) test(`X launch setup ignores global reward-service status at ${width}px (mocked APIs)`, async ({ page, baseURL }, info) => {
  await page.setViewportSize({width,height:900});
  const requests=[], errors=[], writes=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const q=route.request(),u=new URL(q.url());return u.origin===new URL(baseURL).origin&&(q.method()==='GET'||u.pathname.startsWith('/api/'))?route.fallback():route.abort();});
  await page.route('**/api/**',route=>{const q=route.request(),path=new URL(q.url()).pathname;requests.push(path);if(q.method()!=='GET'&&path!=='/api/solana/rpc')writes.push(path);return route.fulfill({status:503,json:{error:'signal timed out'}});});
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{revision:6,split:{operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10}}}));
  await page.goto('/#launch');await page.locator('body.workspace-ready.product-experience-ready.product-flows-ready').waitFor();
  await page.locator('#token-name').fill('X reward launch');await page.locator('#token-symbol').fill('XQA');
  await page.locator('#creator-wallet-share').fill('70');await page.locator('#x-share').fill('10');
  await page.locator('#launch-next').click();await expect(page.locator('#x-recipient')).toBeFocused();
  await page.locator('#x-recipient').fill('@example');await expect(page.locator('#fee-distribution-status')).toBeHidden();
  await expect(page.locator('#x-share-help')).toHaveText('SOL rewards for the named X account. Account checked before launch.');
  await page.locator('#launch-next').click();await expect(page.locator('#benefits-step-title')).toBeVisible();
  await expect(page.locator('#launch-summary-x')).toHaveText('10%');await expect(page.locator('#launch-button')).toBeDisabled();
  await expect(page.locator('#wizard-hint')).not.toContainText('X account rewards unavailable');
  await page.locator('#launch-back').click();await expect(page.locator('#x-recipient')).toHaveValue('@example');
  await expect(page.locator('#fee-distribution-status')).toBeHidden();
  await page.screenshot({path:info.outputPath('x-rewards-without-service-gate.png')});
  // The rewards panel may read its own status; launch only resolves an account at submission.
  expect(requests.filter(path=>path==='/api/x/resolve')).toEqual([]);
  expect(errors).toEqual([]);expect(writes).toEqual([]);
});

test('an unavailable optional module leaves navigation usable and explains reload recovery', async ({ page }) => {
  await page.route(browserModuleRoute('creator-support-ui.js'), route => route.abort('failed'));
  await open(page, 'explore');
  await expect(page.locator('#bootstrap-status')).toContainText('Reload');
  await expect(page.locator('#explore-search')).toBeVisible();
  await page.goto('/#docs');
  await page.getByRole('button', { name: 'Check service status' }).click();
  await expect(page.locator('#service-status [role=status]')).toContainText('unavailable');
});

test('desktop destinations are unique and secondary navigation stays visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, 'explore');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  for (const destination of ['overview', 'explore', 'my-launches', 'payments']) {
    await expect(nav.locator(`a[href="#${destination}"]`)).toHaveCount(1);
    await expect(nav.locator(`a[href="#${destination}"]`)).toBeVisible();
  }
  await expect(nav.locator('details')).toHaveCount(0);
  const more = nav.locator('.nav-more-menu');
  await expect(more).toBeVisible();
  await more.locator('a').first().focus();
  await page.keyboard.press('Tab');
  await expect(more.locator('a').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeVisible();
  await expect(more.locator('a').nth(1)).toBeFocused();
});

test('navigation links and leaderboard tabs change views without generic success toasts', async ({ page }) => {
  await open(page, 'launch');
  await page.getByRole('link', { name: 'Read the launch guide →' }).click();
  await expect(page).toHaveURL(/#docs\/launch$/);
  await expect(page.locator('#docs-guide-article h1')).toHaveText('Launch a token');
  await expect(page.locator('.docs-guide-nav [aria-current="page"]')).toHaveText('Launch a token');
  await expect(page.locator('#toast')).not.toContainText('View updated.');

  await open(page, 'leaderboard');
  const burnBoard = page.locator('#leaderboard-burn-board-tab');
  await burnBoard.click();
  await expect(burnBoard).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#toast')).not.toContainText('Burn board view selected');
});

test('primary portfolio and rewards remain reachable on compact desktop Home', async ({ page }) => {
  for (const width of [901, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, 'overview');
    await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    for (const destination of ['my-launches', 'payments']) {
      await expect(nav.locator(`a[href="#${destination}"]`)).toHaveCount(1);
      await expect(nav.locator(`a[href="#${destination}"]`)).toBeVisible();
    }
    for (const control of await nav.locator('a[href="#my-launches"], a[href="#payments"], a[href="#analytics-detail"]').all()) {
      await expect.poll(() => control.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), { message: `Primary navigation must stay clickable at ${width}px` }).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('mobile header actions do not overlap and touched controls have usable hit areas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['overview', 'launch']) {
    await open(page, route);
    await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state', 'ready');
    await expect(page.locator('#open-menu')).toBeVisible();
    await expect(page.locator('#connect-button')).toBeVisible();
    const menu = await page.locator('#open-menu').boundingBox();
    const wallet = await page.locator('#connect-button').boundingBox();
    expect(menu.x + menu.width).toBeLessThanOrEqual(wallet.x);
    expect(menu.height).toBeGreaterThanOrEqual(44);
    expect(wallet.height).toBeGreaterThanOrEqual(44);
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
    const button = page.locator('[data-verified-feed-retry]:visible, [data-explore-empty-action="retry"]:visible').first();
    await expect(button).toBeVisible();
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/pump/explore')),
      button.click(),
    ]);
    await expect(page.locator('[data-verified-feed-retry]:visible, [data-explore-empty-action="retry"]:visible').first()).toBeEnabled();
  }
  await retry();
  await open(page, 'explore');
  for (const layout of ['table', 'grid']) {
    await page.locator(`button[data-explore-view="${layout}"]`).click();
    await retry();
  }
});

test('Traders remain visible on a narrow phone and explain unavailable sample data', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 750 });
  await open(page, 'leaderboard');
  const tab = page.getByRole('tab', { name: 'Traders' });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#leaderboard-panel')).toHaveAttribute('aria-labelledby', 'leaderboard-traders-tab');
  await expect(page.locator('#leaderboard-table-title')).toHaveText('Observed trader leaderboard');
  await expect(page.locator('#leaderboard-table')).toContainText('Trader ranking unavailable');
});

test('creator, token, and wallet details keep the correct parent navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 750 });
  for (const [path, parent] of [
    ['/#creators', 'explore'],
    ['/#creator-settings', 'my-launches'],
    ['/creator/x/1816694905915506688', 'explore'],
    ['/token/CfYFJqMB5Fd4jVzWauXqaBoHbenLcqRawz69hBF9wb3o', 'explore'],
    ['/wallet/ej8gdawG6NrZw942uMbBN1qjJYWgtrUgPX6ewesYwsx', 'my-launches'],
  ]) {
    await page.goto(path);
    await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await expect(page.locator(`.mobile-workspace-nav a[href="#${parent}"]`)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(`.nav-item[href="#${parent}"]`)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.nav-item[href="#overview"]')).not.toHaveAttribute('aria-current', 'page');
  }
});
