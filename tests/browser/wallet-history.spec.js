import { test, expect } from '@playwright/test';

const wallet = 'ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC';
const mint = 'EtMFvbnLJMmp4PWqDVSqYzWfkWhZy3FznJQTN35rYWPc';
const xSignature = '3'.repeat(64);
const holderSignature = '4'.repeat(64);
const bonusSignature = '5'.repeat(64);
const payment = '6'.repeat(32);

test('connected wallet profile filters confirmed claims, rewards, airdrops, and bonuses', async ({ page }) => {
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
  await page.route('**/api/referral-claims?wallet=*', route => route.fulfill({ json:{
    wallet, claims:[{ status:'paid', finalized:true, balanceDeltaVerified:true,
      recipientWallet:wallet, asset:'SOL', level:2,
      amount:'0.2', payoutSignature:bonusSignature, paidAt:'2026-10-14T00:00:00Z' }],
  } }));
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
  await expect(page.locator('#wallet-detail-content .wallet-activity-row')).toHaveCount(5);
  for (const [filter, label] of [
    ['claim','X reward claimed'], ['reward','Holder reward received'],
    ['airdrop','Community airdrop claimed'], ['bonus','Referral bonus received'],
  ]) {
    await page.locator(`[data-wallet-filter="${filter}"]`).click();
    await expect(page.locator('#wallet-detail-content .wallet-activity-row')).toHaveCount(1);
    await expect(page.locator('#wallet-detail-content')).toContainText(label);
  }
  await page.locator('[data-wallet-filter="bonus"]').click();
  await page.locator('#connect-button').click();
  await page.locator('#wallet-popover-disconnect').click();
  await expect(page.locator('[data-wallet-filter="bonus"]')).toBeHidden();
  await expect(page.locator('#wallet-detail-content')).not.toContainText('Referral bonus received');
});
