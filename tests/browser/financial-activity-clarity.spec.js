import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const mint='9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B',letters='3456789ABCDEFGHJKLMNPQRSTUVWXYZ';
for(const width of [390,1440]){
  test(`activity disclosure, exact amounts and progressive history at ${width}px (mocked receipts)`,async({page,baseURL},testInfo)=>{
    await page.setViewportSize({width,height:1000});await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
    await page.route('https://**/*',route=>route.request().method()==='GET'&&new URL(route.request().url()).origin===new URL(baseURL).origin?route.continue():route.abort());
    await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Mocked unavailable'}}));
    await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
    await page.route('**/api/rewards/experience**',route=>route.fulfill({json:{cluster:'devnet',evidence:{status:'recorded-finalized-v3'},tokens:[],events:[]}}));
    await page.route('**/api/buyback/status',route=>route.fulfill({json:{cluster:'devnet',pending:[{mint,amountLamports:'101',status:'below-minimum-order'}],receipts:Array.from({length:13},(_,i)=>({mint,signature:letters[i].repeat(64),status:'finalized',vaultDebitVerified:true,burnInstructionVerified:true,burnedBaseUnits:i===1?'9007199254740993123456789':'1806189',finalizedAt:'2026-10-13T11:06:01.383Z'}))}}));
    await page.goto('/#payments/activity');const center=page.locator('#financial-center'),rows=center.locator('.financial-record');
    await expect(rows).toHaveCount(10);await expect(center.locator('[data-flow-count]')).toHaveText('10 of 14 loaded records');
    await expect(center.locator('[data-flow-refresh]')).toBeEnabled();
    await expect(rows.nth(1).locator('strong')).toContainText('1,806,189 $FUNDED base units');
    await expect(rows.nth(2).locator('strong')).toContainText('9,007,199,254,740,993,123,456,789 $FUNDED base units');
    const details=rows.nth(1).locator('details');await expect(details).not.toHaveAttribute('open','');
    await details.locator('summary').click();await expect(details.locator('dd').first()).toBeVisible();await expect(details).toContainText(mint);
    await expect(rows.nth(1).getByRole('link',{name:'Inspect exact receipt'})).toHaveAttribute('href',new RegExp(`receipt=${letters[0].repeat(64)}`));
    await center.getByRole('button',{name:'Refresh activity'}).click();await expect(center.locator('[data-flow-rows]')).toHaveAttribute('aria-busy','false');
    await expect(rows.nth(1).locator('details')).toHaveAttribute('open','');
    await center.getByRole('button',{name:'Show more activity'}).click();await expect(rows).toHaveCount(14);
    await center.getByRole('button',{name:'Refresh activity'}).click();await expect(center.locator('[data-flow-rows]')).toHaveAttribute('aria-busy','false');await expect(rows).toHaveCount(14);
    await center.locator('[data-flow-filter]').selectOption('Accrued');await expect(rows).toHaveCount(1);await rows.locator('summary').click();await expect(rows).toContainText('Below the execution minimum');
    await center.locator('[data-flow-filter]').selectOption('Verified');await expect(rows).toHaveCount(10);await expect(rows.first().locator('.flow-stage')).toHaveText('Verified');
    await center.locator('.financial-help > summary').click();await expect(center.getByRole('link',{name:'Daily bonuses',exact:true})).toHaveAttribute('href','#bonuses');
    await expect(center).toContainText('separate evidence stages');await center.locator('.financial-help > summary').click();
    await rows.first().locator('summary').click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    await center.evaluate(el=>scrollTo({top:el.getBoundingClientRect().top+scrollY-110,behavior:'instant'}));
    await page.screenshot({path:testInfo.outputPath(`activity-${width}.png`)});
  });
}
test('the #rewards shared-link alias loads recorded activity',async({page,baseURL})=>{
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('https://**/*',route=>route.request().method()==='GET'&&new URL(route.request().url()).origin===new URL(baseURL).origin?route.continue():route.abort());
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Mocked unavailable'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/buyback/status',route=>route.fulfill({json:{cluster:'devnet',pending:[],receipts:[{mint,signature:letters[0].repeat(64),status:'finalized',vaultDebitVerified:true,burnInstructionVerified:true,burnedBaseUnits:'1806189',finalizedAt:'2026-10-13T11:06:01.383Z'}]}}));
  await page.goto('/#rewards');const center=page.locator('#financial-center');
  await expect(center.locator('.financial-record')).toHaveCount(1);
  await expect(center.locator('[data-flow-status]')).not.toContainText('Open Rewards');
});
