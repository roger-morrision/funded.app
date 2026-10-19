import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
const offlineFixture = route => new URL(route.request().url()).pathname === '/api/fee-policy'
  ? route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}})
  : route.fulfill({status:503,json:{error:'Offline fixture'}});
const wallets = ['7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y',
  'ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC', 'GTGKxA9DRbVFuAyoXvA8j1LAtZaf9fyJbvArGbJSbm5c'];
test('fee calculator shows 8/4 and daily rankings distinguish allocations from finalized payments', async ({ page }) => {
  await page.setViewportSize({ width:1440, height:900 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let paid = false;
  await page.route('**/api/**', offlineFixture);
  await page.route('**/api/daily-bonus', route => route.fulfill({ json:{ cluster:'devnet', payoutEnabled:false,
    pendingSettlementSources:[{mint:wallets[0],status:'not-eligible'}],
    worker:{ status:'active' }, nextCutoffAt:'2026-10-19T00:00:00Z', snapshots:[{ day:'2026-10-17',
      status:'snapshotted', hash:'a'.repeat(64), allocatedLamports:'4000000000', retainedLamports:'0',
      eligibilityBasis:paid?'settlement-time-v1':'collection-time-v1',
      reconciliation:paid?{kind:'append-only-frozen-rankings-v1'}:null,
      rankings:Object.fromEntries(['creators', 'referrals', 'traders'].map(group => [group,
        wallets.map((wallet, index) => ({ rank:index + 1, wallet, scoreLamports:String(300 - index),
          bonusLamports:String([500, 300, 200][index]), percentOfCategory:[50, 30, 20][index] }))])),
      sources:(paid ? [{ signature:null, payment:'5'.repeat(44) }, { signature:'3'.repeat(88) },
        { signature:'3'.repeat(88), payment:'5'.repeat(44) }] : [{}]).map(proof => ({
        mint:wallets[0], status:paid ? 'paid' : 'awaiting-verified-community-funding',
        payments:paid ? { [wallets[1]]:{ amount:'500', amountReceived:'450', finalized:true, balanceDeltaVerified:true, ...proof } } : {} })) }] } }));
  await page.route('https://**/*', route => route.abort());
  await page.goto('/#capital-flow');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const capitalMenu = page.locator('.primary-nav > a[href="#capital-flow"]');
  await expect(capitalMenu).toBeVisible();
  await expect(capitalMenu).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('body')).not.toHaveClass(/page-route-analytics-detail/);
  await expect(page.locator('.main-content > #capital-flow')).toBeVisible();
  await expect(page.locator('#analytics-detail')).toBeHidden();
  await expect(page.locator('nav[aria-label="Analytics sections"]')).toHaveCount(0);
  await page.locator('.nav-more summary').click();
  await page.locator('.primary-nav a[href="#analytics-detail"]').click();
  await expect(page.locator('#analytics-detail')).toBeVisible();
  await expect(page.locator('#capital-flow')).toBeHidden();
  await expect(page.locator('.primary-nav a[href="#analytics-detail"]')).toHaveAttribute('aria-current', 'page');
  await expect(capitalMenu).not.toHaveAttribute('aria-current', 'page');
  await capitalMenu.click();
  await expect(page.locator('#analytics-detail')).toBeHidden();
  await expect(capitalMenu).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#fee-output-operations')).toHaveText('8 SOL');
  await expect(page.locator('#fee-output-community')).toHaveText('4 SOL');
  await expect(page.locator('.fee-output-grid .operations')).toContainText('Operations & marketing');
  await page.locator('#fee-flow-input').fill('250');
  await expect(page.locator('#fee-output-operations')).toHaveText('20 SOL');
  await expect(page.locator('#fee-output-community')).toHaveText('10 SOL');
  await expect(page.locator('#daily-bonus-dashboard')).toContainText('1st 50% · 2nd 30% · 3rd 20% of the category budget');
  await expect(page.locator('#daily-bonus-dashboard')).toContainText('each receive one third');
  await expect(page.locator('#daily-bonus-dashboard tbody tr')).toHaveCount(9);
  await expect(page.locator('#daily-bonus-dashboard [data-bonus-status]')).toContainText('not activated');
  await expect(page.locator('#daily-bonus-dashboard')).toContainText('Historical snapshot: fee eligibility uses its original collection-time rules.');
  await expect(page.locator('#daily-bonus-dashboard [data-bonus-status]')).toContainText('1 source(s) await finalized settlement');
  await page.getByText('Snapshot and payment evidence', { exact:true }).click();
  await expect(page.locator('#daily-bonus-dashboard details')).toContainText('awaiting verified community funding');
  await expect(page.locator('#daily-bonus-dashboard details a')).toHaveCount(0);
  await expect(page.locator('#daily-bonus-dashboard tbody tr').first()).toContainText('No finalized receipt');
  paid = true; await page.locator('[data-bonus-refresh]').click();
  await expect(page.locator('#daily-bonus-dashboard')).toContainText('Fee eligibility uses finalized settlement time.');
  await expect(page.locator('#daily-bonus-dashboard')).toContainText('original frozen ranks and scores');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path:test.info().outputPath('daily-bonus-desktop.png'), fullPage:true });
  await expect(page.locator('#daily-bonus-dashboard details a')).toHaveAttribute('href', /explorer\.solana\.com\/tx\/.*cluster=devnet/);
  await expect(page.locator('#daily-bonus-dashboard tbody tr').nth(1)).toContainText('0.00000045 SOL');
  await page.setViewportSize({ width:390, height:844 });
  await page.locator('#open-menu').click();
  await expect(capitalMenu).toBeVisible();
  await capitalMenu.click();
  await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
  await expect(page.locator('.main-content > #capital-flow')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path:test.info().outputPath('daily-bonus-mobile.png'), fullPage:true });
  expect(errors).toEqual([]);
});


