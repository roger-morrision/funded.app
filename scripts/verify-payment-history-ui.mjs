import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const useLiveReceipts = process.env.UI_LIVE_RECEIPTS === '1';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const signature = '5En9wzM8veYo6ASv2QLpmSNcLYuYsP4fR3y2Y1WzcXNF';

try {
  for (const width of [1100, 742, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
    if (!useLiveReceipts) await context.route('**/api/evidence/payment-history', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        cluster: 'devnet',
        status: 'onchain-indexed',
        verifiedPayouts: [
          { to: '6XfCMmEJk5NTq2ANghqLh6oBfH3aKpR9eSzN', signature, amountLamports: 118812, actualReceivedLamports:118812, feeLamports:5000, feePayer:'7ngaVZdeipr6uZy2inh267PjZLLYFuAfsPoTRZixjJMk', blockTime:1791279900, source:'automatic-holder' },
          { to: '4J3yMC9wQs7UqPtyBHK4nD1fR6tEZv6A', signature: '2hRV9KyCNB1UKc8p9XjQm6oDkT3UQvL8S', amountLamports: 714, actualReceivedLamports:714, feeLamports:5000, feePayer:'7ngaVZdeipr6uZy2inh267PjZLLYFuAfsPoTRZixjJMk', blockTime:1791279800, source:'solana-keeper-referral-claim' },
          ...Array.from({ length:11 }, (_, index) => ({ to:'4J3yMC9wQs7UqPtyBHK4nD1fR6tEZv6A', signature:String(index + 3).repeat(88), amountLamports:1000 + index, actualReceivedLamports:1000 + index, feeLamports:5000, feePayer:'7ngaVZdeipr6uZy2inh267PjZLLYFuAfsPoTRZixjJMk', blockTime:1791279700 - index, source:'automatic-operations' })),
        ],
        coverage: {},
      }),
    }));
    await context.route('**/api/**', route => route.request().method() === 'GET'
      ? route.fallback()
      : route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }));
    const page = await context.newPage();
    await page.goto(`${base}/#payments`, { waitUntil: 'commit', timeout: 60000 });
    await page.waitForFunction(() => document.body?.dataset.bootstrapState === 'ready', null, { timeout: 60000 });
    await page.locator('body.workspace-ready').waitFor();
    await page.locator('[data-reward-open="history"]').click();
    assert(await page.locator('#rewards-history').isVisible(), 'Payment history panel must open');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `reward page overflows at ${width}px`);
    assert(await page.locator('#payments > .ui-tabs').evaluate(bar => {
      const active = bar.querySelector('[role="tab"][aria-selected="true"]');
      const bounds = bar.getBoundingClientRect();
      const tab = active?.getBoundingClientRect();
      return Boolean(tab && tab.left >= bounds.left - 1 && tab.right <= bounds.right + 1);
    }), `active reward tab is not visible at ${width}px`);
    const rows = page.locator('#payment-list .payment-history-row');
    const row = rows.first();
    await row.waitFor({ state: 'attached', timeout: 20000 });
    await row.waitFor({ state: 'visible' });
    if (process.env.UI_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.UI_SCREENSHOT_PREFIX}-${width}.png`, fullPage: true });
    const rowCount = await rows.count();
    if (useLiveReceipts) assert(rowCount > 0, 'expected a verified payout receipt');
    else assert.equal(rowCount, 13);
    if (!useLiveReceipts) assert.equal(await row.locator('.payment-history-identity strong').innerText(), 'Holder reward');
    else assert((await row.locator('.payment-history-identity strong').innerText()).trim(), 'Receipt type is missing');
    if (!useLiveReceipts) {
      assert.match(await row.locator('.payment-history-wallet').innerText(), /^6XfCMm…R9eSzN$/);
      assert((await row.locator('.payment-history-wallet').getAttribute('href')).includes('address/6XfCMmEJk5NTq2ANghqLh6oBfH3aKpR9eSzN'));
      assert.equal(await rows.nth(1).locator('.payment-history-identity strong').innerText(), 'Referral reward');
    }
    assert.equal(await row.getByRole('button', { name: /Copy receiver wallet/ }).count(), 1);
    if (!useLiveReceipts) {
      await row.getByRole('button', { name: /Copy receiver wallet/ }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '6XfCMmEJk5NTq2ANghqLh6oBfH3aKpR9eSzN');
    }
    if (!useLiveReceipts) {
      assert.match(await row.locator('.payment-amount').innerText(), /0\.000118812\s+SOL received/);
      assert.match(await row.locator('.payment-history-time').innerText(), /Paid .* UTC/);
      assert.equal(await row.locator('.payment-history-fee').isVisible(), false);
      await row.locator('.payment-history-details summary').click();
      assert.match(await row.locator('.payment-history-fee').innerText(), /Transaction fee 0.000005 SOL/);
      assert.match(await row.locator('.payment-history-details').innerText(), /Receiver 6XfCMmEJk5NTq2ANghqLh6oBfH3aKpR9eSzN/);
    }
    assert.equal(await row.getByText('Confirmed transaction').count(), 0);
    const link = row.getByRole('link', { name: /View confirmed payout transaction.*Solana Explorer/ });
    assert.equal(await link.count(), 1);
    if (!useLiveReceipts) assert((await link.getAttribute('href')).includes(signature));
    assert.equal(await link.locator('svg').count(), 1);
    assert(await rows.evaluateAll(elements => elements.every(element => {
      const identity = element.querySelector('.payment-history-identity').getBoundingClientRect();
      const actions = element.querySelector('.payment-history-actions').getBoundingClientRect();
      return element.scrollWidth <= element.clientWidth && (identity.bottom <= actions.top + 1 || identity.right <= actions.left + 1);
    })), `payment rows overflow or overlap at ${width}px`);
    assert.equal(await page.locator('#open-tape').count(), 0);
    if (!useLiveReceipts) {
      assert.equal(await rows.filter({ visible:true }).count(), 10);
      await page.getByRole('button', { name:'Next payment history page' }).click();
      assert.equal(await rows.filter({ visible:true }).count(), 3);
      await page.locator('#payment-history-type').selectOption('referral');
      assert.equal(await rows.count(), 1);
      assert.equal(await rows.first().locator('.payment-history-identity strong').innerText(), 'Referral reward');
      await page.locator('#payment-history-from').fill('2026-10-07');
      assert.match(await page.locator('#payment-list .empty-state').innerText(), /No confirmed payments match/);
      await page.locator('#payment-history-clear').click();
      assert.equal(await rows.count(), 13);
      assert.equal(await rows.filter({ visible:true }).count(), 10);
    }
    console.log(`Payment history checked at ${width}px`);
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
  console.log(`Payment history receiver, receipt link, copy, and 1100/742/390/320px layout passed (${useLiveReceipts ? 'live indexed receipts' : 'mocked receipts'}).`);
} finally {
  await browser.close();
}
