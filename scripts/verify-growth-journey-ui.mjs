import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await preview({ preview:{ host:'127.0.0.1', port:5198, strictPort:true } });
const browser = await chromium.launch({ channel:'chrome', headless:true });
const context = await browser.newContext({ viewport:{ width:390, height:844 }, reducedMotion:'reduce' });
await context.addInitScript(() => {
  sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1');
  Object.defineProperty(navigator, 'share', { configurable:true, value:async payload => { window.__growthShare = payload; } });
});
await context.route('https://api.devnet.solana.com/**', async route => {
  let id = 1;
  try { id = route.request().postDataJSON()?.id || 1; } catch {}
  await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ jsonrpc:'2.0', id, result:null }) });
});
await context.route('**/api/**', route => route.fulfill({ status:503, contentType:'application/json', body:'{"error":"Read-only UI fixture"}' }));
await context.route('**/api/jackpots/status', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({
  cluster:'devnet', generatedAt:new Date().toISOString(),
  creator:{ id:'creator:fixture', fundedLamports:'0', history:[], payoutEnabled:false, windowEnd:Math.floor(Date.now()/1000)+3600 },
  trader:{ id:'trader:fixture', fundedLamports:'0', history:[], payoutEnabled:false, windowEnd:Math.floor(Date.now()/1000)+3600 },
}) }));
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:5198/#launch', { waitUntil:'domcontentloaded' });
  await page.locator('body.workspace-ready').waitFor();
  await page.locator('.launch-optional-story').waitFor({ state:'attached' });
  const order = await page.locator('#launch-form [data-launch-step="1"] #token-name, #launch-form [data-launch-step="1"] #token-symbol, #launch-form [data-launch-step="1"] #token-image, #launch-form [data-launch-step="1"] .launch-optional-story').evaluateAll(elements => elements.map(element => element.id || element.className));
  assert.deepEqual(order, ['token-name','token-symbol','token-image','launch-optional-story']);
  assert.equal(await page.locator('.launch-optional-story').getAttribute('open'), null);
  assert.equal(await page.locator('.launch-profile-grid').count(), 1);
  assert.equal(await page.locator('#launch-profile-fast').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.launch-preview-heading span').textContent(), 'LOCAL PREVIEW');
  assert.equal(await page.locator('#token-name').isVisible(), true);
  assert.equal(await page.locator('#token-symbol').isVisible(), true);
  assert.equal(await page.locator('#connect-button').textContent().then(text => text.includes('Connect wallet')), true);
  assert.deepEqual(await page.locator('.primary-nav > .nav-item').evaluateAll(items => items.slice(0, 2).map(item => item.textContent.trim())), ['Home', 'Explore']);
  assert.equal(await page.locator('#launch-advanced-options').getAttribute('open'), null);
  await page.locator('#token-name').fill('UI basic path');
  await page.locator('#token-symbol').fill('BASIC');
  await page.locator('#launch-next').click();
  assert.equal(await page.locator('#launch-dialog').getAttribute('data-step'), '2');
  await page.locator('#launch-advanced-options > summary').click();
  await page.getByRole('button', { name:'About Pro', exact:true }).click();
  assert.equal(await page.locator('.launch-tier-guide-dialog').evaluate(element => element.open), true);
  await page.locator('.launch-tier-guide-close').click();

  await page.goto('http://127.0.0.1:5198/#my-launches', { waitUntil:'domcontentloaded' });
  await page.locator('#my-launches').waitFor({ state:'visible' });
  assert.equal(await page.locator('[data-pilot-consent]').isVisible(), false, 'Wallet-only export must stay hidden while disconnected.');

  await page.goto('http://127.0.0.1:5198/#payments', { waitUntil:'domcontentloaded' });
  await page.locator('#payments').waitFor({ state:'visible' });
  assert.equal(await page.locator('#sol-claim-submit').isDisabled(), true);

  await page.goto('http://127.0.0.1:5198/#leaderboard', { waitUntil:'domcontentloaded' });
  await page.locator('#leaderboard-creators-tab').waitFor({ state:'visible' });
  assert.equal(await page.locator('#leaderboard-traders-tab').count(), 0);
  await page.locator('#leaderboard-burners-tab').focus();
  await page.keyboard.press('End');
  assert.equal(await page.locator('#leaderboard-creators-tab').getAttribute('aria-selected'), 'true');

  await page.goto('http://127.0.0.1:5198/#community', { waitUntil:'domcontentloaded' });
  await page.locator('body.workspace-ready').waitFor();
  await page.locator('#manage-alerts').click();
  assert.equal(await page.locator('[data-community-target="alerts"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-alert-toggle]').evaluate(element => document.activeElement === element), true);
  await page.locator('[data-community-target="watchlist"]').click();
  assert.equal(await page.locator('[data-community-target="watchlist"]').getAttribute('aria-pressed'), 'true');

  const mint = 'So11111111111111111111111111111111111111112';
  await page.goto(`http://127.0.0.1:5198/token/${mint}`, { waitUntil:'domcontentloaded' });
  await page.locator('body.workspace-ready').waitFor();
  await page.locator('#coin-page').waitFor({ state:'visible' });
  await page.locator('#coin-share-link').waitFor({ state:'visible' });
  await page.locator('#coin-share-link').click();
  await page.locator('#share-dialog').waitFor({ state:'visible' });
  await page.locator('#share-native').click();
  await page.waitForFunction(() => Boolean(window.__growthShare));
  const shared = await page.evaluate(() => window.__growthShare);
  assert.equal(shared.url, `http://127.0.0.1:5198/token/${mint}`);

  await page.setViewportSize({ width:1440, height:900 });
  await page.goto('http://127.0.0.1:5198/#community', { waitUntil:'domcontentloaded' });
  await page.locator('body.workspace-ready').waitFor();
  await page.locator('[data-community-target="alerts"]').click();
  assert.equal(await page.locator('[data-community-target="alerts"]').getAttribute('aria-pressed'), 'true');
  await page.goto(`http://127.0.0.1:5198/token/${mint}`, { waitUntil:'domcontentloaded' });
  await page.locator('body.workspace-ready').waitFor();
  await page.locator('#coin-page').waitFor({ state:'visible' });
  await page.locator('#coin-share-link').click();
  await page.locator('#share-dialog').waitFor({ state:'visible' });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable:true, value:undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:async value => { window.__growthCopy = value; } } });
  });
  await page.locator('#share-copy-link').click();
  await page.waitForFunction(() => Boolean(window.__growthCopy));
  assert.equal(await page.evaluate(() => window.__growthCopy), `http://127.0.0.1:5198/token/${mint}`);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Growth journey UI passed: browse-first launch, optional settings, disconnected portfolio and X claim gates, ranking tabs, alerts and sharing (read-only fixture).');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