test('snapshot selection explains started payouts, reconciliation blocks and invalid networks clear stale results', async ({ page }) => {
  let cluster = 'devnet';
  const empty = { hash:'b'.repeat(64), allocatedLamports:'0', retainedLamports:'0',
    rankings:{ creators:[], referrals:[], traders:[] }, sources:[] };
  await page.route('**/api/**', offlineFixture);
  await page.route('**/api/daily-bonus', route => route.fulfill({ json:{ cluster, snapshotEnabled:true, payoutEnabled:true,
    worker:{ status:'active' }, snapshots:[{ ...empty, day:'2026-10-17', status:'reconciliation-required', reason:'Evidence changed.', sources:[{mint:wallets[0],status:'paid',payments:{}}] },
      { ...empty, day:'2026-10-16', status:'snapshotted' }] } }));
  await page.route('https://**/*', route => route.abort());
  await page.goto('/#capital-flow');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const status = page.locator('[data-bonus-status]');
  await expect(status).toContainText('Further payouts are blocked');
  await expect(status).toContainText('Evidence changed');
  await expect(status).toContainText('replacing a started payout is unavailable');
  await page.locator('[data-bonus-day]').selectOption('2026-10-16');
  await expect(status).toContainText('Verified snapshot below');
  await page.locator('[data-bonus-day]').selectOption('2026-10-17');
  await expect(status).toContainText('requires reconciliation');
  cluster = 'mainnet-beta';
  await page.locator('[data-bonus-refresh]').click();
  await expect(status).toContainText('data is unavailable');
  await expect(page.locator('[data-bonus-day-label]')).toBeHidden();
  await expect(page.locator('[data-bonus-results]')).toBeEmpty();
});

test('Analytics identifies V3 creator receipts and displays the net wallet receipt', async ({ page }) => {
  await page.route('**/api/**', offlineFixture);
  await page.route('**/api/evidence/payment-history', route => route.fulfill({ json:{ cluster:'devnet',
    status:'onchain-indexed', checkedCreator:1, verifiedPayouts:[{ source:'v3-creator-wallet', to:wallets[0],
      signature:'3'.repeat(64), amountLamports:'1000', actualReceivedLamports:'900', blockTime:1792274400 }] } }));
  await page.route('https://**/*', route => route.abort());
  await page.goto('/#analytics-detail');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('.recipients-panel .payment-row')).toContainText('Creator ·');
  await expect(page.locator('.recipients-panel .payment-row')).toContainText('0.0000009 SOL received');
  await expect(page.locator('.recipients-panel .payment-row')).not.toContainText('Recipient ·');
  await expect(page.locator('[data-payment-scope]')).toContainText('Daily bonus receipts are included');
  await expect(page.locator('[data-payment-scope] a')).toHaveAttribute('href','#bonuses');
});

test('Daily bonus receipts are named, filterable, and explain receiver-paid rent', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/**', offlineFixture);
  await page.route('**/api/evidence/payment-history', route => route.fulfill({json:{cluster:'devnet',
    status:'onchain-indexed',checkedDaily:1,verifiedPayouts:[{source:'daily-bonus',to:wallets[0],
      signature:'3'.repeat(64),amountLamports:2000000,actualReceivedLamports:995000,
      recipientRentLamports:1000000,feeLamports:5000,feePayer:wallets[0],blockTime:1792274400}]}}));
  await page.route('https://**/*',route=>route.abort());
  await page.goto('/#payments');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.waitForFunction(()=>document.body.dataset.bootstrapState === 'ready'
    && document.body.classList.contains('product-experience-ready'));
  await page.getByRole('tab',{name:'History',exact:true}).click();
  const row=page.locator('#payment-list .payment-history-row');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Daily bonus');
  await expect(row).toContainText('0.000995');
  await page.locator('#payment-history-type').selectOption('community');
  await expect(row).toHaveCount(1);
  await row.locator('summary').click();
  await expect(row).toContainText('Payment account rent 0.001 SOL · paid by receiver');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/daily-bonus-payment-mobile.png'});
  await page.locator('#payment-history-type').selectOption('creator');
  await expect(row).toHaveCount(0);
});
