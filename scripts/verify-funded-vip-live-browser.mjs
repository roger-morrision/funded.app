import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const origin = String(process.env.FUNDED_VERIFY_ORIGIN || 'https://funded.vip').replace(/\/$/, '');
const qaMint = String(process.env.FUNDED_QA_MINT || '').trim();
const qaWallet = String(process.env.FUNDED_QA_WALLET || '').trim();
const paths = [
  '/#overview', '/#explore', '/#launch', '/#my-launches', '/#payments',
  '/#analytics-detail', '/#referrals', '/#airdrops', '/#leaderboard',
  '/funded', '/#list', '/#docs', '/#privacy', '/#terms', '/#disclosures',
  '/#opt-out', '/#buybacks', '/#capital-flow', '/#community', '/#paid',
  '/#profile', '/#creator-settings',
];
if (qaMint) paths.push('/token/' + encodeURIComponent(qaMint));
if (qaWallet) paths.push('/wallet/' + encodeURIComponent(qaWallet));
const legal = new Map([
  ['/#terms', 'Terms of Use'], ['/#disclosures', 'Disclosures'], ['/#opt-out', 'Opt out'],
]);
const browser = await chromium.launch({ headless: true });
const result = { origin, routes: 0, legalDialogs: 0, tabs: 0, toggles: 0, filters: 0, conditionalHidden: [], apiWarnings: [] };

async function open(page, path) {
  const response = await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (response) assert.equal(response.status(), 200, path + ' did not return HTTP 200.');
  else assert.equal(page.url(), origin + path, path + ' did not navigate within the loaded page.');
  await page.locator('body.workspace-ready').waitFor({ state: 'attached', timeout: 30_000 });
  await page.locator('body.product-experience-ready').waitFor({ state: 'attached', timeout: 30_000 });
}
async function clickSelected(page, selector, attribute, counter) {
  const controls = page.locator(selector);
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (!await control.isVisible() || !await control.isEnabled()) continue;
    await control.click();
    assert.equal(await control.getAttribute(attribute), 'true',
      selector + ' did not select its clicked control.');
    result[counter] += 1;
  }
}
async function selectEvery(page, selector, popover = false) {
  const control = page.locator(selector);
  const values = await control.locator('option').evaluateAll(options => options.map(option => option.value));
  for (const value of values) {
    if (popover && await page.locator('#explore-filter-toggle').getAttribute('aria-expanded') !== 'true') {
      await page.locator('#explore-filter-toggle').click();
    }
    if (!await control.isVisible() || !await control.isEnabled()) {
      result.conditionalHidden.push(selector);
      break;
    }
    await control.selectOption(value);
    assert.equal(await control.inputValue(), value, selector + ' failed to select ' + value);
    result.filters += 1;
  }
}

try {
  const verifyRoutes = async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let activePath = '';
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname.startsWith('/api/') && response.status() >= 400) {
        result.apiWarnings.push({ path: activePath, api: url.pathname, status: response.status() });
      }
    });
    for (const path of paths) {
      activePath = path;
      const errorCount = errors.length;
      await open(page, path);
      if (legal.has(path)) {
        await page.locator('#info-dialog[open]').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#info-title').innerText(), legal.get(path));
        result.legalDialogs += 1;
      } else {
        const headings = await page.locator('h1:visible, h2:visible').count();
        assert(headings > 0, path + ' has no visible heading.');
      }
      if (qaMint && path.startsWith('/token/')) {
        await page.locator('#coin-page-title').filter({ hasNotText: 'Loading token' }).waitFor({ state: 'visible', timeout: 30_000 });
        assert(!/Loading token/i.test(await page.locator('#coin-page-title').innerText()), 'QA token heading stayed in loading state.');
      }
      assert.equal(errors.length, errorCount, path + ' had uncaught browser errors.');
      result.routes += 1;
    }
    await page.close();
  };

  const home = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  await open(home, '/#overview');
  await clickSelected(home, '[role="tab"]:visible', 'aria-selected', 'tabs');
  await home.locator('[data-home-launch-tab="all"]').click();
  await clickSelected(home, '[data-home-sort]:visible, [data-home-view]:visible', 'aria-pressed', 'toggles');
  await home.locator('.home-feed-settings > summary').click();
  const flags = home.locator('[data-home-filter-flag]');
  for (let index = 0; index < await flags.count(); index += 1) {
    const flag = flags.nth(index);
    await flag.check();
    assert(await flag.isChecked());
    await flag.uncheck();
    result.filters += 1;
  }
  const ranges = home.locator('[data-home-range]');
  for (let index = 0; index < await ranges.count(); index += 1) {
    const range = ranges.nth(index);
    await range.fill('1');
    assert.equal(await range.inputValue(), '1');
    await range.fill('');
    result.filters += 1;
  }
  if (qaMint) {
    await home.locator('#home-filter-search').fill(qaMint.slice(0, 8));
    await home.locator('#home-launch-filter-form button[type="submit"]').click();
    await home.waitForTimeout(500);
    const searchCount = await home.locator('#home-board-count').innerText();
    assert(searchCount.includes('1 VERIFIED COIN'), 'Exact QA mint search did not narrow Home to one coin.');
    if (await home.locator('.home-feed-settings').getAttribute('open') === null) {
      await home.locator('.home-feed-settings > summary').click();
    }
    await home.locator('#home-filter-reset').click();
    assert.equal(await home.locator('#home-filter-search').inputValue(), '');
    result.filters += 2;
  }
  await home.close();

  const explore = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  await open(explore, '/#explore');
  await clickSelected(explore, '[data-explore-tab]:visible, [data-explore-view]:visible, [data-explore-window]:visible',
    'aria-pressed', 'toggles');
  await selectEvery(explore, '#explore-sort');
  for (const id of ['explore-promotion-filter', 'explore-reward-filter', 'explore-risk-filter',
    'explore-max-age-hours', 'explore-authority-filter']) await selectEvery(explore, '#' + id, true);
  if (await explore.locator('#explore-clear-filters').isVisible()) {
    await explore.locator('#explore-clear-filters').click();
    assert.equal(await explore.locator('#explore-promotion-filter').inputValue(), 'all');
    result.filters += 1;
  }
  await explore.close();

  for (const path of ['/#my-launches', '/#leaderboard', '/#airdrops',
    ...(qaMint ? ['/token/' + encodeURIComponent(qaMint)] : []),
    ...(qaWallet ? ['/wallet/' + encodeURIComponent(qaWallet)] : [])]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    await open(page, path);
    if (qaMint && path.startsWith('/token/')) {
      await page.locator('#coin-page-title').filter({ hasNotText: 'Loading token' }).waitFor({ state: 'visible' });
    }
    await clickSelected(page, '[role="tab"]:visible', 'aria-selected', 'tabs');
    if (qaMint && path.startsWith('/token/')) {
      await clickSelected(page, '[data-coin-trade-filter]:visible, [data-coin-trade-side]:visible',
        'aria-pressed', 'toggles');
    }
    await page.close();
  }
  await verifyRoutes();
  result.apiWarnings = [...new Map(result.apiWarnings.map(item =>
    [item.path + item.api + item.status, item])).values()];
  console.log(JSON.stringify({ verification: 'read-only-live-browser', ...result }));
} finally {
  await browser.close();
}
