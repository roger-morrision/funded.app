import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

const wallet='7'.repeat(32),mint='So11111111111111111111111111111111111111112',signature='3'.repeat(64);
function bonus(url) {
  const category=url.searchParams.get('category')||'all';
  return {cluster:'devnet',scope:'all-recorded-snapshots',serverTime:'2026-11-01T12:00:00Z',nextCutoffAt:'2026-11-02T00:00:00Z',
    poolCheckedAt:'2026-11-01T12:00:00Z',snapshotEnabled:true,payoutEnabled:true,pool:{status:'verified-indexed-settlements',day:'2026-11-01',collections:1,categoryLamports:{creators:'1000',referrals:'1000',traders:'1000'}},
    snapshots:1,totalPayments:1,unavailableReceipts:0,unavailableSnapshots:0,worker:{status:'active'},
    leaders:{creators:[{wallet,receivedLamports:'149',payments:1}],referrals:[],traders:[]},
    history:{page:1,pages:1,total:1,category,rows:[{wallet,day:'2026-10-31',receivedLamports:'149',categoryLamports:{creators:'50',referrals:'50',traders:'49'},signature,href:`https://explorer.solana.com/tx/${signature}?cluster=devnet`}]}};
}
test.beforeEach(async({page,baseURL})=>{
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(baseURL).origin?r.fallback():r.abort());
  await page.route('**/api/**',r=>{
    const url=new URL(r.request().url()),path=url.pathname;
    if(path==='/api/fee-policy')return r.fulfill({json:{revision:6,split:PROTOCOL_FEE_SPLIT}});
    if(path==='/api/daily-bonus/dashboard')return r.fulfill({json:bonus(url)});
    if(path==='/api/leaderboard/burners')return r.fulfill({json:{cluster:'devnet',wallets:[{wallet,burnedTokens:12,receiptCount:1,latestSignature:signature}]}});
    if(path==='/api/listings')return r.fulfill({json:{cluster:'devnet',listings:[{mint,name:'Listing review fixture',symbol:'LRF',cluster:'devnet',onchainVerified:true,signature,listedAt:'2026-10-31T12:00:00Z',usd:300,amountTokens:400,decimals:6}]}});
    return r.fulfill({status:503,json:{error:'Unavailable review fixture'}});
  });
});
for(const width of [320,390,1440])test(`page refinements retain bonus disclosure, wallet recovery and table behavior at ${width}px (mocked APIs)`,async({page},info)=>{
  test.setTimeout(60000);await page.setViewportSize({width,height:960});const errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&!r.url().includes('/api/solana/rpc'))writes.push(new URL(r.url()).pathname);});
  await page.goto('/#bonuses');await page.locator('body.product-flows-ready').waitFor();
  const receipts=page.locator('[data-bonus-history-rows]');await expect(receipts).toContainText('0.000000149 SOL');
  const help=page.locator('.bonus-receipt-help'),summary=help.locator('summary');await expect(help).not.toHaveAttribute('open','');await expect(help.locator('p').first()).toBeHidden();
  await summary.focus();await page.keyboard.press('Enter');await expect(help).toHaveAttribute('open','');await expect(summary).toBeFocused();await expect(help).toContainText('they are not additional payments');await expect(help).toContainText('rounding is reconciled to the lamport');
  const proof=receipts.getByRole('link',{name:'Transaction ↗',exact:true});await expect(proof).toHaveAttribute('href',`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  const before=await receipts.locator('td').allTextContents();await page.locator('[data-bonus-history-refresh]').click();await expect(receipts.locator('td')).toHaveText(before);await expect(help).toHaveAttribute('open','');
  const select=page.getByRole('combobox',{name:'Bonus category',exact:true});await select.selectOption('traders');await expect(page.locator('[data-bonus-page]')).toHaveText('Page 1 of 1 · 1 payments');await expect(help).toHaveAttribute('open','');
  await summary.focus();await page.keyboard.press('Space');await expect(help).not.toHaveAttribute('open','');await expect(summary).toBeFocused();
  for(const control of [summary,select,page.locator('[data-bonus-history-refresh]')])expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:info.outputPath(`bonuses-${width}.png`)});
  await page.evaluate(()=>location.hash='airdrops');await expect(page.locator('#airdrops')).toBeVisible();const connect=page.locator('.airdrop-wallet-gate button');
  const size=await connect.boundingBox();expect(size.height).toBeGreaterThanOrEqual(44);expect(size.width).toBeLessThan(240);await connect.click();await expect(page.locator('#wallet-onboarding-dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#wallet-onboarding-dialog')).toBeHidden();
  await page.screenshot({path:info.outputPath(`airdrops-${width}.png`)});
  await page.evaluate(()=>location.hash='list');const listing=page.locator('#list-live-items a');await expect(listing).toHaveText(/Listing review fixture.*LRF/);await expect(listing).toHaveAttribute('href',`/token/${mint}`);await listing.focus();await expect(listing).toBeFocused();
  await expect(listing).toContainText('400 $FUNDED burned');await expect(page.locator('#list-pay')).toBeHidden();await page.screenshot({path:info.outputPath(`list-${width}.png`)});
  await page.evaluate(()=>location.hash='referrals');await expect(page.locator('#route-guide .route-guide-actions')).toBeHidden();await expect(page.locator('#referral-command-center')).toBeVisible();
  await page.evaluate(()=>location.hash='leaderboard');const table=page.locator('#leaderboard-table'),hint=page.locator('#leaderboard-scroll-help');await expect(table.locator('.leaderboard-row')).toHaveCount(1);
  await expect.poll(()=>table.evaluate(t=>document.querySelector('#leaderboard-scroll-help').hidden===(t.scrollWidth<=t.clientWidth+1))).toBe(true);
  // A presentation-only wide row exercises guidance on/off without changing data, routes or wallet state.
  await table.locator('.leaderboard-table-head').evaluate(e=>e.style.minWidth='2400px');await expect(hint).toBeVisible();await expect(table).toHaveAccessibleDescription(/Left and Right arrow keys/);
  await table.focus();await page.keyboard.press('ArrowRight',{delay:180});await expect.poll(()=>table.evaluate(t=>t.scrollLeft)).toBeGreaterThan(0);
  await table.locator('.leaderboard-table-head').evaluate(e=>e.style.removeProperty('min-width'));await expect.poll(()=>table.evaluate(t=>document.querySelector('#leaderboard-scroll-help').hidden===(t.scrollWidth<=t.clientWidth+1))).toBe(true);
  await expect(table).toHaveAttribute('tabindex','0');await page.keyboard.press('Tab');await expect(table.locator('a').first()).toBeFocused();await page.screenshot({path:info.outputPath(`leaderboard-${width}.png`)});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);expect(writes).toEqual([]);
});
