import {test,expect} from '@playwright/test';
import {build} from 'vite';
import {fileURLToPath} from 'node:url';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const built=await build({root,configFile:false,logLevel:'silent',build:{write:false,lib:{entry:root+'tests/fixtures/community-layout.js',name:'CommunityFixture',formats:['iife']}}});
const fixture=built[0].output.find(row=>row.type==='chunk').code;
async function setup(page,path='/#overview'){
 await page.route('https://**/*',route=>route.abort());
 await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline growth fixture'}}));
 await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
 await page.goto(path);await page.locator('body.product-flows-ready').waitFor();
}
for(const width of [320, 1440])test(`discovery controls and honest offline states at ${width}px (mocked)`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);
 const nav=page.locator('#home-discovery-controls');await expect(nav).toBeVisible();
 await expect(nav.locator('button').first()).toHaveText('New');await expect(nav.locator('[data-home-discovery="new"]')).toHaveAttribute('aria-pressed','true');
 const controls=await nav.boundingBox();const dock=await page.locator('.mobile-workspace-nav').isVisible()?await page.locator('.mobile-workspace-nav').boundingBox():null;expect(controls.y).toBeGreaterThanOrEqual(0);expect(controls.y+controls.height).toBeLessThanOrEqual(dock?.y??900);
 for(const [value,title] of [['new','New coins'],['near','Near graduation'],['saved','Your favorite coins'],['trending','Trending coins']]){
  await page.locator(`[data-home-discovery="${value}"]`).click();await expect(page.locator('#home-launch-board-title')).toHaveText(title);
 }
 await expect(page.locator('#home-ranking-note')).toContainText('Paid boosts do not affect');
 await page.evaluate(()=>location.hash='explore');await expect(page.locator('body')).toHaveClass(/page-route-explore/);
 await page.evaluate(()=>location.hash='overview');await expect(nav.locator('[data-home-discovery="new"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#home-ranking-note')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('discovery.png'),animations:'disabled'});expect(errors).toEqual([]);
});
test('reward states link to the correct asset and claim flows (mocked)',async({page})=>{
 await setup(page,'/#payments');const states=page.locator('.reward-status-guide');await expect(states).toBeVisible();
 await expect(states.getByRole('link',{name:/Token airdrops/})).toHaveAttribute('href','#airdrops');
 await expect(states.getByRole('link',{name:/X rewards/})).toHaveAttribute('href','#payments/x');
 await expect(page.locator('.reward-program-guide h2')).toBeVisible();
 await expect(page.locator('.reward-program-guide article').first()).toBeVisible();
 await expect(page.locator('.reward-program-guide')).toContainText('Automatic after funding');
});
test('confirmed-launch fixture opens an editable share card, pending registration cannot (mocked)',async({page})=>{
 await setup(page);
 await page.addScriptTag({content:fixture});
 const launch={mint:'Gv3uSJu2Ki7eqC6V4H1Fc31MMXLih6TJR19a5sydPfr7',name:'Community test',symbol:'TEST',signature:'3'.repeat(88),registered:false};
 await page.evaluate(launch=>CommunityFixture.showLaunchSuccess(launch),launch);
 await expect(page.locator('[data-share-launch]')).toBeDisabled();await page.locator('[data-close-launch]').click();
 await page.evaluate(launch=>CommunityFixture.showLaunchSuccess({...launch,registered:true}),launch);
 await page.locator('[data-share-launch]').click();await expect(page.locator('#share-dialog')).toBeVisible();
 await expect(page.locator('#share-message')).toHaveValue(/Test funds/);await page.locator('#share-message').fill('My community invitation');
 await expect(page.locator('#share-link')).toHaveValue(new RegExp('/token/'+launch.mint));
 await expect(page.locator('#share-result-canvas')).toBeVisible();await expect(page.locator('#share-status')).toContainText('Confirmed launch');
});
test('creator pilot saves a local timeline without sending a post (mocked)',async({page},info)=>{
 await page.setViewportSize({width:390,height:900});
 await setup(page,'/#community-pilot');const form=page.locator('#community-pilot-plan form');await expect(form).toBeVisible();
 await form.locator('[name=mint]').fill('Gv3uSJu2Ki7eqC6V4H1Fc31MMXLih6TJR19a5sydPfr7');
 await form.locator('[name=start]').fill('2026-11-10T18:00');await form.getByRole('button',{name:'Save local plan'}).click();
 await expect(page.locator('[data-plan-events] li')).toHaveCount(3);await expect(page.locator('[data-plan-status]')).toContainText('Nothing has been published');
 await page.reload();await expect(page.locator('[data-plan-events] li')).toHaveCount(3);
 await expect(page.locator('body')).toHaveClass(/page-route-community-pilot/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('pilot.png'),animations:'disabled'});
});
