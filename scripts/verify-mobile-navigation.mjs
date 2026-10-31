import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';

const server=process.env.UI_BASE_URL?null:await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0}});
if(server)await server.listen();
const base=process.env.UI_BASE_URL||server.resolvedUrls.local[0];
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
await context.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
// Real API reads only; this check never sends a report, signs or broadcasts.
await context.route('**/api/**',route=>route.request().method()==='GET'?route.continue():route.abort());
const page=await context.newPage();
const routes=['overview','explore','launch','my-launches','payments','capital-flow','analytics-detail','docs','privacy','marketing-agency','referrals','airdrops','profile'];
async function check(label){
  await page.locator('body.product-flows-ready').waitFor();
  const state=await page.locator('#sidebar').evaluate(nav=>{
    const box=nav.getBoundingClientRect(),main=document.querySelector('#main-content').getBoundingClientRect(),style=getComputedStyle(nav);
    return {left:box.left,top:box.top,bottom:box.bottom,width:box.width,position:style.position,direction:style.flexDirection,
      inert:nav.inert,hidden:nav.getAttribute('aria-hidden'),contentLeft:main.left,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.deepEqual(state,{left:0,top:0,bottom:844,width:76,position:'fixed',direction:'column',inert:false,hidden:null,contentLeft:76,overflow:false},label);
  assert(await page.locator('#sidebar a[href="#launch"]').isVisible(),`${label}: Launch is available in the left menu`);
  assert(!await page.locator('.mobile-workspace-nav a').first().isVisible(),`${label}: site links must not move to the bottom`);
  const token=await page.locator('body').evaluate(body=>body.classList.contains('page-route-coin'));
  if(!token)assert(!await page.locator('.mobile-workspace-nav').isVisible(),`${label}: no empty bottom navigation bar`);
  else assert(await page.locator('.mobile-workspace-nav').evaluate(nav=>{const box=nav.getBoundingClientRect();return box.left===76&&box.right<=innerWidth;}),`${label}: trade actions stay beside the rail`);
}
try{
  for(const width of [320,390,644]){
    await page.setViewportSize({width,height:844});await page.goto(new URL('#overview',base).href,{waitUntil:'domcontentloaded'});
    for(const route of routes){
      await page.evaluate(next=>{location.hash=`#${next}`;},route);
      await page.waitForFunction(next=>document.body.classList.contains(`page-route-${next}`),route);
      await check(`${route} at ${width}px`);
    }
  }
  await page.setViewportSize({width:390,height:844});await page.goto(new URL('#overview',base).href);
  await check('Home');await page.locator('#sidebar a[href="#launch"]').click();await page.waitForURL('**/#launch');
  assert.equal(await page.locator('#sidebar a[href="#launch"]').getAttribute('aria-current'),'page');
  if(process.env.UI_EVIDENCE_FILE)await page.locator('#sidebar').screenshot({path:process.env.UI_EVIDENCE_FILE});
  const address='11111111111111111111111111111111';
  for(const path of ['/explore',`/token/${address}`,`/wallet/${address}`,`/launch/coin/${address}`]){
    await page.goto(new URL(path,base).href,{waitUntil:'domcontentloaded'});await check(path);
  }
  console.log(`Persistent left navigation verified on ${routes.length} routes and four direct pages at 320, 390 and 644 px; link navigation passed.`);
}finally{await browser.close();await server?.close();}
