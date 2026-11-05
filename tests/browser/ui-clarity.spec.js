import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const mint='9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
async function setup(page,width,baseURL){
  await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(baseURL).origin&&route.request().method()==='GET'?route.fallback():route.abort());
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Mocked offline layout coverage'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
}
for(const width of [390,1440]){
  test(`discovery and portfolio keep primary tasks before helper panels at ${width}px (mocked)`,async({page,baseURL})=>{
    await setup(page,width,baseURL);
    await page.goto('/#overview');await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
    await expect(page.locator('.home-launch-board')).toBeVisible();
    await page.goto('/#my-launches');await expect(page.locator('#launch-control-room')).toHaveCount(0);await expect(page.locator('#recovery-inbox')).toBeHidden();
    await expect(page.locator('[data-portfolio-tab="holdings"]')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  });
  test(`rewards distinguishes loading, anonymous actions and unavailable records at ${width}px (mocked)`,async({page,baseURL})=>{
    await setup(page,width,baseURL);let release;const held=new Promise(resolve=>{release=resolve;});
    await page.route('**/api/rewards/experience**',async route=>{await held;await route.fulfill({status:503,json:{error:'Unavailable fixture'}});});
    try{
      await page.goto('/#payments');const center=page.locator('#financial-center');
      await expect(center.locator('[data-flow-rows]')).toHaveAttribute('aria-busy','true');
      await expect(center).not.toContainText('No matching recorded activity');
      await expect(center.locator('.ready-queue')).toBeHidden();await expect(page.locator('#reward-portfolio').getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible();
      release();await expect(center.locator('[data-flow-rows]')).toHaveAttribute('aria-busy','false');
      await expect(center).toContainText('Connect a wallet to see your activity.');await center.locator('[data-flow-scope-filter]').selectOption('protocol');await expect(center).toContainText('Unavailable: buybacks');
      await expect(center).toContainText('Unavailable data is not a zero balance');await expect(center.locator('[data-flow-count]')).toHaveText('Records unavailable');await expect(center.locator('.financial-list-footer')).toBeHidden();
      const connect=page.locator('#reward-portfolio .reward-portfolio-connect');await connect.focus();const original=await connect.elementHandle();await page.evaluate(()=>window.dispatchEvent(new Event('funded:reward-identity-change')));await expect(center.locator('[data-flow-rows]')).toHaveAttribute('aria-busy','false');expect(await original.evaluate(e=>e.isConnected&&e===document.activeElement)).toBe(true);
    }finally{release();}
  });
  test(`all public workspace routes remain readable without horizontal overflow at ${width}px (mocked offline)`,async({page,baseURL})=>{
    await setup(page,width,baseURL);await page.goto('/#overview');await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
    for(const route of ['overview','explore','launch','my-launches','payments','capital-flow','analytics-detail','referrals','airdrops','leaderboard','paid','list','docs','creators','profile','privacy','marketing-agency']){
      await page.evaluate(route=>{location.hash=route;},route);
      await expect(page.locator('body')).toHaveClass(route==='creators'?/support-view-active/:new RegExp(`page-route-${route}(?: |$)`));
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route).toBe(true);
      if(route==='referrals'){await expect(page.locator('#referral-share-native')).toBeHidden();await expect(page.locator('#referral-copy-code')).toBeHidden();await expect(page.locator('#referral-command-center [data-copy-referral-link]')).toBeVisible();}
      const title=page.locator('#main-content h1:visible').first();await expect(title,route).toBeVisible();
      expect(await title.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),route).toBeGreaterThanOrEqual(width<700?24:27);
      expect(await title.evaluate(el=>Number(getComputedStyle(el).fontWeight)),route).toBeLessThanOrEqual(700);
      expect(await title.evaluate(el=>getComputedStyle(el).fontFamily),route).toMatch(/Arial.*sans-serif/);
    }
    for(const path of [`/token/${mint}`,`/wallet/${mint}`,'/admin.html']){
      await page.goto(path);await expect(page.locator(path==='/admin.html'?'#auth-panel':'body.product-flows-ready')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),path).toBe(true);
    }
  });
}
