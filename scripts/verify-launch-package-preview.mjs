import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"mocked offline API"}' }));
  await page.goto(`${base}/#launch`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('workspace-ready') && !!document.querySelector('#launch-package-example'), { timeout: 30_000 });
  await page.locator('#token-name').fill('Orbit Fox');
  await page.locator('#token-symbol').fill('FOX');
  await page.getByText('Description · optional', { exact: true }).click();
  await page.locator('#token-description').fill('A community coin for explorers.');
  assert.equal(await page.locator('#preview-name').textContent(), 'Orbit Fox');
  assert.equal(await page.locator('#preview-symbol').textContent(), 'FOX');
  assert.equal(await page.locator('#preview-tagline').textContent(), 'A community coin for explorers.');
  const artwork = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    context.fillStyle = '#9867db';
    context.fillRect(0, 0, 128, 128);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#token-image').setInputFiles({ name: 'preview.png', mimeType: 'image/png', buffer: Buffer.from(artwork, 'base64') });
  await page.locator('#launch-package-example-art.has-image').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#preview-token-image.has-image').count(), 1);
  await page.getByRole('button', { name: 'Continue to rewards', exact: true }).click();
  assert.equal(await page.locator('.launch-package-preview').evaluate(node => Boolean(node.closest('details'))), false, 'Package preview must not be collapsible.');

  for (const [tier, postCount, text, artVisible] of [
    ['standard', '1 post', 'New project on funded.vip', false],
    ['pro', '1 post', 'Pro launch:', true],
    ['premier', '2 posts', 'Premier launch:', true],
  ]) {
    await page.locator(`.creator-burn-card[data-burn-tier="${tier}"]`).click();
    assert.equal(await page.locator('#launch-package-example').getAttribute('data-tier'), tier);
    assert.equal(await page.locator('#launch-x-post-count').textContent(), postCount);
    assert((await page.locator('#launch-x-post-preview').textContent()).includes(text));
    assert((await page.locator('#launch-x-post-preview').textContent()).includes('Orbit Fox'));
    assert.equal(await page.locator('#launch-package-example-art').isVisible(), artVisible);
    assert.equal(await page.locator('#launch-x-followup').isVisible(), tier === 'premier');
  }

  const feeOptions = page.locator('.launch-fee-options');
  assert.equal(await feeOptions.evaluate(node => node.tagName), 'SECTION');
  assert.equal(await feeOptions.locator('summary').count(), 0);
  assert.equal(await page.locator('#launch-mode-custom').isVisible(), true);
  assert.equal(await page.locator('.launch-preview-panel').isVisible(), true);
  const logoWidth = await page.locator('#preview-token-image').evaluate(node => node.getBoundingClientRect().width);
  assert(logoWidth <= 50, 'Preview logo should stay compact');

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `${width}px horizontal overflow`);
    assert.equal(await page.locator('#launch-x-post-preview').isVisible(), true);
  }
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  console.log('Launch package preview: tier layouts, X drafts, input updates, expanded fee sharing and responsive widths passed (mocked API; local-only).');
} finally {
  await browser.close();
}
