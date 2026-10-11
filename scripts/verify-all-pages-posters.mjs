import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output = resolve(process.env.UI_EVIDENCE_DIR || '.tmp-ui-evidence/all-pages-posters');
await mkdir(output, { recursive: true });
const routes = [
  ['/#list', 'list'],
  ['/#payments', 'rewards'], ['/#analytics-detail', 'analytics'],
  ['/#community', 'community'], ['/#referrals', 'referrals'],
  ['/#airdrops', 'airdrops'], ['/#buybacks', 'burn'], ['/#capital-flow', 'capital'],
  ['/#docs', 'docs'], ['/#docs/launch', 'docs-subtopic'], ['/#docs/wallet', 'docs-subtopic'],
  ['/#profile', 'profile'], ['/#privacy', 'privacy'], ['/#paid', 'fees'],
  ['/#payments', 'holder'], ['/#funded-holder-token-rewards', 'funded-deep-link'],
  ['/token/11111111111111111111111111111111', 'coin'],
  ['/wallet/11111111111111111111111111111111', 'wallet'],
].filter(([path]) => !process.env.PUBLIC_UI_ONLY || (!path.startsWith('/token/') && !path.startsWith('/wallet/')));
const flowAssets = {
  coin: 'fee-collection-flow-v1.webp',
  capital: 'fee-distribution-flow-v1.webp', fees: 'fee-distribution-flow-v1.webp',
  holder: 'holder-rewards-flow-v1.webp',
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
await context.route('**/api/**', route => process.env.PUBLIC_UI_ONLY
  ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  : route.request().method() === 'GET'
    ? route.continue()
    : route.fulfill({ status: 403, body: 'Read-only UI verification' }));
const results = [];
const errors = [];
try {
  for (const width of [390, 1440]) {
    for (const [path, key] of routes) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body.workspace-ready');
      if (key === 'funded-deep-link') {
        await page.locator('#funded-holder-token-rewards').waitFor({ state: 'visible', timeout: 15000 });
        results.push({ path, key, width, sectionVisible: true });
        await page.close();
        continue;
      }
      if (key === 'holder') await page.locator('#rewards-holder-tab').click();
      if (key === 'rewards') {
        const explanation = page.locator('#rewards-overview details.product-details:has(.reward-upcoming)');
        await explanation.waitFor({ state: 'visible', timeout: 15000 });
        assert.equal(await explanation.evaluate(element => element.open), false);
        assert.equal(await page.locator('.page-cleanup-guide[data-guide="rewards"]').count(), 0);
        const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
        assert(layout.document <= layout.viewport + 1, `${path}: ${width}px overflow ${JSON.stringify(layout)}`);
        results.push({ path, key, width, textOnly: true });
        await page.close();
        continue;
      }
      if (key === 'analytics') {
        const explanation = page.locator('#analytics-detail .analytics-fee-explainer');
        await explanation.waitFor({ state: 'visible', timeout: 15000 });
        assert.match(await explanation.innerText(), /successful Solana claim confirms the fee router received the expected SOL/);
        assert.equal(await page.locator('#analytics-detail .page-infographic-analytics, #analytics-detail .page-cleanup-guide[data-guide="analytics"]').count(), 0);
        const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
        assert(layout.document <= layout.viewport + 1, `${path}: ${width}px overflow ${JSON.stringify(layout)}`);
        results.push({ path, key, width, textOnly: true });
        await page.close();
        continue;
      }
      const guide = page.locator(key === 'docs-subtopic'
        ? '.page-cleanup-guide[data-guide="docs-subtopic"]:visible, .page-cleanup-guide[data-guide="docs"]:visible'
        : `.page-cleanup-guide[data-guide="${key}"]`).first();
      await guide.waitFor({ state: 'visible', timeout: 15000 });
      assert.equal(await guide.evaluate(element => element.open), false, `${path}: guide should start collapsed`);
      await guide.locator(':scope > summary').click();
      const poster = guide.locator('.page-infographic, .infographic-poster').first();
      await poster.waitFor({ state: 'visible', timeout: 15000 });
      const image = poster.locator('figure img, .infographic-poster-art img').first();
      await image.scrollIntoViewIfNeeded();
      const asset = await image.evaluate(img => new Promise((resolveImage, reject) => {
        const finish = () => img.naturalWidth > 1000
          ? resolveImage({ src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight })
          : reject(new Error('Poster image failed to load'));
        if (img.complete) return finish();
        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', () => reject(new Error('Poster image failed to load')), { once: true });
      }));
      assert(asset.src.endsWith(flowAssets[key] || '-labeled.webp'), `${path}: wrong image asset`);
      const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      assert(layout.document <= layout.viewport + 1, `${path}: ${width}px overflow ${JSON.stringify(layout)}`);
      results.push({ path, key, width, asset: asset.src.split('/').pop(), loaded: true });
      if (width === 390 && ['/#list', '/#docs/launch', '/#profile'].includes(path)) {
        await poster.scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(output, `${key}-mobile.png`), timeout: 12000 });
      }
      await page.close();
    }
    const leaderboard = await context.newPage();
    await leaderboard.setViewportSize({ width, height: 900 });
    await leaderboard.goto(`${base}/#leaderboard`, { waitUntil: 'domcontentloaded' });
    await leaderboard.waitForSelector('body.workspace-ready');
    assert.equal(await leaderboard.locator('[data-page-infographic="leaderboard"]').count(), 0, 'Leaderboard poster should be removed');
    await leaderboard.close();
    const launch = await context.newPage();
    await launch.setViewportSize({ width, height: 900 });
    await launch.goto(`${base}/#launch`, { waitUntil: 'commit' });
    await launch.waitForSelector('#launch-dialog #token-name');
    assert.equal(await launch.locator('[data-page-infographic="launch"]').count(), 0, 'Launch poster should be removed');
    await launch.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ label: 'read-only UI; no wallet transactions', results, errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ checked: results.length, errors, output }, null, 2));
