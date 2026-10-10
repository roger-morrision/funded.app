import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:4180';
const output = '.tmp-ui-evidence/money-flows';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [
  { route: '#analytics-detail', selector: '[data-page-infographic="analytics"]', flow: 'collection', labels: ['FEE COLLECTION', '100%', 'claimed creator fees routed', 'Verified claim'] },
  { route: '#capital-flow', selector: '[data-page-infographic="capital"]', flow: 'distribution', labels: ['80% / 20%', 'creator-directed / protocol', '10% Ops', '3% Referrals', '2% Community', '5% Buyback/burn'] },
  { route: '#paid', selector: '[data-infographic-poster="fees"]', flow: 'distribution', labels: ['80% / 20%', 'creator-directed / protocol', '10% Ops', '3% Referrals', '2% Community', '5% Buyback/burn'] },
  { route: '#payments', selector: '[data-infographic-poster="rewards"]', flow: 'rewards', labels: ['REWARD DISTRIBUTION', '80%', 'creator-directed fee pool', 'Holder + X per token'] },
  { route: '#funded-holder-token-rewards', selector: '[data-page-infographic="holder"]', flow: 'rewards', labels: ['HOLDER SOL PAYOUTS', '0–80%', 'holder share set per token', '≥0.01 SOL payout'] },
];

try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
    await context.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    for (const check of checks) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/${check.route}`, { waitUntil: 'commit', timeout: 60000 });
      const poster = page.locator(check.selector);
      await poster.waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForFunction(selector => Boolean(document.querySelector(selector)?.dataset.moneyFlowPoster), check.selector);
      assert.equal(await poster.getAttribute('data-money-flow-poster'), check.flow);
      assert.equal(await poster.locator('.money-flow-caption').count(), 1, 'one caption per poster');
      assert.equal(await poster.locator('.money-flow-caption').evaluate(element => getComputedStyle(element).position), 'absolute', 'labels should overlay the artwork');
      const picture = poster.locator('figure > img');
      await picture.scrollIntoViewIfNeeded();
      await page.waitForFunction(selector => {
        const image = document.querySelector(`${selector} figure > img`);
        return image?.complete && image.naturalWidth > 0;
      }, check.selector, { timeout: 15000 });
      for (const label of check.labels) assert((await poster.textContent()).includes(label), `${check.route}: missing ${label}`);
      assert.equal(errors.length, 0, `${check.route}: ${errors.join('; ')}`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${check.route}: horizontal overflow at ${width}`);
      if (check.route === '#paid') {
        const policy = page.locator('#paid .funded-policy-details');
        assert(await policy.locator('summary').isVisible());
        assert.equal(await policy.getAttribute('open'), null);
      }
      if (await poster.isVisible()) await poster.screenshot({ path: `${output}/${check.flow}-${check.route.replace(/[^a-z]+/gi, '-')}-${width}.png` });
      await page.close();
      console.log(`${check.route} ${width}: ${check.flow} ✓`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
