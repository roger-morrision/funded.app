import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const useLiveReceipts = process.env.UI_LIVE_RECEIPTS === '1';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const signature = '5En9wzM8veYo6ASv2QLpmSNcLYuYsP4fR3y2Y1WzcXNF';

try {
  for (const width of [390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
    if (!useLiveReceipts) await context.route('**/api/evidence/receipts', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        cluster: 'devnet',
        status: 'onchain-indexed',
        verifiedCollections: [],
        verifiedPayouts: [
          { to: '6XfCMmEJk5NTq2ANghqLh6oBfH3aKpR9eSzN', signature, amountLamports: 118812 },
          { to: '4J3yMC9wQs7UqPtyBHK4nD1fR6tEZv6A', signature: '2hRV9KyCNB1UKc8p9XjQm6oDkT3UQvL8S', amountLamports: 714 },
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
    await row.waitFor({ timeout: 20000 });
    const rowCount = await rows.count();
    if (useLiveReceipts) assert(rowCount > 0, 'expected a verified payout receipt');
    else assert.equal(rowCount, 2);
    assert.equal(await row.locator('.payment-history-identity strong').innerText(), 'SOL payout');
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
    await context.close();
  }
  console.log(`Payment history icon, receipt link, dialog copy, and 390/320px layout passed (${useLiveReceipts ? 'live indexed receipts' : 'mocked receipts'}).`);
} finally {
  await browser.close();
}
