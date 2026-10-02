import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
await context.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.fulfill({ status: 403, body: 'Read-only UI verification' }));
const page = await context.newPage();
const evidenceDir = process.env.UI_CONCISE_EVIDENCE_DIR || '.tmp-ui-evidence/concise-pages-local';
await mkdir(evidenceDir, { recursive: true });
const results = [];
const checks = [
  ['overview', '.home-kpi-more', true],
  ['explore', '[data-infographic-poster="explore"] .infographic-poster-rail', false],
  ['payments', '#rewards-overview .reward-entry-grid span', false],
  ['airdrops', '.airdrop-reference-flow', false],
  ['buybacks', '.burn-why-card', false],
  ['privacy', '[data-infographic-poster="privacy"] .infographic-poster-rail', false],
];
for (const [route, selector, expectedVisible] of checks) {
  await page.goto(`${base}/#${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body.workspace-ready');
  const element = page.locator(selector).first();
  await element.waitFor({ state: 'attached' });
  const visible = await element.isVisible();
  const debug = await page.evaluate(() => ({ bodyClass: document.body.className, conciseStyle: [...document.styleSheets].some(sheet => sheet.href?.includes('concise-pages')), flowDisplay: getComputedStyle(document.querySelector('.airdrop-reference-flow') || document.body).display }));
  assert.equal(visible, expectedVisible, `${route}: ${selector} ${JSON.stringify(debug)}`);
  results.push({ route, selector, visible });
  if (route === 'overview') {
    const hero = await page.locator('.hero-section').evaluate(element => ({ height: element.getBoundingClientRect().height, minHeight: getComputedStyle(element).minHeight, padding: getComputedStyle(element).padding }));
    results.push({ route: 'overview hero', ...hero });
    assert(hero.height <= 450, 'Mobile home hero should not leave a large empty gap');
    const spotlight = page.locator('.home-jackpot-spotlight');
    if (await spotlight.count()) {
      const status = await spotlight.locator('[data-home-jackpot-status]').textContent();
      if (/inactive|unavailable|not funded/i.test(status)) assert.equal(await spotlight.isVisible(), false);
    }
    assert.equal(await page.locator('.home-kpi-dashboard > .home-kpi-grid > .home-kpi-card').count(), 6);
    assert.equal(await page.locator('.home-kpi-more .home-kpi-card').count(), 6);
    assert.equal(await page.locator('.home-kpi-more').evaluate(element => element.open), false);
    await page.locator('.home-kpi-more summary').click();
    assert.equal(await page.locator('.home-kpi-more').evaluate(element => element.open), true);
  }
  if (route === 'payments') {
    const jackpot = page.locator('#payments > .jackpot-disclosure');
    await jackpot.waitFor({ state: 'attached' });
    assert.equal(await jackpot.evaluate(element => element.open), false);
    assert(await jackpot.evaluate(element => element === document.querySelector('#payments')?.lastElementChild));
    await jackpot.locator(':scope > summary').click();
    assert.equal(await jackpot.evaluate(element => element.open), true);
    await jackpot.locator(':scope > summary').click();
  }
  if (route === 'airdrops') {
    assert(await page.locator('[data-infographic-poster="airdrops"]').isVisible());
    const poster = page.locator('[data-infographic-poster="airdrops"]');
    const directory = page.locator('.airdrop-public-programs');
    assert(await poster.evaluate((element, directoryElement) => element.closest('.airdrop-trust')?.previousElementSibling === document.querySelector('.airdrop-public-programs'), null));
    assert(await directory.isVisible());
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route}: horizontal overflow`);
  if (['overview', 'payments', 'airdrops', 'buybacks'].includes(route)) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${evidenceDir}/${route}-mobile.png` });
  }
}
await writeFile(process.env.UI_CONCISE_OUTPUT || '.tmp-ui-evidence/concise-pages-check.json', JSON.stringify(results, null, 2));
await browser.close();
console.log(JSON.stringify({ checked: results.length, results }, null, 2));
