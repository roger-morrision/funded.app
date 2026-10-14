import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const targetHandle = process.env.X_TEST_HANDLE || '@fixture';
const targetWallet = process.env.X_TEST_WALLET || 'fixture-wallet';
const targetMint = process.env.X_TEST_MINT || '11111111111111111111111111111111';
const targetPaidSol = Number(process.env.X_TEST_PAID_LAMPORTS || 100000000) / 1e9;
const targetReceipt = process.env.X_TEST_PAYOUT_SIGNATURE || 'synthetic-receipt';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }), headless: true });
const claims = [
  { id: 'paid-fixture', scope:'per-mint-v3', mint: targetMint, amountSol: targetPaidSol, status:'paid', receiptVerified: true, payoutWallet: targetWallet, payoutSignature: targetReceipt, canPrepare: false },
  { id: 'pending-fixture', scope:'per-mint-v3', mint: targetMint, amountSol: 0.2, status: 'funding-pending', canPrepare: false },
  { id: 'ready-fixture', scope:'per-mint-v3', mint: targetMint, amountSol: 0.3, status:'ready', canPrepare: true },
  { id: 'creator-fixture', scope:'per-mint-v3', mint: targetMint, amountSol: 0.05, status: 'automatic-awaiting-creator-signature', canPrepare: false },
];
const json = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    let signedIn = true, mode = 'mixed';
    const errors = [], claimWrites = [];
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/api/sol-claims/') || path.includes('/v3-x-claim/')) claimWrites.push(path);
      if (route.request().method() === 'GET') return route.continue();
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Browser QA blocks writes"}' });
    });
    await context.route('**/api/x/me', route => route.fulfill(json({ configured: true, authenticated: signedIn, user: signedIn ? { id: 'synthetic-x', username: targetHandle.slice(1) } : null })));
    await context.route('**/api/x-fee/claims', route => mode === 'unavailable'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic rewards outage"}' })
      : route.fulfill(json({ handle: targetHandle, claims: mode === 'paid' ? [claims[0]] : mode === 'creator' ? [claims[3]] : mode === 'empty' ? [] : claims })));
    await context.route('**/api/x/logout', route => { signedIn = false; return route.fulfill(json({ ok: true })); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const openClaims = async () => {
      if (page.url() === `${base}/#payments`) await page.reload({ waitUntil: 'domcontentloaded' });
      else await page.goto(`${base}/#payments`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.body.classList.contains('workspace-ready'), null, { timeout:60000 });
      await page.getByRole('tab', { name: 'X claims', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#x-sign-in')?.dataset.connected === 'true');
    };
    await openClaims();
    await page.locator('#sol-claim-list [data-claim-id="ready-fixture"]').waitFor();
    assert.equal(await page.locator('#x-claim-unclaimed-value').textContent(), '0.3 SOL');
    assert.equal(await page.locator('#x-claim-pending-value').textContent(), '0.25 SOL');
    assert.equal(await page.locator('#x-claim-claimed-value').textContent(), `${targetPaidSol} SOL`);
    assert.deepEqual(await page.locator('#sol-claim-list [data-claim-id]').evaluateAll(rows => rows.map(row => row.dataset.claimId)), ['pending-fixture', 'ready-fixture', 'creator-fixture', 'paid-fixture']);
    assert.equal(await page.locator('#sol-claim-list button').count(), 1);
    assert(await page.locator('#sol-claim-submit').isHidden());
    assert.match(await page.locator('#sol-claim-status').textContent(), /Select a funded V3 reward/);
    await page.locator('#sol-claim-list [data-claim-id="ready-fixture"] button').click();
    assert.equal(await page.locator('#sol-claim-id').inputValue(), 'ready-fixture');
    assert(await page.locator('#sol-claim-submit').isVisible());
    assert(await page.locator('#sol-claim-submit').isDisabled());
    await page.getByRole('button', { name: 'Sign out of X', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#x-sign-in')?.dataset.connected === 'false');
    assert.equal(await page.locator('#sol-claim-id').inputValue(), '');
    assert(await page.locator('#sol-claim-submit').isHidden());
    assert.equal(await page.locator('#x-claim-claimed-value').textContent(), '—');
    signedIn = true;
    for (mode of ['creator', 'paid', 'empty', 'unavailable']) {
      await openClaims();
      if (mode === 'creator') {
        const row=page.locator('#sol-claim-list [data-claim-id="creator-fixture"]');
        await row.waitFor();
        assert.match(await row.textContent(), /Verify to claim/);
        assert.equal(await row.locator('button').count(), 0);
        assert.match(await page.locator('#sol-claim-status').textContent(), /No funded V3 X reward is ready/);
      } else if (mode === 'paid') {
        await page.locator('#sol-claim-list [data-claim-id="paid-fixture"]').waitFor();
        assert.equal(await page.locator('#sol-claim-list button').count(), 0);
        assert.equal(await page.locator('#sol-claim-list .payment-receipt-link').count(), 1);
        assert.match(await page.locator('#sol-claim-list [data-claim-id="paid-fixture"]').textContent(), new RegExp(targetWallet));
      } else {
        await page.waitForFunction(() => /No funded X rewards|Synthetic rewards outage/.test(document.querySelector('#sol-claim-list')?.textContent))
          .catch(async error => { throw new Error(`${mode}: ${await page.locator('#sol-claim-list').textContent()} (${error.message})`); });
        assert.match(await page.locator('#sol-claim-list').textContent(), mode === 'empty' ? /No funded X rewards/ : /Synthetic rewards outage/);
      }
      assert(await page.locator('#sol-claim-submit').isHidden());
    }
    assert.deepEqual(claimWrites, [], 'Review and sign-out must never send a claim transaction');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    await context.close();
    console.log(`V3 X rewards UI passed at ${width}px: reward selection, wallet gate, sign-out, paid/empty/unavailable states (mocked APIs, no signing).`);
  }
} finally { await browser.close(); }
