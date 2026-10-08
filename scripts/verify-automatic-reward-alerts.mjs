import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:4177';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const mint = '9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
const wallet = '9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w';
const key = 'funded.vip.reward-alerts.v1';
const bundle = (await readdir(new URL('../dist/assets/', import.meta.url))).find(name => /^reward-experience-ui-.*\.js$/.test(name));
assert(bundle, 'Build the app before running this check.');
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'mocked offline API' } }));
  await page.goto(`${base}/#community`);
  await page.locator('body.workspace-ready').waitFor();
  assert.equal(await page.locator('#community-reward-reserve, #reward-alerts, #manage-alerts, [data-alert-toggle], .concise-community-reserve').count(), 0);
  assert.equal(await page.locator('#followed-wallets').isVisible(), true);
  assert.deepEqual(errors, []);

  // Isolate the notification module from real wallet providers and authentication.
  let events = [{ mint, kind: 'holder-paid', signature: 'mocked-receipt-1', label: 'Verified holder payment', feeSourceVerified: true, at: '2026-10-08T12:00:00Z' }];
  await page.route('**/api/rewards/experience*', route => route.fulfill({ json: {
    evidence: { status: 'onchain-indexed' }, events: new URL(route.request().url()).searchParams.has('mint') ? [] : events,
  } }));
  await page.route(`**/token/${mint}`, route => route.fulfill({ contentType: 'text/html', body:
    `<html><body><section id="community"></section><button id="x-sign-in"></button><div id="notification-dialog"><h2>Notifications</h2><div class="notice-list"></div></div><script type="module">import '/assets/${bundle}';</script></body></html>` }));
  await page.evaluate(({ mint, key }) => {
    localStorage.setItem('funded.app.community.watchlist', JSON.stringify([mint]));
    localStorage.setItem(key, JSON.stringify({ enabled: false, seen: [], notices: [] }));
  }, { mint, key });
  await page.goto(`${base}/token/${mint}`);
  await page.waitForFunction(() => document.querySelector('.notice-list').textContent.includes('Sign in'));
  const identity = async (walletAddress, x = false) => page.evaluate(({ walletAddress, x }) => {
    document.documentElement.dataset.connectedWallet = walletAddress;
    document.querySelector('#x-sign-in').dataset.connected = String(x);
    window.dispatchEvent(new Event('funded:reward-identity-change'));
  }, { walletAddress, x });
  await identity(wallet);
  await page.waitForFunction(() => document.querySelector('.notice-list').textContent.includes('Verified holder payment'));
  assert.equal(await page.locator('.notice-list > div').count(), 1);
  await identity('');
  await page.waitForFunction(() => document.querySelector('.notice-list').textContent.includes('Sign in'));
  events.push({ ...events[0], signature: 'mocked-receipt-2', at: '2026-10-09T12:00:00Z' });
  await identity('', true);
  await page.waitForFunction(() => document.querySelectorAll('.notice-list > div').length === 2);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.notice-list').textContent.includes('Sign in'));
  await identity(wallet);
  await page.waitForFunction(() => document.querySelectorAll('.notice-list > div').length === 2);
  // A full successful refresh retains two receipts, including on a token route.
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).seen.length === 2, key);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).notices.length, key), 2);
  assert.deepEqual(errors, []);
  console.log('PASS: panels removed; automatic wallet/X alerts, signed-out clearing, token-route coverage and reload deduplication (mocked API).');
} finally {
  await browser.close();
}
