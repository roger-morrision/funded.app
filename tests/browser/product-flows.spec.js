import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
const mint = '9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
async function setup(page, width) {
  await page.setViewportSize({width,height:900});
  await page.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({status:503,json:{error:'mocked offline'}}));
  await page.route('**/api/fee-policy', route => route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/launches', route => route.fulfill({json:[{mint,creatorWallet:mint,onchainVerified:true,cluster:'devnet',name:'Flow fixture',symbol:'FLOW'}]}));
}
for (const width of [390,1440]) {
  test(`manual fee split and advisory identity at ${width}px (mocked Devnet)`, async ({page}) => {
    await setup(page,width); await page.goto('/#launch');
    await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
    await page.locator('#creator-wallet-share').fill('40');await page.locator('#holder-airdrop-share').fill('40');
    await expect(page.locator('#creator-wallet-share')).toHaveValue('40');
    await expect(page.locator('#holder-airdrop-share')).toHaveValue('40');
    await expect(page.locator('#holder-airdrop-share')).toHaveValue('40');
    await page.locator('#token-name').fill('Flow fixture');
    await expect(page.locator('.flow-note').filter({hasText:'Similar name or ticker'})).toBeVisible();
    await page.locator('#creator-wallet-share').fill('80');await page.locator('#holder-airdrop-share').fill('0');
    await expect(page.locator('#creator-wallet-share')).toHaveValue('80');
    await expect(page.locator('#holder-airdrop-share')).toHaveValue('0');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  });
  test(`review buy intent and return reminder at ${width}px (mocked offline quotes)`, async ({page}) => {
    await setup(page,width); await page.goto(`/token/${mint}?reviewBuy=0.25`);
    await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
    await expect(page.locator('#trade-amount')).toHaveValue('0.25');
    await expect(page.locator('#trade-review-dialog')).not.toBeVisible();
    if (width < 700) { await expect(page.locator('#trade-panel')).toHaveAttribute('aria-modal','true'); await page.locator('.mobile-trade-close').click(); await page.locator('.mobile-trade-sell').click(); await expect(page.locator('#trade-side')).toHaveValue('sell'); await page.locator('.mobile-trade-close').click(); await expect(page.locator('.mobile-trade-sell')).toBeFocused(); }
    // The token page no longer offers a return-reminder form.
    await expect(page.locator('.return-reminder')).toHaveCount(0);
  });
  test(`financial activity evidence and filter at ${width}px (mocked receipts)`, async ({page}) => {
    await setup(page,width);
    await page.route('**/api/rewards/experience**', route => route.fulfill({json:{cluster:'devnet',evidence:{status:'recorded-finalized-v3'},tokens:[],events:[]}}));
    await page.route('**/api/buyback/status', route => route.fulfill({json:{cluster:'devnet',pending:[{mint,amountLamports:'101',status:'below-minimum-order'}],receipts:[{mint,signature:'3'.repeat(64),status:'finalized',vaultDebitVerified:true,burnInstructionVerified:true,burnedBaseUnits:'123'}]}}));
    await page.goto('/#payments/activity');
    await expect(page.locator('#financial-center')).toBeVisible();
    await expect(page.locator('[data-flow-rows]')).toContainText('123 $FUNDED base units');
    await page.locator('[data-flow-filter]').selectOption('Accrued');
    await expect(page.locator('[data-flow-rows]')).toContainText('Below the execution minimum');
    await expect(page.locator('[data-flow-rows]')).not.toContainText('Protocol $FUNDED burned');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  });
  test(`creator can schedule and cancel an announcement at ${width}px (mocked authenticated API)`, async ({page}) => {
    await setup(page,width); const writes = [], id = 'a'.repeat(24);
    await page.route('**/api/creator-support/me', route => route.fulfill({json:{csrf:'fixture-csrf',announcements:{scheduling:true},user:{id:'123',username:'fixture'},profile:{listed:true,identityVerified:true,updates:[]},coins:[]}}));
    await page.route('**/api/creator-support/updates', async route => {
      const body = route.request().postDataJSON(); writes.push({body,csrf:route.request().headers()['x-creator-csrf']});
      await route.fulfill({json:body.cancelId ? {cancelled:true,id:body.cancelId} : {id,...body,createdAt:new Date().toISOString()}});
    });
    await page.goto('/#creator-settings');
    await expect(page.locator('#creator-update-time')).toBeVisible();
    await page.locator('#creator-update-text').fill('A scheduled progress update');
    const future = new Date(Date.now() + 600000), local = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0,16);
    await page.locator('#creator-update-time').fill(local);
    await page.locator('#creator-update-form button').click();
    await expect(page.locator('#creator-settings-status')).toContainText('Announcement scheduled');
    await page.getByRole('button',{name:'Cancel scheduled update'}).click();
    await expect(page.locator('#creator-settings-status')).toContainText('cancelled');
    expect(writes).toHaveLength(2); expect(writes[0].csrf).toBe('fixture-csrf'); expect(writes[1].body).toEqual({cancelId:id});
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  });
}
test('older APIs cannot accidentally publish a scheduled announcement immediately (mocked API)', async ({page}) => {
  await setup(page,390); let writes = 0;
  await page.route('**/api/creator-support/me', route => route.fulfill({json:{csrf:'old-csrf',user:{id:'123',username:'fixture'},profile:{listed:true,updates:[]},coins:[]}}));
  await page.route('**/api/creator-support/updates', route => { writes++; return route.fulfill({json:{id:'a'.repeat(24)}}); });
  await page.goto('/#creator-settings');
  await expect(page.locator('#creator-update-time')).toBeDisabled();
  await expect(page.locator('#creator-update-form p')).toContainText('immediate publication only');
  await page.locator('#creator-update-text').fill('Future announcement');
  await page.locator('#creator-update-time').evaluate(input => { input.value = '2026-11-01T12:00'; });
  await page.locator('#creator-update-form button').click();
  await expect(page.locator('#creator-settings-status')).toContainText('No update was sent'); expect(writes).toBe(0);
});
