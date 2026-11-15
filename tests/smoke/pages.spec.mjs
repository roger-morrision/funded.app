import { test, expect } from '@playwright/test';

// Every public page, opened without a wallet. `title` is the start of the
// document title once the route has rendered.
const PAGES = [
  { path: '/', title: /^Home/ },
  { path: '/#explore', title: /^Explore/ },
  { path: '/#top100', title: /^Top 100/ },
  { path: '/#portfolio', title: /^Portfolio/ },
  { path: '/#rewards', title: /^Rewards/ },
  { path: '/#payments', title: /^Rewards/ },
  { path: '/#callouts', title: /^Callouts/ },
  { path: '/#creators', title: /^Creators/ },
  { path: '/#referrals', title: /^Referrals/ },
  { path: '/#bonuses', title: /^Daily bonuses/ },
  { path: '/#airdrops', title: /^Airdrops/ },
  { path: '/#leaderboard', title: /^Leaderboard/ },
  { path: '/#list', title: /^Get listed/ },
  { path: '/#buybacks', title: /^Burn \$RICH/ },
  { path: '/#docs', title: /^Docs/ },
];

// Time for polled data (market figures, rankings) to arrive after the route renders.
const SETTLE_MS = 5_000;
// Statuses that mean "slow down", not "broken".
const TOLERATED_STATUS = new Set([429]);

// Collects uncaught script errors and failed same-origin API reads for one page.
function watch(page, origin) {
  const problems = [];
  page.on('pageerror', error => problems.push(`script error: ${error.message}`));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== origin || !url.pathname.startsWith('/api/')) return;
    if (response.status() >= 400 && !TOLERATED_STATUS.has(response.status()))
      problems.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
  });
  return problems;
}

// Figures (amounts, percentages, counts) cut off by an ellipsis. Names and
// addresses may be shortened on purpose, so only numeric text is checked.
function clippedFigures() {
  const figure = /^[\s≈~+\-−$\d.,KMBT%·()×x]+$/;
  const out = [];
  for (const el of document.querySelectorAll('#main-content *')) {
    if (el.children.length > 2 || !el.offsetParent) continue;
    const style = getComputedStyle(el);
    if (style.textOverflow !== 'ellipsis' || el.scrollWidth <= el.clientWidth + 1) continue;
    const text = el.textContent.trim();
    if (text && /\d/.test(text) && figure.test(text)) out.push(`${el.tagName.toLowerCase()}.${el.className || '-'}: "${text}"`);
  }
  return out;
}

async function open(page, path, title) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  if (title) await expect(page).toHaveTitle(title, { timeout: 20_000 });
  await page.waitForTimeout(SETTLE_MS);
}

async function expectHealthy(page, problems) {
  expect(problems, 'script errors or failed API reads').toEqual([]);
  expect(await page.evaluate(clippedFigures), 'figures cut off by an ellipsis').toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(1);
}

for (const { path, title } of PAGES) {
  test(`page ${path}`, async ({ page, baseURL }) => {
    const problems = watch(page, new URL(baseURL).origin);
    await open(page, path, title);
    await expect(page.locator('#main-content')).toBeVisible();
    await expectHealthy(page, problems);
  });
}

// Token and wallet pages need a real address; take them from the live directory.
test('token page for an Explore coin', async ({ page, request, baseURL }) => {
  const feed = await (await request.get('/api/pump/explore?limit=10&sort=last_trade_timestamp')).json();
  const coin = (feed.items || []).find(item => item.mint || item.address);
  test.skip(!coin, 'Explore directory is empty');
  const problems = watch(page, new URL(baseURL).origin);
  await open(page, `/token/${coin.mint || coin.address}`);
  await expect(page.locator('#coin-page-title')).not.toHaveText(/^\s*$/);
  await expectHealthy(page, problems);
});

test('wallet page for a recent caller', async ({ page, request, baseURL }) => {
  const calls = await (await request.get('/api/callouts')).json();
  const wallet = calls.callouts?.[0]?.author;
  test.skip(!wallet, 'No calls to take a wallet from');
  const problems = watch(page, new URL(baseURL).origin);
  await open(page, `/wallet/${wallet}`, /^Wallet/);
  await expectHealthy(page, problems);
});

test('Top 100 keeps its sort in the address', async ({ page, baseURL }) => {
  const problems = watch(page, new URL(baseURL).origin);
  await open(page, '/?top.sort=volume#top100', /^Top 100/);
  await expect(page.locator('[data-top-sort="volume"]')).toHaveAttribute('aria-pressed', 'true');
  await expectHealthy(page, problems);
});
