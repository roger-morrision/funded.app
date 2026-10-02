import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output=resolve(process.env.UI_EVIDENCE_DIR || '.tmp-ui-evidence/infographic-posters');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
await context.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
await context.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const coverage={payments:'rewards',airdrops:'airdrops',buybacks:'burn',paid:'fees',docs:'docs',privacy:'privacy','my-launches':'pilot',referrals:'referrals'};
const flowAssets={payments:'holder-rewards-flow-v1.webp',paid:'fee-distribution-flow-v1.webp'};
const results=[];
try {
  for(const width of [390,1440]) {
    await page.setViewportSize({width,height:900});
    await page.goto(`${base}/#explore`,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('body.workspace-ready');
    assert.equal(await page.locator('[data-infographic-poster="explore"]').count(),0,'Explore has no market-data poster');
    assert(await page.locator('#scanner-note').evaluate(note=>note.classList.contains('sr-only')),'Explore keeps its table explanation for screen readers');
    results.push({route:'explore',width,posterRemoved:true});
    for(const [route,key] of Object.entries(coverage)) {
      await page.goto(`${base}/#${route}`,{waitUntil:'domcontentloaded'});
      await page.waitForSelector('body.workspace-ready');
      const guide=page.locator(`.page-cleanup-guide[data-guide="${key}"]`).first();
      await guide.waitFor({state:'visible',timeout:10000});
      if(await guide.evaluate(element=>element.open)) await guide.locator(':scope > summary').click();
      assert.equal(await guide.evaluate(element=>element.open),false,`${route} guide starts collapsed`);
      await guide.locator(':scope > summary').click();
      const poster=guide.locator(`[data-infographic-poster="${key}"]`);
      await poster.waitFor({state:'visible',timeout:10000});
      assert.equal(await poster.locator('.infographic-poster-step').count(),3,`${route} step count`);
      const art=poster.locator('.infographic-poster-art img');
      await art.scrollIntoViewIfNeeded();
      await art.evaluate((image,expected)=>new Promise((resolve,reject)=>{
        if(!image.src.endsWith(expected)) return reject(new Error('Expected optimized poster image asset'));
        if(image.complete) return image.naturalWidth>1000?resolve():reject(new Error('Poster image failed to load'));
        image.addEventListener('load',()=>image.naturalWidth>1000?resolve():reject(new Error('Poster image too small')),{once:true});
        image.addEventListener('error',()=>reject(new Error('Poster image failed to load')),{once:true});
      }),flowAssets[route]||'-labeled.webp');
      await poster.locator('.infographic-poster-mark img').evaluate(image=>new Promise((resolve,reject)=>{
        if(image.complete) return image.naturalWidth>0?resolve():reject(new Error('Wolf mark failed to load'));
        image.addEventListener('load',()=>resolve(),{once:true});
        image.addEventListener('error',()=>reject(new Error('Wolf mark failed to load')),{once:true});
      }));
      const summary=poster.locator('summary');
      if(width===390) assert(!(await poster.locator('.infographic-poster-details').evaluate(element=>element.open)),`${route} default disclosure`);
      else await poster.locator('.infographic-poster-details').evaluate(element=>{element.open=false;});
      await summary.click();
      const explanation=await poster.locator('.infographic-poster-details').innerText();
      assert(explanation.length>100,`${route} full explanation missing`);
      const layout=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      assert(layout.document<=layout.viewport+1,`${route} ${width}px overflow: ${JSON.stringify(layout)}`);
      results.push({route,width,steps:3,fullExplanation:true});
      if(route==='privacy') {
        const visitsGuide=page.locator('.page-cleanup-guide[data-guide="visits"]');
        if(!(await visitsGuide.evaluate(element=>element.open))) await visitsGuide.locator(':scope > summary').click();
        const visits=visitsGuide.locator('[data-infographic-poster="visits"]');
        assert(await visits.isVisible(),'Share visit poster missing');
        assert.equal(await visits.locator('.infographic-poster-step').count(),3);
        const visitsArt=visits.locator('.infographic-poster-art img');
        await visitsArt.scrollIntoViewIfNeeded();
        await visitsArt.evaluate(image=>new Promise((resolve,reject)=>{
          if(!image.src.endsWith('-labeled.webp')) return reject(new Error('Expected optimized share visit image'));
          if(image.complete) return image.naturalWidth>1000?resolve():reject(new Error('Share visit poster image failed to load'));
          image.addEventListener('load',resolve,{once:true});
          image.addEventListener('error',()=>reject(new Error('Share visit poster image failed to load')),{once:true});
        }));
        await visits.locator('summary').click();
        assert((await visits.locator('.infographic-poster-details').innerText()).includes('one-way ID'));
        await visits.locator('summary').click();
        results.push({route:'privacy visits',width,steps:3,fullExplanation:true});
        if(width===390){await visits.scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,'privacy-visits-mobile.png'),timeout:12000});}
      }
      if(width===390 && ['payments','airdrops','privacy','docs','paid'].includes(route)) {
        await summary.click();
        await poster.scrollIntoViewIfNeeded();
        await page.screenshot({path:resolve(output,`${route}-mobile.png`),timeout:12000});
      }
      if(width===1440 && ['payments','docs','paid'].includes(route)) {
        await summary.click();
        await poster.scrollIntoViewIfNeeded();
        await page.screenshot({path:resolve(output,`${route}-desktop.png`),timeout:12000});
      }
    }
  }
  assert.deepEqual(errors,[]);
} finally {
  await writeFile(resolve(output,'results.json'),JSON.stringify({label:'read-only UI; no transactions submitted',results,errors},null,2));
  await browser.close();
}
console.log(JSON.stringify({checked:results.length,errors,output},null,2));
