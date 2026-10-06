import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const useLiveReceipts = process.env.UI_LIVE_RECEIPTS === '1';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const signature = '5En9wzM8veYo6ASv2QLpmSNcLYuYsP4fR3y2Y1WzcXNF';

try {
  for (const width of [390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
    if (!useLiveReceipts) await context.route('**/api/evidence/receipts', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        cluster: 'devnet',
        status: 'onchain-indexed',
        verifiedCollections: [],
        verifiedPayouts: [
          { to: '6XfCMmEJk5NTq2ANghqLh6oBfH3aKpR9eSzN', signature, amountLamports: 118812, source:'mint-router-settle-mint' },
          { to: '4J3yMC9wQs7UqPtyBHK4nD1fR6tEZv6A', signature: '2hRV9KyCNB1UKc8p9XjQm6oDkT3UQvL8S', amountLamports: 714, source:'solana-keeper-referral-claim' },
        ],
        coverage: {},
      }),
    }));
    await context.route('**/api/**', route => route.request().method() === 'GET'
      ? route.fallback()
      : route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }));
    const page = await context.newPage();
    await page.goto(`${base}/#payments`, { waitUntil: 'domcontentloaded' });
    await page.locator('#rewards-x-tab').click();
    const rows = page.locator('#payment-list .payment-history-row');
    const row = rows.first();
    await row.waitFor({ state: 'attached', timeout: 20000 });
    // The X tab hides private reward activity until sign-in. This layout fixture
    // only reveals the already mocked receipts; it does not authenticate a user.
    await page.locator('#x-sign-in').evaluate(button => button.dataset.connected = 'true');
    await row.waitFor({ state: 'visible' });
    const rowCount = await rows.count();
    if (useLiveReceipts) assert(rowCount > 0, 'expected a verified payout receipt');
    else assert.equal(rowCount, 2);
    assert(['X account reward', 'Referral reward', 'SOL payout'].includes(await row.locator('.payment-history-identity strong').innerText()));
    if (!useLiveReceipts) {
      assert.equal(await row.locator('.payment-history-wallet').innerText(), '6XfCMmEJk5NTq2ANghqLh6oBfH3aKpR9eSzN');
      assert((await row.locator('.payment-history-wallet').getAttribute('href')).includes('address/6XfCMmEJk5NTq2ANghqLh6oBfH3aKpR9eSzN'));
      assert.equal(await rows.nth(1).locator('.payment-history-identity strong').innerText(), 'Referral reward');
    }
    assert.equal(await row.getByRole('button', { name: /Copy receiver wallet/ }).count(), 1);
    if (!useLiveReceipts) {
      await row.getByRole('button', { name: /Copy receiver wallet/ }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '6XfCMmEJk5NTq2ANghqLh6oBfH3aKpR9eSzN');
    }
    if (!useLiveReceipts) assert.equal(await row.locator('.payment-amount').innerText(), '0.000118812 SOL');
    assert.equal(await row.getByText('Confirmed transaction').count(), 0);
    const link = row.getByRole('link', { name: /View confirmed payout transaction.*Solana Explorer/ });
    assert.equal(await link.count(), 1);
    if (!useLiveReceipts) assert((await link.getAttribute('href')).includes(signature));
    assert.equal(await link.locator('svg').count(), 1);
    assert(await rows.evaluateAll(elements => elements.every(element => {
      const identity = element.querySelector('.payment-history-identity').getBoundingClientRect();
      const actions = element.querySelector('.payment-history-actions').getBoundingClientRect();
      return element.scrollWidth <= element.clientWidth && identity.right <= actions.left + 1;
    })), `payment rows overflow or overlap at ${width}px`);
    await page.locator('#open-tape').click();
    assert.equal(await page.locator('#payment-dialog-list .payment-receipt-link').count(), rowCount);
    assert.equal(await page.locator('#payment-dialog-list .payment-history-wallet').count(), rowCount);
    await context.close();
  }
  if (!useLiveReceipts) {
    const context = await browser.newContext();
    await context.route('**/api/creators/receiver-test/receipts*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ cluster: 'devnet', commitment: 'finalized', status: 'onchain-indexed', checkedPayouts: 1,
        receipts: [{ signature: '1'.repeat(88), slot: 50, amountLamports: '118812', recipient: '6XfCMmEJk5NTq2ANghqLh6oBfH3aKpR9eSzN' }] }),
    }));
    const page = await context.newPage();
    await page.goto(`${base}/#docs`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const { mountReceiptHistory } = await import('/receipt-history-ui.js');
      const panel = document.createElement('section');
      panel.id = 'receiver-history-test';
      document.querySelector('#docs').append(panel);
      mountReceiptHistory(panel, 'receiver-test', 'devnet');
    });
    await page.locator('#receiver-history-test [data-history-next]').click();
    const receiver = page.locator('#receiver-history-test .receipt-history-receiver');
    try { await receiver.waitFor({ state: 'attached', timeout: 10000 }); }
    catch (error) { throw new Error(`${error.message}; history status: ${await page.locator('#receiver-history-test [data-history-status]').textContent()}`); }
    assert((await receiver.textContent()).includes('Receiver: 6XfCMmEJk5NTq2ANghqLh6oBfH3aKpR9eSzN'));
    assert((await receiver.locator('a').getAttribute('href')).includes('/address/6XfCMmEJk5NTq2ANghqLh6oBfH3aKpR9eSzN'));
    await context.close();
  }
  console.log(`Payment history receiver, receipt link, copy, and 390/320px layout passed (${useLiveReceipts ? 'live indexed receipts' : 'mocked receipts'}).`);
} finally {
  await browser.close();
}
