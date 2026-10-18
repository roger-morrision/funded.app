import { test, expect } from '@playwright/test';

const ADMIN = 'CG87C9tjCSB9BAoKfoPUM3mLvbg3WAK1NGNQCWi12zcJ';
const SOURCE = '7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y';

test('Devnet admin page signs in, shows balances and gates, and edits only the protocol share', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let signedIn = false, revision = 0;
  await page.addInitScript(address => {
    window.solana = { publicKey:{ toBase58:() => address }, connect:async () => ({}),
      signMessage:async () => ({ signature:new Uint8Array(64) }), on:() => {} };
  }, ADMIN);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const send = (status, body) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) });
    if (path === '/api/admin/session' && route.request().method() === 'GET')
      return send(signedIn ? 200 : 401, signedIn ? { wallet:ADMIN, expiresAt:new Date(Date.now() + 100_000).toISOString() } : { error:'Sign in.' });
    if (path === '/api/admin/challenge') return send(200, { nonce:'test', message:'funded.vip Devnet admin sign-in', expiresAt:new Date(Date.now() + 100_000).toISOString() });
    if (path === '/api/admin/session') { signedIn = true; return send(200, { wallet:ADMIN }); }
    if (path === '/api/fee-policy') return send(200, { revision, split:{ operationsPercent:40, referralLevelPercents:[10, 3, 2], communityPercent:20, buybackPercent:25 } });
    if (path === '/api/admin/overview') return send(200, { wallets:[{ role:'Pump fee keeper', address:SOURCE, custody:'server signer', withdrawable:true, lamports:'2000000000' }],
      withdrawalDestinations:[ADMIN], revenue:{ verifiedCollectionsLamports:'1000000000', operationsAllocationLamports:'100000000', finalizedSettlementCount:1 },
      gates:{ launch:true, collection:true, settlement:true, holder:false, referral:false, xClaims:false, buyback:false } });
    if (path === '/api/admin/audit') return send(200, { entries:[] });
    if (path === '/api/admin/withdrawals/reconcile') return send(200, { amountLamports:'1000000', signature:JSON.parse(route.request().postData()).signature, finalized:true });
    if (path === '/api/admin/fee-policy') { revision += 1; return send(200, { revision, split:JSON.parse(route.request().postData()).split, effectiveFor:'future launches only' }); }
    if (path === '/api/admin/vaults') return send(200, { totalLaunches:0, nextOffset:null, vaults:[] });
    return send(404, { error:'Unknown test route.' });
  });
  await page.goto('/admin.html');
  await expect(page.getByRole('heading', { name:'Admin', exact:true })).toBeVisible();
  await expect(page.locator('#workspace')).toBeHidden();
  await page.locator('#sign-in').click();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#fee-gross-preview')).toContainText('8% Operations & marketing');
  await expect(page.locator('#fee-gross-preview')).toContainText('4% Daily bonus');
  await expect(page.locator('#wallet-rows')).toContainText('2');
  await expect(page.locator('#gates')).toContainText('Enabled');
  await expect(page.locator('#withdraw-destination')).toHaveValue(ADMIN);
  await page.screenshot({ path:test.info().outputPath('admin-desktop.png'), fullPage:true });
  await page.setViewportSize({ width:390, height:844 });
  const overflow = await page.evaluate(() => ({ viewport:innerWidth, width:document.documentElement.scrollWidth,
    elements:[...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 8).map(node => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}.${node.className || ''}`) }));
  expect(overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
  await page.screenshot({ path:test.info().outputPath('admin-mobile.png'), fullPage:true });
  await page.locator('[name="operationsPercent"]').fill('30');
  await page.locator('[name="referral1"]').fill('20');
  await expect(page.locator('#fee-total')).toContainText('100.0000%');
  await expect(page.locator('#fee-gross-preview')).toContainText('6% Operations & marketing');
  await expect(page.locator('#fee-gross-preview')).toContainText('5% referrals');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name:'Publish for future launches' }).click();
  await expect(page.locator('#policy-revision')).toContainText('Revision 1');
  await expect(page.locator('#message')).toContainText('future launches');
  await page.locator('#reconcile-signature').fill('4'.repeat(88));
  await page.getByRole('button', { name:'Record finalized receipt' }).click();
  await expect(page.locator('#message')).toContainText('Finalized 0.001 SOL transfer recorded');
  expect(pageErrors).toEqual([]);
});
