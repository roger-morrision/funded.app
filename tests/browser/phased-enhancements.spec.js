import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const mint='APjV65KZhb2AshXJDoHVVatxsGWV4GUEWdU6Q3WZoVMn';
async function setup(page,width){
  await page.setViewportSize({width,height:844});
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Controlled unavailable fixture'}}));
  await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/listings/mint/*',r=>r.fulfill({json:{cluster:'devnet',mint,name:'Flow QA',symbol:'FLOWQA',included:true,source:'verified-launch-registry'}}));
  await page.route('**/api/callouts',r=>r.fulfill({json:{callouts:[],topCallers:[{author:mint,calls:1,hits:1,avgMultiple:18.528,hitRate:1}],serverTime:new Date().toISOString()}}));
}
async function ready(page,route){await page.goto(route);await page.locator('body.product-flows-ready').waitFor();}
for(const width of [390,1280]){
  test(`included listing bypasses payment even with price unavailable at ${width}px (mocked)`,async({page},info)=>{
    await setup(page,width);await ready(page,'/#list');
    await page.locator('#list-mint').fill(mint);
    await expect(page.locator('#list-token-preview')).toContainText('listing included');
    await expect(page.locator('#list-token-preview a')).toHaveAttribute('href','/token/'+mint);
    await expect(page.locator('#list-pay')).toBeHidden();
    await expect(page.locator('#list-availability')).toHaveText('Listing included with launch · no additional fee');
    await page.screenshot({path:info.outputPath(`listing-${width}-mocked.png`)});
  });
  test(`callout picker carries intent into composer at ${width}px (mocked)`,async({page},info)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));await setup(page,width);await ready(page,'/#callouts');
    await page.route('**/api/tokens/*/chat',async r=>{await new Promise(resolve=>setTimeout(resolve,300));await r.fulfill({json:{enabled:true,messages:[]}});});
    await expect(page.locator('#callouts-top')).toContainText('1 of 1 calls reached 2x');
    await expect(page.locator('#callouts-top')).toContainText('18.5x mean peak');
    await expect(page.locator('.callouts-method')).toContainText('Devnet test activity');
    await page.evaluate(mint=>{window.fundedVerifiedSearchCandidates=()=>[{mint,name:'Flow QA',symbol:'FLOWQA',stage:'Migrated'}];},mint);
    await page.getByRole('link',{name:'Make a call',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Choose a coin to call'})).toBeVisible();
    await page.getByRole('link',{name:'Flow QA · FLOWQA · Migrated'}).click();
    await page.locator('body.product-flows-ready').waitFor();
    await expect(page.locator('#coin-chat-form input[name="callout"]')).toBeChecked();
    await expect(page.locator('#coin-chat-input')).toBeFocused();
    expect(errors).toEqual([]);
    await page.screenshot({path:info.outputPath(`composer-${width}-mocked.png`)});
  });
  test(`unavailable chat preserves intent without exposing a post form at ${width}px (mocked)`,async({page})=>{
    await setup(page,width);await ready(page,`/token/${mint}?compose=callout`);
    await expect(page.locator('#coin-activity-list')).toContainText('Chat unavailable');
    await expect(page.locator('#coin-chat-form')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('compose')).toBe('callout');
  });
  test(`table is the primary result and grid is hidden at ${width}px`,async({page})=>{
    await setup(page,width);await ready(page,'/#explore');
    await page.locator('[data-explore-view="table"]').click();
    await expect(page.locator('#asset-grid')).toBeHidden();
    await expect(page.locator('#explore .scanner-scroll')).toBeVisible();
    await page.locator('[data-explore-view="grid"]').click();
    await expect(page.locator('#explore .scanner-scroll')).toBeHidden();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  });
  test(`readiness stays local and support context is opt-in at ${width}px (mocked)`,async({page},info)=>{
    await setup(page,width);await ready(page,'/token/'+mint);
    await page.evaluate(mint=>window.dispatchEvent(new CustomEvent('funded:coin-facts',{detail:{mint,error:true}})),mint);
    await expect(page.locator('.coin-readiness')).toContainText('Market verification unavailable');
    await expect(page.locator('.coin-readiness p')).toBeVisible();
    await expect(page.locator('.coin-readiness a').first()).toHaveAttribute('href',`/?airdropMint=${mint}#airdrops`);
    await page.getByRole('link',{name:'Report this step',exact:true}).click();
    await page.locator('#issue-reports textarea').fill('The market snapshot did not finish loading.');
    await page.getByRole('button',{name:'Review report',exact:true}).click();
    await expect(page.locator('#issue-reports pre')).not.toContainText(mint);
    await page.locator('#issue-reports input[type="checkbox"]').check();
    await page.getByRole('button',{name:'Review report',exact:true}).click();
    await expect(page.locator('#issue-reports pre')).toContainText(mint);
    await expect(page.locator('#issue-reports pre')).toContainText('token-detail');
    await expect(page.locator('#issue-reports pre')).toContainText('verification-unavailable');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`support-${width}-mocked.png`)});
  });
}
