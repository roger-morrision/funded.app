import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }), headless: true });
const claims = [
  { id: 'paid-fixture', mint: '11111111111111111111111111111111', amountSol: 0.1, receiptVerified: true, payoutWallet: 'fixture-wallet', payoutSignature: 'synthetic-receipt', canPrepare: false },
  { id: 'pending-fixture', mint: '11111111111111111111111111111111', amountSol: 0.2, status: 'automatic-pending', canPrepare: false },
  { id: 'ready-fixture', mint: '11111111111111111111111111111111', amountSol: 0.3, canPrepare: true },
];
const json = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    let signedIn = true, mode = 'mixed';
    const errors = [], claimWrites = [];
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/api/sol-claims/')) claimWrites.push(path);
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Mocked unavailable API"}' });
    });
    await context.route('**/api/x/me', route => route.fulfill(json({ configured: true, authenticated: signedIn, user: signedIn ? { id: 'synthetic-x', username: 'fixture' } : null })));
    await context.route('**/api/x-fee/claims', route => mode === 'unavailable'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic rewards outage"}' })
      : route.fulfill(json({ handle: '@fixture', claims: mode === 'paid' ? [claims[0]] : mode === 'empty' ? [] : claims })));
    await context.route('**/api/x/logout', route => { signedIn = false; return route.fulfill(json({ ok: true })); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const openClaims = async () => {
      if (page.url() === `${base}/#payments`) await page.reload({ waitUntil: 'domcontentloaded' });
      else await page.goto(`${base}/#payments`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.body.classList.contains('workspace-ready'));
      await page.getByRole('tab', { name: 'X claims', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#x-sign-in')?.dataset.connected === 'true');
    };
    await openClaims();
    await page.locator('#sol-claim-list [data-claim-id="ready-fixture"]').waitFor();
    assert.equal(await page.locator('#x-claim-unclaimed-value').textContent(), '0.3 SOL');
    assert.equal(await page.locator('#x-claim-pending-value').textContent(), '0.2 SOL');
    assert.equal(await page.locator('#x-claim-claimed-value').textContent(), '0.1 SOL');
    assert.deepEqual(await page.locator('#sol-claim-list [data-claim-id]').evaluateAll(rows => rows.map(row => row.dataset.claimId)), ['ready-fixture', 'pending-fixture', 'paid-fixture']);
    await page.getByRole('button', { name: 'Select reward', exact: true }).click();
    assert.equal(await page.locator('#sol-claim-id').inputValue(), 'ready-fixture');
    assert.equal(await page.locator('#sol-claim-submit').textContent(), 'Connect wallet to continue');
    assert(await page.locator('#claim-binding-agree').isDisabled());
    assert.match(await page.locator('#selected-claim-summary').textContent(), /0.3 SOL/);
    await page.getByRole('button', { name: 'Sign out of X', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#x-sign-in')?.dataset.connected === 'false');
    assert.equal(await page.locator('#sol-claim-id').inputValue(), '');
    assert(await page.locator('#sol-claim-submit').isHidden());
    assert.equal(await page.locator('#x-claim-claimed-value').textContent(), '—');
    signedIn = true;
    for (mode of ['paid', 'empty', 'unavailable']) {
      await openClaims();
      if (mode === 'paid') {
        await page.locator('#sol-claim-list [data-claim-id="paid-fixture"]').waitFor();
        assert.equal(await page.locator('#sol-claim-list button').count(), 0);
        assert.equal(await page.locator('#sol-claim-list .payment-receipt-link').count(), 1);
      } else {
        await page.waitForFunction(() => /No collected creator fees|Synthetic rewards outage/.test(document.querySelector('#sol-claim-list')?.textContent));
        assert.match(await page.locator('#sol-claim-list').textContent(), mode === 'empty' ? /No collected creator fees/ : /Synthetic rewards outage/);
      }
      assert(await page.locator('#sol-claim-submit').isHidden());
    }
    assert.deepEqual(claimWrites, [], 'Review and sign-out must never send a claim transaction');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    await context.close();
    console.log(`X rewards UI passed at ${width}px: totals, selection, wallet gate, sign-out, paid/empty/unavailable states (mocked APIs, no signing).`);
  }
} finally { await browser.close(); }
