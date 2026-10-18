import { test, expect } from '@playwright/test';

const wallet = 'ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC';
const mint = 'EtMFvbnLJMmp4PWqDVSqYzWfkWhZy3FznJQTN35rYWPc';
const xSignature = '3'.repeat(64);
const holderSignature = '4'.repeat(64);
const bonusSignature = '5'.repeat(64);
const payment = '6'.repeat(32);

for (const [referralStatus, hasDailyReceipt] of [[200, true], [401, true], [503, true], [401, false]]) test(`wallet profile Daily bonus receipt ${hasDailyReceipt} with referral HTTP ${referralStatus}`, async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status:503, json:{ error:'mocked unavailable' } }));
  await page.route('**/api/launches', route => route.fulfill({ json:[{
    mint, symbol:'QA', name:'QA token', creatorWallet:wallet, cluster:'devnet', onchainVerified:true,
  }] }));
  await page.route('**/api/rewards/experience*', route => route.fulfill({ json:{
    cluster:'devnet', evidence:{ status:'recorded-finalized-v3' },
    wallet:{ address:wallet, rows:[{ mint, symbol:'QA', payouts:[
      { kind:'x', wallet, signature:xSignature, amountLamports:'123127',
        paidAt:'2026-10-14T02:00:00Z', feeSourceVerified:true },
      { kind:'holder', wallet, signature:holderSignature, amountLamports:'250000',
        paidAt:'2026-10-14T01:00:00Z', feeSourceVerified:true },
      { kind:'holder', wallet, signature:'7'.repeat(64), amountLamports:'900000',
        feeSourceVerified:false },
    ] }] },
  } }));
  await page.route('**/api/airdrops/reserves', route => route.fulfill({ json:{
    cluster:'devnet', reserves:[{ mint, verified:true, status:'drop-closed',
      reservedTokens:'100', totalBaseUnits:'100000000' }],
  } }));
  await page.route('**/api/airdrops/claims/proof**', route => route.fulfill({ json:{
    status:'claimed', recipient:wallet, amount:'12500000', payment,
  } }));
  await page.route('**/api/referral-claims?wallet=*', route => referralStatus === 200 ? route.fulfill({ json:{
    wallet, claims:[{ status:'paid', finalized:true, balanceDeltaVerified:true,
      recipientWallet:wallet, asset:'SOL', level:2,
      amount:'0.2', payoutSignature:bonusSignature, paidAt:'2026-10-14T00:00:00Z' }],
  } }) : route.fulfill({ status:referralStatus, json:{ error:'Referral fixture unavailable' } }));
  const dailyPayment = { amount:'500000', amountReceived:'450000', finalized:true, balanceDeltaVerified:true,
    signature:'8'.repeat(64), payment:'9'.repeat(32), paidAt:'2026-10-17T12:00:00Z' };
  await page.route('**/api/daily-bonus', route => route.fulfill({ json:{ cluster:'devnet', snapshots:[{
    day:'2026-10-17', status:'snapshotted', hash:'c'.repeat(64), allocatedLamports:'500000', retainedLamports:'0',
    rankings:{ creators:[], referrals:[], traders:[] }, sources:hasDailyReceipt ? [
      { status:'paid', mint, payments:{ [wallet]:{ ...dailyPayment, signature:null } } },
      { status:'paid', mint, payments:{ [wallet]:{ ...dailyPayment, payment:null } } },
      { status:'paid', mint, payments:{ [wallet]:dailyPayment,
      [mint]:{ ...dailyPayment, amount:'9000000000', amountReceived:'9000000000', signature:'A'.repeat(64) } } },
      { status:'paid', mint, payments:{ [wallet]:dailyPayment } },
      { status:'distributing', mint, payments:{ [wallet]:{ ...dailyPayment, finalized:false, signature:'B'.repeat(64) } } }] : [],
  }] } }));
  await page.addInitScript(address => {
    const listeners = new Map();
    const provider = {
      isPhantom:true, isConnected:false, publicKey:null,
      signTransaction:async transaction => transaction,
      on(event, callback) { listeners.set(event, [...(listeners.get(event) || []), callback]); },
      async connect(options = {}) {
        if (options.onlyIfTrusted) throw new Error('Not trusted');
        provider.publicKey = { toBase58:() => address };
        provider.isConnected = true;
        for (const callback of listeners.get('connect') || []) callback(provider.publicKey);
        return { publicKey:provider.publicKey };
      },
      async disconnect() {
        provider.isConnected = false; provider.publicKey = null;
        for (const callback of listeners.get('disconnect') || []) callback();
      },
    };
    window.phantom = { solana:provider };
    window.solana = provider;
  }, wallet);

  await page.goto(`/wallet/${wallet}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('#connect-button').click();
  await page.locator('[data-wallet-choice="phantom"]').click();
  await expect(page.locator('#wallet-self-badge')).toBeVisible();
  await expect(page.locator('#wallet-detail-content .wallet-activity-row')).toHaveCount((referralStatus === 200 ? 6 : 5) - (hasDailyReceipt ? 0 : 1));
  for (const [filter, label] of [
    ['claim','X reward claimed'], ['reward','Holder reward received'],
    ['airdrop','Community airdrop claimed'], ['bonus',hasDailyReceipt ? 'Daily bonus received' : 'Bonus history incomplete'],
  ]) {
    await page.locator(`[data-wallet-filter="${filter}"]`).click();
    await expect(page.locator('#wallet-detail-content .wallet-activity-row')).toHaveCount(filter === 'bonus' ? (hasDailyReceipt ? 1 : 0) + (referralStatus === 200 ? 1 : 0) : 1);
    await expect(page.locator('#wallet-detail-content')).toContainText(label);
  }
  await page.locator('[data-wallet-filter="bonus"]').click();
  const content = page.locator('#wallet-detail-content');
  if (hasDailyReceipt) await expect(content).toContainText('0.00045 SOL');
  else expect((await content.textContent()).split('Verify this wallet in Referrals').length - 1).toBe(1);
  await expect(content).not.toContainText('9 SOL');
  await expect(page.locator('[data-wallet-bonus-coverage]')).toContainText('up to 30 published UTC snapshots');
  await expect(page.locator('[data-wallet-bonus-coverage]')).toContainText(referralStatus === 200 ? 'Referral bonus records loaded'
    : referralStatus === 401 ? 'Verify this wallet in Referrals' : 'Referral bonus history is unavailable');
  await page.setViewportSize({ width:390, height:844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path:test.info().outputPath('wallet-daily-bonus-mocked.png'), fullPage:true });
  await page.locator('#connect-button').click();
  await page.locator('#wallet-popover-disconnect').click();
  await expect(page.locator('[data-wallet-filter="bonus"]')).toBeHidden();
  await expect(page.locator('#wallet-detail-content')).not.toContainText('Referral bonus received');
  await expect(page.locator('#wallet-detail-content')).not.toContainText('Daily bonus received');
});
