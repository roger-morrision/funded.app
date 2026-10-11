import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.UI_BASE_URL || 'https://funded.vip';
const output = resolve(process.env.UI_EVIDENCE_DIR || 'tmp/release-ui');
const routes = ['overview', 'explore', 'launch', 'payments', 'my-launches', 'community', 'analytics-detail', 'referrals', 'airdrops', 'buybacks', 'capital-flow', 'docs', 'profile', 'leaderboard', 'paid', 'list', 'privacy'];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const results = [], errors = [], blocked = [], inventory = [];
// Real public GET responses. Block mutations; wallet and chain signing are
// covered separately. No injected launches, balances, receipts or identities.
await context.route('**/api/**', async route => {
  const request = route.request();
  const rpcRead = /\/rpc(?:\?|$)/.test(request.url()) && !/sendTransaction|requestAirdrop/.test(request.postData() || '');
  if (request.method() !== 'GET' && !rpcRead) {
    blocked.push({ path: new URL(request.url()).pathname, method: request.method() });
    return route.fulfill({ status: 403, json: { error: 'Read-only release audit' } });
  }
  return route.continue();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
async function check(name, callback) {
  try { await callback(); results.push({ name, status: 'passed' }); }
  catch (error) { results.push({ name, status: 'failed', error: error.message.slice(0, 600) }); }
}
async function open(route) {
  await page.goto(`${base}/#${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.bootstrapState === 'ready', null, { timeout: 60000 });
  assert.equal(await page.locator('#bootstrap-status').isVisible(), false, 'Startup failure or loading banner remains visible');
  await page.waitForFunction(() => document.body.classList.contains('workspace-ready'));
  await page.waitForFunction(() => document.body.classList.contains('product-experience-ready'));
}
async function fit() {
  const size = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert(size.content <= size.viewport + 1, JSON.stringify(size));
}
try {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of routes) {
      await check(`${route} ${width}px page`, async () => {
        await open(route); await fit();
        assert(await page.locator('body').evaluate((node, route) => node.classList.contains(`page-route-${route}`), route), 'Requested route not active');
        assert(await page.locator('main h1:visible, main h2:visible, #launch-dialog h2:visible').count() > 0, 'Page heading missing');
        const controls = await page.locator('main button:visible, main a:visible, main select:visible').evaluateAll(nodes => nodes.map(n => ({ tag: n.tagName, id: n.id, text: (n.innerText || n.getAttribute('aria-label') || '').trim().slice(0, 100), disabled: n.disabled === true, href: n.getAttribute('href') })));
        inventory.push({ route, width, controls });
        await page.screenshot({ path: resolve(output, `${route}-${width}.png`) });
      });
      // Expand disclosures through native clicks, including on mobile.
      const summaries = page.locator('main details:visible > summary');
      for (let i = 0; i < await summaries.count(); i++) {
        await check(`${route} ${width}px disclosure ${i}`, async () => {
          // Live data can replace a disclosure while its click settles. Locators
          // re-resolve the current node; element handles stay attached to the old one.
          const summary = summaries.nth(i);
          const detail = summary.locator('..');
          const before = await detail.evaluate(n => n.open);
          await summary.click({ timeout: 3000 });
          assert.equal(await detail.evaluate(n => n.open), !before);
          await fit();
          if (!before) {
            const nested = detail.locator('details > summary:visible');
            for (let nestedIndex = 0; nestedIndex < await nested.count(); nestedIndex++) {
              const child = nested.nth(nestedIndex);
              await check(`${route} ${width}px disclosure ${i} nested ${nestedIndex}`, async () => {
                const childDetail = child.locator('..');
                const childBefore = await childDetail.evaluate(node => node.open);
                await child.click({ timeout: 3000 });
                assert.equal(await childDetail.evaluate(node => node.open), !childBefore);
                await fit();
                await child.click({ timeout: 3000 });
              });
            }
          }
          if (await detail.locator('#home-filter-close').count()) await page.locator('#home-filter-close').click();
          else await summary.click({ timeout: 3000 });
        });
      }
      // Current tab groups, view toggles, filter tabs, and quick sorts.
      const selectors = ['[role="tab"]', '[data-explore-tab]', '[data-explore-sort]', '[data-explore-view]', '[data-explore-window]', '[data-home-view]', '[data-home-sort]', '[data-home-launch-tab]'];
      for (const selector of selectors) {
        const buttons = page.locator(`main button${selector}:visible:enabled`);
        for (let i = 0; i < await buttons.count(); i++) {
          const button = buttons.nth(i);
          const label = (await button.innerText()).trim();
          await check(`${route} ${width}px ${selector} ${label}`, async () => {
            await button.click({ timeout: 3000 });
            const selected = await button.getAttribute('aria-selected');
            const pressed = await button.getAttribute('aria-pressed');
            if (selected !== null) assert.equal(selected, 'true');
            if (pressed !== null) assert.equal(pressed, 'true');
            const panel = await button.getAttribute('aria-controls');
            if (panel) assert(await page.locator(`#${panel}`).isVisible());
            if (selector === '[data-explore-tab]') assert.equal(new URL(page.url()).hash, '#explore');
            await fit();
          });
        }
      }
      // Exercise every enabled option on visible sorting/filtering selects.
      const selects = page.locator('main select:visible:enabled');
      for (let i = 0; i < await selects.count(); i++) {
        const select = selects.nth(i), id = await select.getAttribute('id');
        if (!/sort|filter|range|window|stage|risk|authority|max-age|min-cap/.test(id || '')) continue;
        const original = await select.inputValue();
        const options = await select.locator('option:not([disabled])').evaluateAll(nodes => nodes.map(n => n.value));
        for (const value of options) await check(`${route} ${width}px #${id}=${value}`, async () => {
          await select.selectOption(value); assert.equal(await select.inputValue(), value); await fit();
        });
        await select.selectOption(original);
      }
      console.log(`${route} ${width}px reviewed`);
    }
  }
  await check('No uncaught JavaScript errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  const report = { base, checkedAt: new Date().toISOString(), evidence: 'Live public reads; no wallet connection, signing, or transactions; no data fixtures', results, errors, blocked, inventory };
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: results.filter(r => r.status === 'passed').length, failed: results.filter(r => r.status === 'failed').length, errors, blocked, output }));
  if (results.some(r => r.status === 'failed') || errors.length) process.exitCode = 1;
}
