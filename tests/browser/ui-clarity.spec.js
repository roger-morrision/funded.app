import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const mint='9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
async function setup(page,width){
  await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Mocked offline layout coverage'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
}
for(const width of [390,1440]){
  test(`discovery and portfolio keep primary tasks before helper panels at ${width}px (mocked)`,async({page})=>{
    await setup(page,width);
    await page.route('**/api/financial/activity',route=>route.fulfill({json:{cluster:'devnet',statements:Array.from({length:9},(_,i)=>({id:i.toString(16).padStart(24,'0'),creatorId:'123',text:`Fixture update ${i}`,at:new Date(Date.now()-i*1000).toISOString()}))}}));
    await page.goto('/#overview');await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
    const feed=page.locator('#personal-activity-feed');
    await expect(feed.locator('.flow-activity-row')).toHaveCount(6);
    expect(await page.evaluate(()=>document.querySelector('.home-launch-board').getBoundingClientRect().top<document.querySelector('#personal-activity-feed').getBoundingClientRect().top)).toBe(true);
    const onboarding=page.locator('#first-visit-path');await expect(onboarding).not.toHaveAttribute('open','');
    await onboarding.locator('summary').click();await expect(onboarding.getByRole('link',{name:'Explore tokens'})).toBeVisible();
    await feed.getByRole('button',{name:'Show more activity'}).click();await expect(feed.locator('.flow-activity-row')).toHaveCount(9);
    await feed.getByRole('button',{name:'Following',exact:true}).click();await expect(feed.locator('.flow-activity-row')).toHaveCount(0);await expect(feed).toContainText('Follow a creator or wallet');
    await page.goto('/#my-launches');await expect(page.locator('#launch-control-room')).toBeVisible();
    const layout=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};};return {heading:rect('#my-launches h1'),drafts:rect('#launch-control-room'),recovery:rect('#recovery-inbox'),overflow:document.documentElement.scrollWidth>innerWidth+1};});
    expect(layout.heading.y).toBeLessThan(layout.drafts.y);expect(layout.heading.y).toBeLessThan(layout.recovery.y);expect(layout.overflow).toBe(false);
    if(width>700){expect(Math.abs(layout.drafts.y-layout.recovery.y)).toBeLessThan(2);expect(Math.abs(layout.recovery.x-layout.drafts.x)).toBeGreaterThan(100);}
    else expect(Math.abs(layout.recovery.y-layout.drafts.y)).toBeGreaterThan(100);
  });
  test(`rewards distinguishes loading, anonymous actions and unavailable records at ${width}px (mocked)`,async({page})=>{
    await setup(page,width);let release;const held=new Promise(resolve=>{release=resolve;});
    await page.route('**/api/rewards/experience**',async route=>{await held;await route.fulfill({status:503,json:{error:'Unavailable fixture'}});});
    try{
      await page.goto('/#payments');const center=page.locator('#financial-center');
      await expect(center.locator('[data-flow-rows]')).toHaveAttribute('aria-busy','true');
      await expect(center).not.toContainText('No matching recorded activity');
      await expect(center.locator('.ready-queue')).toContainText('Connect your launch or recipient wallet');
      await expect(center.locator('.ready-queue')).not.toContainText('Checking this wallet');
      expect(await center.evaluate(el=>el.querySelector('h2').getBoundingClientRect().top<el.querySelector('.ready-queue h3').getBoundingClientRect().top)).toBe(true);
      release();await expect(center.locator('[data-flow-rows]')).toHaveAttribute('aria-busy','false');
      await expect(center).toContainText('Unavailable: rewards, buybacks');
      await expect(center).toContainText('Unavailable data is not a zero balance');
    }finally{release();}
  });
  test(`all public workspace routes remain readable without horizontal overflow at ${width}px (mocked offline)`,async({page})=>{
    await setup(page,width);await page.goto('/#overview');await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
    for(const route of ['overview','explore','launch','my-launches','payments','capital-flow','analytics-detail','referrals','airdrops','leaderboard','paid','list','docs','creators','profile','privacy','marketing-agency']){
      await page.evaluate(route=>{location.hash=route;},route);
      await expect(page.locator('body')).toHaveClass(route==='creators'?/support-view-active/:new RegExp(`page-route-${route}(?: |$)`));
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route).toBe(true);
      const title=page.locator('#main-content h1:visible').first();await expect(title,route).toBeVisible();
      expect(await title.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),route).toBeGreaterThanOrEqual(27);
    }
    for(const path of [`/token/${mint}`,`/wallet/${mint}`,'/admin.html']){
      await page.goto(path);await expect(page.locator(path==='/admin.html'?'#auth-panel':'body.product-flows-ready')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),path).toBe(true);
    }
  });
}
