import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel:'chrome', headless:true });
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const out = '.tmp-ui-evidence/concise-depth'; await mkdir(out,{recursive:true});
const checks=[];
for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
 await context.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
 await context.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({status:403,body:'Read-only UI verification'}));
 for(const route of ['overview','explore','launch','list','payments','analytics-detail','my-launches','community','referrals','leaderboard','airdrops','buybacks','capital-flow','docs','profile','privacy','paid','funded-holder-token-rewards']){
  const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/#${route}`,{waitUntil:'domcontentloaded'});await page.waitForSelector(`body.page-route-${route==='funded-holder-token-rewards'?'payments':route}.workspace-ready`,{timeout:15000});await page.waitForTimeout(500);
  assert.equal(errors.length,0,`${route} JS errors: ${errors.join('; ')}`);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} horizontal overflow at ${width}`);
  if(route==='list'){
   assert.equal(await page.locator('#list .list-steps').isVisible(),false);
   assert.equal(await page.locator('#list .list-art').isVisible(),false);
   assert(await page.locator('#list-mint').isVisible());
   await page.locator('#list .page-cleanup-guide[data-guide="list"]').waitFor({ state: 'visible', timeout: 10000 });
  }
  if(route==='analytics-detail'){
   assert.equal(await page.locator('#capital-flow').isVisible(),false);
   const rows=page.locator('#analytics-detail .recipients-panel .payment-row');
   if(await rows.count()>5){
    assert.equal(await page.locator('#analytics-detail .recipients-panel .payment-row:visible').count(),5);
    await page.locator('#analytics-detail .concise-recipient-more').click();
    assert.equal(await page.locator('#analytics-detail .recipients-panel .payment-row:visible').count(),await rows.count());
   }
  }
  if(route==='capital-flow') assert(await page.locator('#capital-flow').isVisible());
  if(route==='payments'){
   assert.equal(await page.locator('#rewards-overview .reward-entry-grid > button[data-reward-open]:visible').count(),0);
   assert.equal(await page.locator('#rewards-overview .reward-entry-grid > a:visible').count(),0);
   await page.locator('#reward-portfolio .reward-portfolio-links > a').first().waitFor({ state:'visible', timeout:10000 });
   assert.equal(await page.locator('#reward-portfolio .reward-portfolio-links > a:visible').count(),3);
   assert.equal(await page.locator('#payments .ui-tabs button:visible').count(),4);
   const rewardRows = page.locator('#reward-discovery .reward-discovery-list > article');
   if (await rewardRows.count() > 3) {
    const toggle = page.locator('#reward-discovery .concise-reward-more');
    assert(await toggle.isVisible());
    assert.equal(await page.locator('#reward-discovery .reward-discovery-list > article:visible').count(),3);
    await toggle.click();
    assert.equal(await page.locator('#reward-discovery .reward-discovery-list > article:visible').count(),await rewardRows.count());
    await toggle.click();
   }
  }
  if(route==='paid'){
   assert.equal(await page.locator('#paid > #buybacks').isVisible(),false);
   assert(await page.locator('.paid-hero-actions a[href="#buybacks"]').isVisible());
   assert((await page.locator('.paid-hero-mark').evaluate(element=>getComputedStyle(element).backgroundImage)).includes('/wolf-mark.svg'));
  }
  if(route==='buybacks'){
   const root=page.locator('#buybacks');
   assert(await root.locator('.concise-policy-preview > summary').isVisible());
   assert(await root.locator('.concise-tier-preview > summary').isVisible());
   assert(await root.locator('.burn-buy-card').count());
   assert(await root.locator('.burn-token-card').count());
   const actionY=await root.locator('.burn-center-layout').evaluate(e=>e.getBoundingClientRect().top+scrollY);
   const flowY=await root.locator('#verified-buyback-flow').evaluate(e=>e.getBoundingClientRect().top+scrollY);
   assert(actionY<flowY,'Buy/burn action should precede execution history');
   await root.locator('.concise-policy-preview > summary').click();
   assert(await root.locator('#buyback-example-fees').isVisible());
   if(route==='buybacks') await page.screenshot({path:`${out}/buybacks-${width}.png`,fullPage:true});
  }
  if(route==='paid') assert.equal(await page.locator('#paid .funded-token-story article:visible').count(),3);
  if(route==='my-launches'){
   assert.equal(await page.locator('#my-launches > #community').isVisible(),false);
   assert.equal(await page.locator('#my-launches .pilot-panel').count(),0);
  }
  if(route==='community'){
   assert(await page.locator('#community').isVisible());
   assert.equal(await page.locator('#my-launches > .section-heading').first().isVisible(),false);
   const reserve=page.locator('.concise-community-reserve');
   await reserve.locator(':scope > summary').waitFor({ state:'visible', timeout:10000 });
   await reserve.locator(':scope > summary').click();
   assert(await page.locator('#community-reward-reserve').isVisible());
   assert(await page.locator('#reward-alerts').isVisible());
  }
  if(route==='funded-holder-token-rewards'){
   const rows=page.locator('#funded-holder-token-rewards [data-funded-token-list] > li:has(.funded-token-row)');
   if(await rows.count()>4){
    assert.equal(await page.locator('#funded-holder-token-rewards [data-funded-token-list] > li:visible').count(),4);
    await page.locator('#funded-holder-token-rewards .concise-holder-more').click();
    assert.equal(await page.locator('#funded-holder-token-rewards [data-funded-token-list] > li:visible').count(),await rows.count());
   }
  }
  if(route==='payments') await page.screenshot({path:`${out}/payments-${width}.png`,fullPage:true});
  checks.push(`${route}-${width}`);await page.close();
 }
 await context.close();
}
await browser.close();console.log(`Verified ${checks.length} page/viewport combinations, rewards navigation, buy/burn disclosure and order, token story, and portfolio without pilot controls.`);
