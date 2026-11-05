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
const result = { origin, routes: 0, legalDialogs: 0, tabs: 0, toggles: 0, filters: 0, conditionalHidden: [], conditionalDisabled: [], apiWarnings: [] };

async function open(page, path) {
  console.log(JSON.stringify({check:'open',path,width:page.viewportSize().width}));
  const response = await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (response) assert.equal(response.status(), 200, path + ' did not return HTTP 200.');
  else assert.equal(page.url(), origin + path, path + ' did not navigate within the loaded page.');
  try {
    await page.locator('body.workspace-ready').waitFor({ state: 'attached', timeout: 30_000 });
    await page.locator('body.product-experience-ready').waitFor({ state: 'attached', timeout: 30_000 });
  } catch (error) {
    console.log(JSON.stringify({check:'startup-failed',path,width:page.viewportSize().width,body:await page.locator('body').getAttribute('class'),title:await page.title()}));
    throw error;
  }
}
async function clickSelected(page, selector, attribute, counter) {
  const controls = page.locator(selector);
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (!await control.isVisible() || !await control.isEnabled()) continue;
    console.log(JSON.stringify({check:'control',selector,text:(await control.textContent()).trim(),url:page.url()}));
    await control.click();
    console.log(JSON.stringify({check:'after-control',url:page.url()}));
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
    if(await control.locator('option').evaluateAll((options,value)=>options.find(option=>option.value===value)?.disabled,value)){result.conditionalDisabled.push(selector+'='+value);continue;}
    await control.selectOption(value);
    assert.equal(await control.inputValue(), value, selector + ' failed to select ' + value);
    result.filters += 1;
  }
}

try {
  const verifyRoutes = async width => {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
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
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path + ' overflows the viewport at ' + width);
      result.routes += 1;
    }
    await page.close();
  };

  for (const width of [390, 1280]) {
  const home = await browser.newPage({ viewport: { width, height: 850 } });
  await open(home, '/#overview');
  await clickSelected(home, '[data-home-discovery]:visible', 'aria-pressed', 'toggles');
  assert.equal(await home.locator('[data-home-discovery="saved"]').getAttribute('aria-pressed'),'true');
  await home.locator('[data-home-discovery="new"]').click();
  assert.equal(await home.locator('[data-home-discovery="new"]').getAttribute('aria-pressed'),'true');
  await home.getByRole('link',{name:'View all coins →',exact:true}).click();
  assert(new URL(home.url()).hash==='#explore','Home must link to the complete scanner.');
  await home.close();

  const explore = await browser.newPage({ viewport: { width, height: 850 } });
  await open(explore, '/#explore');
  await clickSelected(explore, 'button[data-explore-tab]:visible, button[data-explore-view]:visible, button[data-explore-window]:visible',
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
    const page = await browser.newPage({ viewport: { width, height: 850 } });
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
  }
  for (const width of [390,1280]) await verifyRoutes(width);
  result.apiWarnings = [...new Map(result.apiWarnings.map(item =>
    [item.path + item.api + item.status, item])).values()];
  console.log(JSON.stringify({ verification: 'read-only-live-browser', ...result }));
} finally {
  await browser.close();
}
