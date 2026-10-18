import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const mint='So11111111111111111111111111111111111111112';
for(const width of [320,390,1440])test(`holder history is distinct from a future payout queue at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/fee-policy'
    ?route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}):route.fulfill({status:503,json:{error:'Offline fixture'}}));
  await page.route('**/api/rewards/experience**',route=>route.fulfill({json:{cluster:'devnet',evidence:{status:'recorded-finalized-v3'},
    wallet:null,events:[],tokens:[{mint,name:'Paid project QA',symbol:'PQA',holderSharePercent:10,status:'holders-paid',
      holderPaidWallets:1,holderPaidLamports:'10000',totals:{holder:'20000',creator:'0',x:'0'}}]}}));
  await page.goto('/#airdrops');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const root=page.locator('#holder-airdrop-programs');
  await expect(root.getByRole('tab',{name:'Awaiting first payout 0'})).toBeVisible();
  await expect(root.locator('#holder-airdrop-list')).toContainText('Previously paid projects may still receive more rewards');
  await expect(root.locator('#holder-airdrop-list')).not.toContainText('No upcoming holder rewards');
  await root.getByRole('tab',{name:'Payment history 1'}).click();
  await expect(root.locator('#holder-airdrop-note')).toContainText('not the current payout queue');
  await expect(root.locator('#holder-airdrop-list')).toContainText('Recorded paid');
  await expect(root.locator('#holder-airdrop-list')).toContainText('0.00001 SOL');
  await root.getByRole('tab',{name:'Payment history 1'}).press('ArrowLeft');
  await expect(root.getByRole('tab',{name:'Awaiting first payout 0'})).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await root.screenshot({path:test.info().outputPath('holder-history-tabs.png')});
});
