import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const loading = 'Checking finalized payout receipts.';
const unavailable = 'Payment history is temporarily unavailable.';
const incomplete = 'Verification coverage is incomplete. Confirmed payments are not available in this response.';
const empty = 'No confirmed payments are available to show yet.';
const data = (status, rows = [], coverage = status === 'partial' ? 'partial' : 'verified') => ({ cluster: 'devnet', status, generatedAt: '2026-10-21T00:00:00Z', checkedAutomatic: rows.length, verifiedPayouts: rows, payoutCoverage: { status: coverage, recorded: status === 'partial' ? 110 : rows.length, verified: rows.length } });
const receipts = [
  { source: 'v3-creator-wallet', to: '8'.repeat(44), signature: '3'.repeat(88), amountLamports: 1000000001, actualReceivedLamports: 999993001, feeLamports: 5000, recipientRentLamports: 2000, feePayer: '8'.repeat(44), blockTime: 1792454400, slot: 512479000 },
  { source: 'automatic-holder', to: '9'.repeat(44), signature: '4'.repeat(88), amountLamports: 200001, actualReceivedLamports: 200001, feeLamports: 5000, feePayer: '7'.repeat(44), blockTime: 1792454460, slot: 512479001 },
];
async function fixture(page, { held = false, history = null } = {}) {
  let release, requests = 0, completed = 0; const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://**/*', r => r.abort());
  await page.route('**/api/**', r => {
    const q = r.request(), path = new URL(q.url()).pathname;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(q.method()) && path !== '/api/solana/rpc') writes.push({ method: q.method(), path });
    return r.fulfill({ status: 503, json: { error: 'Offline history state fixture' } });
  });
  await page.route('**/api/fee-policy', r => r.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
  await page.route('**/api/evidence/payment-history', async r => {
    requests++; if (held) await new Promise(resolve => { release = resolve; });
    await (history ? r.fulfill({ json: history }) : r.fulfill({ status: 503, json: { error: 'History unavailable fixture' } })); completed++;
  });
  return { errors, writes, requests: () => requests, completed: () => completed, set: next => { history = next; }, release: async next => { await expect.poll(() => Boolean(release)).toBe(true); history = next; held = false; release(); } };
}
async function ready(page, width) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
  await page.goto('/#payments'); await page.locator('body.workspace-ready.product-experience-ready').waitFor();
  await page.locator('[data-reward-open="history"]').click(); await expect(page.locator('#payment-list')).toBeVisible();
}
const list = page => page.locator('#payment-list');
const note = page => page.locator('#payment-history-footnote');
async function state(page, message, caption) {
  await expect(list(page).locator('.empty-state')).toHaveText(message); await expect(note(page)).toHaveText(caption);
  const ax = await list(page).ariaSnapshot(); expect(ax).toContain(message);
  expect(await list(page).locator('[role="status"], [aria-live], [tabindex="0"]').count()).toBe(0);
}
async function refresh(page, f, history) {
  const before = f.requests(); f.set(history);
  // Existing route-read callback; no new production endpoint, poll, hook or timer.
  await page.evaluate(() => window.dispatchEvent(new Event('funded:route-change')));
  await expect.poll(() => f.requests()).toBe(before + 1); await expect.poll(() => f.completed()).toBe(before + 1);
}
async function rows(page) {
  return list(page).locator('.payment-history-row').evaluateAll(es => es.map(e => ({ text: e.textContent, details: e.querySelector('details').dataset.receiptKey, wallet: e.querySelector('.payment-history-wallet').getAttribute('href'), transaction: e.querySelector('.payment-receipt-link').getAttribute('href'), transactionLabel: e.querySelector('.payment-receipt-link').getAttribute('aria-label') })));
}
for (const width of [360, 390, 1440]) {
  test(`Rewards History pending read stays loading through native filter and Clear at ${width}px`, async ({ page }, info) => {
    const f = await fixture(page, { held: true }); await ready(page, width); await expect.poll(() => f.requests()).toBe(1);
    await state(page, loading, 'Waiting for the current payment history check to finish.'); expect(f.completed()).toBe(0);
    await expect(list(page)).not.toContainText(/No confirmed payments|unavailable|could not/i);
    await note(page).evaluate(e => { window.historyCaptionChanges = 0; new MutationObserver(records => { window.historyCaptionChanges += records.length; }).observe(e, { childList: true, subtree: true, characterData: true }); });
    await page.locator('#payment-history-type').selectOption('holder'); await state(page, loading, 'Waiting for the current payment history check to finish.');
    const clear = page.locator('#payment-history-clear'); await clear.focus(); await page.keyboard.press('Enter'); await expect(clear).toBeFocused(); await expect(page.locator('#payment-history-type')).toHaveValue('all');
    await state(page, loading, 'Waiting for the current payment history check to finish.'); expect(f.requests()).toBe(1); expect(f.completed()).toBe(0);
    expect(await page.evaluate(() => window.historyCaptionChanges)).toBe(0);
    await page.screenshot({ path: info.outputPath(`pending-${width}.png`) });
    await f.release(data('onchain-indexed')); await state(page, empty, 'No confirmed payments are available.'); await expect(clear).toBeFocused();
    expect(f.requests()).toBe(1); expect(f.completed()).toBe(1); await expect(note(page)).not.toContainText(/Checking|could not/i);
    expect(await page.evaluate(() => window.historyCaptionChanges)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); expect(f.errors).toEqual([]); expect(f.writes).toEqual([]);
  });
  test(`Rewards History unavailable, partial and verified rows retain truthful coverage at ${width}px`, async ({ page }, info) => {
    const f = await fixture(page); await ready(page, width);
    await state(page, unavailable, 'Payment history could not be fully checked. Try again shortly.');
    const clear = page.locator('#payment-history-clear'); await clear.focus();
    await refresh(page, f, data('onchain-indexed')); await state(page, empty, 'No confirmed payments are available.'); await expect(clear).toBeFocused();
    await refresh(page, f, data('partial')); await state(page, incomplete, 'Available history is incomplete. No confirmed payments are available in this response.');
    await refresh(page, f, data('onchain-indexed', [], 'partial')); await state(page, incomplete, 'Available history is incomplete. No confirmed payments are available in this response.');
    for (const malformed of [data('unavailable'), data('unknown'), { ...data('onchain-indexed'), payoutCoverage: null }]) { await refresh(page, f, malformed); await state(page, unavailable, 'Payment history could not be fully checked. Try again shortly.'); }
    await refresh(page, f, data('onchain-indexed', receipts)); await expect(list(page).locator('.payment-history-row')).toHaveCount(2); await expect(note(page)).toHaveText('2 of 2 confirmed payments · fees in details');
    const complete = await rows(page); expect(complete.map(x => x.wallet)).toEqual(receipts.map(r => `https://explorer.solana.com/address/${r.to}?cluster=devnet`)); expect(complete.map(x => x.transaction)).toEqual(receipts.map(r => `https://explorer.solana.com/tx/${r.signature}?cluster=devnet`));
    expect(complete[0].text).toContain('Gross payout 1.000000001 SOL'); expect(complete[0].text).toContain('0.999993001'); expect(complete[0].text).toContain('Transaction fee 0.000005 SOL · paid by receiver'); expect(complete[0].text).toContain('Payment account rent 0.000002 SOL · paid by receiver'); expect(complete[0].text).toContain('Paid Oct 20, 2026, 00:00 UTC');
    const summary = list(page).locator('summary').first(); await summary.focus(); await page.keyboard.press('Enter'); await expect(summary.locator('..')).toHaveAttribute('open', '');
    await refresh(page, f, data('partial', receipts)); await expect(note(page)).toHaveText('2 of 2 confirmed payments · fees in details · some history is missing'); expect(await rows(page)).toEqual(complete); await expect(summary).toBeFocused(); await expect(summary.locator('..')).toHaveAttribute('open', '');
    const payout = page.locator('[data-analytics-metric="payouts"] strong'); await expect(payout).toHaveText('2');
    await page.locator('#payment-history-type').selectOption('x'); await expect(list(page).locator('.empty-state')).toHaveText('No confirmed payments match these filters.'); await expect(note(page)).toHaveText('0 of 2 confirmed payments · fees in details · some history is missing');
    const before = f.requests(); await clear.focus(); await page.keyboard.press('Enter'); await expect(list(page).locator('.payment-history-row')).toHaveCount(2); expect(f.requests()).toBe(before); await expect(payout).toHaveText('2');
    await refresh(page, f, data('onchain-indexed', receipts)); await page.locator('#payment-history-type').selectOption('x'); await expect(list(page).locator('.empty-state')).toHaveText('No confirmed payments match these filters.'); await expect(note(page)).toHaveText('0 of 2 confirmed payments · fees in details');
    await page.screenshot({ path: info.outputPath(`filtered-${width}.png`) }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); expect(f.errors).toEqual([]); expect(f.writes).toEqual([]);
  });
}
