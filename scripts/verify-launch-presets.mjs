import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
  // Layout and preset selection do not require RPC or connected accounts.
  await context.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Preset layout test: API unavailable"}' }));
  const page = await context.newPage();
  await page.goto(`${process.env.UI_BASE_URL || 'http://127.0.0.1:5173'}/#launch`);
  await page.waitForSelector('body.workspace-ready');
  const disclosure = page.locator('details').filter({ has: page.locator('.launch-profile-grid') });
  await disclosure.locator(':scope > summary').click();
  for (const width of [360, 390, 700, 701, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const preset of ['fast', 'community']) {
      const button = page.locator(`[data-launch-profile="${preset}"]`);
      assert(await button.isVisible(), `${preset} visible at ${width}px`);
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.social-section').evaluate(el => el.open), preset === 'community');
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No overflow at ${width}px`);
  }
  await disclosure.locator(':scope > summary').click();
  assert(!(await page.locator('[data-launch-profile="fast"]').isVisible()));
  console.log('Launch presets: both choices visible and selectable at 5 widths; disclosure closes correctly. Local-only, API mocked unavailable, no signing.');
} finally {
  await browser.close();
}
