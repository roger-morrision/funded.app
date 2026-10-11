import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = process.env.UI_BASE_URL ? null : await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
if (server) await server.listen();
const base = process.env.UI_BASE_URL || server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
await context.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.abort());
const page = await context.newPage();
const routes = {
  overview: 'Home', explore: 'Explore', launch: 'Launch', 'my-launches': 'Portfolio', payments: 'Rewards',
  community: 'Portfolio', leaderboard: 'Explore', airdrops: 'Rewards', referrals: 'Rewards',
  profile: 'Portfolio', list: 'Launch', paid: 'Rewards', buybacks: 'Rewards',
  'capital-flow': null, 'analytics-detail': null, docs: null, privacy: null, pilot: 'Launch',
};
const labels = ['Home', 'Explore', 'Launch', 'Portfolio', 'Rewards'];

try {
  for (const width of [320, 390, 644]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(new URL('#overview', base).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.classList.contains('workspace-ready'));
    for (const [route, active] of Object.entries(routes)) {
      await page.evaluate(next => { location.hash = `#${next}`; }, route);
      await page.waitForFunction(next => location.hash === `#${next}` && document.body.classList.contains(`page-route-${next === 'pilot' ? 'launch' : next}`), route)
        .catch(error => { throw new Error(`${route} at ${width}px: ${error.message}`); });
      const state = await page.locator('.mobile-workspace-nav').evaluate(nav => {
        const box = nav.getBoundingClientRect();
        return {
          visible: getComputedStyle(nav).display === 'grid',
          columns: getComputedStyle(nav).gridTemplateColumns.split(' ').length,
          background: getComputedStyle(nav).backgroundColor,
          box: { left: box.left, right: box.right, bottom: box.bottom },
          links: [...nav.querySelectorAll('a')].map(link => {
            const rect = link.getBoundingClientRect();
            return { label: link.textContent.trim(), current: link.getAttribute('aria-current'),
              color: getComputedStyle(link).color, background: getComputedStyle(link).backgroundColor,
              left: rect.left, right: rect.right, bottom: rect.bottom };
          }),
        };
      });
      assert(state.visible, `${route} ${width}: menu hidden`);
      assert.equal(state.columns, 5, `${route} ${width}: column count`);
      assert.equal(state.background, 'rgb(17, 20, 38)', `${route} ${width}: menu background`);
      assert.deepEqual(state.links.map(link => link.label), labels, `${route} ${width}: menu labels`);
      assert.equal(state.links.find(link => link.current === 'page')?.label ?? null, active, `${route} ${width}: active item`);
      assert(state.box.left === 0 && state.box.right === width && Math.abs(state.box.bottom - 844) <= 1, `${route} ${width}: menu bounds ${JSON.stringify(state.box)}`);
      assert(state.links.every(link => link.left >= 0 && link.right <= width && link.bottom <= 844), `${route} ${width}: clipped item`);
      assert((await page.evaluate(() => document.documentElement.scrollWidth)) <= width, `${route} ${width}: horizontal overflow`);
      if (active) assert.equal(state.links.find(link => link.current === 'page')?.color, 'rgb(255, 189, 36)', `${route} ${width}: active color`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL('#overview', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('workspace-ready'));
  await page.locator('.mobile-workspace-nav a', { hasText: 'Launch' }).click();
  await page.waitForURL('**/#launch');
  assert.equal(await page.locator('.mobile-workspace-nav a[aria-current="page"]').textContent(), 'Launch');
  if (process.env.UI_EVIDENCE_FILE) await page.locator('.mobile-workspace-nav').screenshot({ path: process.env.UI_EVIDENCE_FILE });
  const address = '11111111111111111111111111111111';
  for (const [path, active] of [['/explore', 'Explore'], [`/token/${address}`, 'Explore'], [`/wallet/${address}`, 'Portfolio'], [`/launch/coin/${address}`, 'Launch']]) {
    await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.classList.contains('workspace-ready'));
    assert.equal((await page.locator('.mobile-workspace-nav a[aria-current="page"]').textContent()).trim(), active, `${path}: active item`);
    assert(await page.locator('.mobile-workspace-nav').isVisible(), `${path}: menu hidden`);
  }
  console.log(`Mobile navigation verified on ${Object.keys(routes).length} routes and four direct pages at 320, 390, and 644 px; link navigation passed.`);
} finally {
  await browser.close();
  await server?.close();
}
