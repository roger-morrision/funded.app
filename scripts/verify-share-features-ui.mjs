import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await preview({ preview:{ host:'127.0.0.1', port:5197, strictPort:true } });
const browser = await chromium.launch({ channel:'chrome', headless:true });
const context = await browser.newContext({ viewport:{ width:390, height:844 }, reducedMotion:'reduce' });
const visits = [];
await context.addInitScript(() => {
  sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1');
  window.__shareOpens = [];
  window.open = url => { window.__shareOpens.push(url); return null; };
  Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:async value => { window.__shareCopied = value; } } });
});
await context.route('https://api.devnet.solana.com/**', async route => {
  let id = 1;
  try { id = route.request().postDataJSON()?.id || 1; } catch {}
  await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ jsonrpc:'2.0', id, result:null }) });
});
await context.route('**/api/**', route => route.fulfill({ status:503, contentType:'application/json', body:'{"error":"Read-only UI fixture"}' }));
await context.route('**/api/shares/visit', async route => {
  visits.push(route.request().postDataJSON());
  await route.fulfill({ status:202, contentType:'application/json', body:'{"recorded":true,"scope":"consented-browser-day"}' });
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
try {
  const mint = 'So11111111111111111111111111111111111111112';
  const buy = '1'.repeat(64), sell = '2'.repeat(64);
  await page.goto(`http://127.0.0.1:5197/token/${mint}?ref=FND-12345678&src=x&buy=${buy}&sell=${sell}`, { waitUntil:'domcontentloaded' });
  await page.locator('body.workspace-ready').waitFor();
  const shared = page.locator('#shared-coin-callout');
  await shared.waitFor({ state:'visible' });
  assert.equal(await shared.getByText('Check the shared closed trade').isVisible(), true);
  assert.equal(await shared.getByText('Open buy receipt').getAttribute('href').then(value => value.includes(buy)), true);
  assert.equal(await shared.getByText('Open sell receipt').getAttribute('href').then(value => value.includes(sell)), true);
  await shared.locator('input[type="checkbox"]').check();
  for (let attempt = 0; visits.length === 0 && attempt < 20; attempt += 1) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(visits.length, 1);
  assert.equal(visits[0].code, 'FND-12345678');
  assert.equal(visits[0].source, 'x');
  assert.match(visits[0].visitorId, /^[0-9a-f-]{36}$/);
  assert.equal(await page.locator('#share-visit-consent').isChecked(), true);

  await shared.getByRole('button', { name:'Verify closed trade result' }).click();
  await shared.getByText('Unable to verify this result:', { exact:false }).waitFor();
  assert.match(await shared.textContent(), /Unable to verify this result:/);

  await page.locator('#coin-share-link').click();
  await page.locator('#share-dialog').waitFor({ state:'visible' });
  assert.equal(await page.locator('#share-result-options').isVisible(), false);
  await page.locator('#share-copy-link').click();
  assert.equal(await page.evaluate(() => window.__shareCopied), `http://127.0.0.1:5197/token/${mint}`);
  await page.locator('[data-share-channel="x"]').click();
  const destination = await page.evaluate(() => window.__shareOpens.at(-1));
  assert.match(decodeURIComponent(destination), /src=x/);
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  console.log('Share UI passed: receipts, consent, X tagging, copy, and unavailable-proof state (read-only fixture).');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
