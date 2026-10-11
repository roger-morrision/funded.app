import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preview } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await preview({ configLoader: 'runner', preview: { host: '127.0.0.1', port: 5219, strictPort: true } });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ reducedMotion: 'reduce' });
await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
let automaticFailuresRemaining = 0;
await context.route('**/api/**', route => {
  const automatic = route.request().url().endsWith('/api/rewards/automatic');
  if (automatic && automaticFailuresRemaining > 0) {
    automaticFailuresRemaining--;
    return route.fulfill({ status:503, contentType:'application/json', body:'{}' });
  }
  return route.fulfill(automatic
    ? { status: 200, contentType: 'application/json', body: JSON.stringify({ status:'unavailable', serverTime:new Date().toISOString(), retryNotBefore:new Date(Date.now() + 15 * 60_000).toISOString(), schedules:[], reason:'The last reward-worker check failed because the Devnet RPC quota was exhausted.' }) }
    : { status: 503, contentType: 'application/json', body: '{}' });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));

async function open(route, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`http://127.0.0.1:5219/#${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(expected => document.body.classList.contains(`page-route-${expected}`) && document.body.classList.contains('workspace-ready'), route);
  await page.waitForFunction(() => document.querySelector('.page-cleanup-home-tiers'));
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert(dimensions.document <= dimensions.viewport + 1, `${route}: horizontal overflow ${JSON.stringify(dimensions)}`);
}

try {
  await open('payments', 1280);
  assert((await page.locator('#reward-portfolio').boundingBox()).y < 500);
  const upcomingGuide = page.locator('#rewards-overview details.product-details:has(.reward-upcoming)');
  assert(await upcomingGuide.locator('summary').isVisible());
  assert.equal(await upcomingGuide.evaluate(element => element.open), false);
  await upcomingGuide.locator('summary').click();
  assert(await upcomingGuide.locator('.reward-upcoming').isVisible());
  await page.locator('#rewards-holder-tab').click();
  const rewardGuide = page.locator('#rewards-holder .page-cleanup-guide[data-guide="holder"]');
  await rewardGuide.waitFor({ state: 'visible' });
  assert.equal(await rewardGuide.evaluate(element => element.open), false);
  await rewardGuide.locator(':scope > summary').click();
  assert(await rewardGuide.locator('figure img').evaluate(image => image.getAttribute('src').endsWith('.webp')));
  assert.equal(await rewardGuide.evaluate(element => element.open), true);

  await open('airdrops', 1280);
  assert(await page.locator('#airdrops').evaluate(root => {
    const list = root.querySelector('.airdrop-public-programs');
    const gate = root.querySelector('.airdrop-hero-layout');
    return Boolean(list && gate && (gate.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING));
  }));
  assert((await page.locator('.airdrop-hero-layout').boundingBox()).y < 400);

  await open('explore', 1280);
  assert.equal(await page.locator('.explore-quick-filters').isVisible(), false);
  assert(await page.locator('#explore').evaluate(root => {
    const results = root.querySelector('#asset-grid');
    const extras = root.querySelector('.explore-benefit-leaders');
    return Boolean(results && extras && (results.compareDocumentPosition(extras) & Node.DOCUMENT_POSITION_FOLLOWING));
  }));
  await page.locator('#explore-filter-toggle').click();
  assert(await page.locator('#explore-filter-popover').isVisible());
  assert(await page.locator('#explore-min-cap-sol').isVisible());

  await open('overview', 1280);
  assert((await page.locator('.hero-section').boundingBox()).height < 420);
  assert.equal(await page.locator('.home-launch-tabs button:visible').count(), 5);
  await page.locator('.home-feed-settings > summary').click();
  await page.locator('[data-home-tier-shortcut="boost"]').click();
  assert.equal(await page.locator('.home-launch-tabs [aria-selected="true"]').getAttribute('data-home-launch-tab'), 'boost');
  assert(await page.locator('.page-cleanup-selected-tier').isVisible());
  assert.equal(await page.locator('.preview-status-drawer').evaluate(element => getComputedStyle(element).position), 'static');

  await open('buybacks', 1280);
  assert((await page.locator('#buybacks .burn-center-layout').boundingBox()).y < 650);
  assert.equal(await page.locator('#buybacks .page-cleanup-guide[data-guide="burn"]').evaluate(element => element.open), false);

  await open('analytics-detail', 1280);
  assert(await page.locator('#analytics-detail .analytics-fee-explainer').isVisible());
  assert.equal(await page.locator('#analytics-detail .page-cleanup-guide[data-guide="analytics"], #analytics-detail .page-infographic-analytics').count(), 0);

  await open('capital-flow', 1280);
  assert(await page.locator('#capital-flow .page-cleanup-guide[data-guide="capital"]').isVisible());

  for (const route of ['overview', 'explore', 'airdrops', 'payments', 'buybacks', 'my-launches', 'community', 'docs']) {
    await open(route, 390);
    assert.equal(await page.locator('.help-topics-trigger').isVisible(), false, `${route}: floating Help should not cover mobile content`);
  }

  await open('explore', 390);
  await page.waitForFunction(() => /unavailable/i.test(document.querySelector('#scanner-count')?.textContent || ''));
  const outageCopy = await page.evaluate(() => ({
    card:[document.querySelector('#asset-grid .empty-state strong')?.textContent, document.querySelector('#asset-grid .empty-state span')?.textContent],
    table:[document.querySelector('#launch-list .empty-state strong')?.textContent, document.querySelector('#launch-list .empty-state span')?.textContent],
  }));
  assert.deepEqual(outageCopy.card, outageCopy.table);
  assert.equal(await page.locator('#scanner-count').innerText(), outageCopy.card[0]);
  assert.match(outageCopy.card.join(' '), /temporarily unavailable|verification unavailable/i);
  assert.match(await page.locator('.explore-hero').evaluate(element => getComputedStyle(element).backgroundImage), /linear-gradient/);

  await open('launch', 390);
  const header = await page.evaluate(() => {
    const title = document.querySelector('.topbar-context span').getBoundingClientRect();
    const network = document.querySelector('.topbar .workspace-network').getBoundingClientRect();
    return { titleRight:title.right, titleBottom:title.bottom, networkLeft:network.left, networkTop:network.top };
  });
  assert(header.networkTop >= header.titleBottom || header.networkLeft >= header.titleRight + 8, `Mobile header overlaps the Devnet badge: ${JSON.stringify(header)}`);

  automaticFailuresRemaining = 1;
  await open('payments', 390);
  await page.locator('#rewards-holder-tab').click();
  const holderStatus = page.locator('#rewards-holder [data-auto-status]');
  await holderStatus.waitFor({ state:'visible' });
  await page.waitForFunction(() => document.querySelector('#rewards-holder [data-auto-status]')?.textContent.includes('Devnet RPC quota was exhausted'));
  assert.match(await holderStatus.innerText(), /Earliest worker retry:.*your time/);
  assert.equal(await page.locator('#rewards-holder .auto-rewards-grid').isVisible(), false);

  const png = await stat(resolve('public/posters/fee-distribution-flow-v1.png'));
  const webp = await stat(resolve('public/posters/fee-distribution-flow-v1.webp'));
  assert(webp.size < png.size / 2, 'Fee poster should load the smaller WebP asset');
  assert.deepEqual(errors, []);
  console.log('Page cleanup passed: task-first routes, filter shortcuts, disclosures, responsive layout, and optimized poster asset.');
} finally {
  await browser.close();
  await new Promise(resolveServer => server.httpServer.close(resolveServer));
}
