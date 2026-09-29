import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output = resolve('docs/ui-evidence-2026-09-29');
await mkdir(output,{recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await context.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
const page = await context.newPage();
const failures=[], errors=[], results=[];
page.on('pageerror',error=>errors.push(error.stack || error.message));
// The test never signs or sends transactions. Block any accidental mutating endpoint.
await context.route('**/api/**',async route=>{
  const request=route.request();
  if(request.method()!=='GET' && !/\/rpc(?:\?|$)/.test(request.url())){
    return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'UI verification is read-only'})});
  }
  if(/\/rpc(?:\?|$)/.test(request.url()) && /sendTransaction|requestAirdrop/.test(request.postData()||'')){
    failures.push('Unexpected attempted financial mutation');return route.abort();
  }
  return route.continue();
});
async function check(name, callback){try{await callback();results.push({name,status:'passed'});}catch(error){failures.push(`${name}: ${error.message.split('\n')[0]}`);results.push({name,status:'failed',message:error.message.slice(0,500)});}}
async function open(route){await page.goto(`${base}/#${route}`,{waitUntil:'domcontentloaded'});await page.waitForSelector('body.workspace-ready');}
try {
  await open('overview');
  await check('Home launches above fold',async()=>{assert((await page.locator('.home-launch-board').boundingBox()).y<700);});
  await page.screenshot({path:resolve(output,'home-desktop.png'),timeout:12000});
  for(const width of [360,390,768,1024,1440]){
    await page.setViewportSize({width,height:1000});
    for(const route of ['overview','explore','launch','payments','my-launches','community','analytics-detail','referrals','airdrops','buybacks','capital-flow','docs','profile','leaderboard']){
      await open(route);
      await check(`${route} ${width}px no overflow`,async()=>{const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));});
      await check(`${route} ${width}px route isolation`,async()=>{const leaking=await page.locator('main > [data-workspace-route]').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&n.dataset.workspaceRoute!==location.hash.slice(1)).map(n=>n.textContent.slice(0,60)));assert.deepEqual(leaking,[]);});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await open('explore');
  await check('Explore results above fold',async()=>{assert((await page.locator('#asset-grid').boundingBox()).y<650);});
  await page.screenshot({path:resolve(output,'explore-desktop.png'),timeout:12000});
  await open('payments');
  await check('Rewards tab interaction and keyboard',async()=>{
    await page.getByRole('tab',{name:'Creator',exact:true}).click();assert(await page.locator('#rewards-creator').isVisible());assert(!await page.locator('#rewards-x').isVisible());
    await page.keyboard.press('ArrowRight');assert(await page.locator('#rewards-holder').isVisible());
    await page.getByRole('tab',{name:'X partner',exact:true}).click();assert(await page.locator('#x-sign-in').isVisible());
    await page.getByRole('tab',{name:'Overview',exact:true}).click();assert(await page.locator('[data-reward-open="creator"]').isVisible());
  });
  await page.screenshot({path:resolve(output,'rewards-desktop.png'),timeout:12000});
  await open('launch');
  await check('Invalid identity blocks step advancement',async()=>{await page.locator('#token-name').fill('');await page.locator('#launch-next').click();assert.equal(await page.locator('#launch-dialog').getAttribute('data-step'),'1');});
  await check('Launch settings then review; no signing',async()=>{
    await page.locator('#token-name').fill('UI review draft');await page.locator('#token-symbol').fill('UITEST');await page.locator('#launch-next').click();
    assert.equal(await page.locator('#launch-dialog').getAttribute('data-step'),'2');assert(await page.locator('#community-airdrop-tokens').isVisible());assert(!await page.locator('#token-name').isVisible());
    await page.locator('#community-airdrop-tokens').fill('1');await page.locator('#launch-next').click();assert.equal(await page.locator('#launch-dialog').getAttribute('data-step'),'2');
    await page.locator('#community-airdrop-tokens').fill('30000000');await page.locator('#launch-next').click();assert.equal(await page.locator('#launch-dialog').getAttribute('data-step'),'3');
    assert(await page.locator('#terms-agree').isVisible());assert(await page.locator('#fee-route-agree').isVisible());assert(await page.locator('#launch-button').isDisabled());
    await page.locator('#launch-back').click();assert.equal(await page.locator('#launch-dialog').getAttribute('data-step'),'2');
    await page.locator('#launch-back').click();assert.equal(await page.locator('#token-name').inputValue(),'UI review draft');
  });
  await page.screenshot({path:resolve(output,'launch-desktop.png'),timeout:12000});
  await check('Explicit public draft storage excludes approval state',async()=>{
    await page.locator('[data-draft-action="save"]').click();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('funded.public-launch-draft')));
    assert.deepEqual(Object.keys(saved).sort(),['token-name','token-symbol']);
    await page.locator('#token-name').fill('Changed name');await page.locator('[data-draft-action="restore"]').click();assert.equal(await page.locator('#token-name').inputValue(),'UI review draft');
    await page.locator('[data-draft-action="delete"]').click();assert.equal(await page.evaluate(()=>localStorage.getItem('funded.public-launch-draft')),null);
  });
  await page.setViewportSize({width:390,height:844});await open('explore');
  await check('Mobile filter controls reach 44px',async()=>{for(const selector of ['#explore-filter-toggle','[data-explore-window="24h"]','[data-explore-stage="near"]'])assert((await page.locator(selector).boundingBox()).height>=44,selector);});
  await check('Mobile filter dismissal',async()=>{await page.locator('#explore-filter-toggle').click();assert(await page.locator('#explore-filter-popover').isVisible());await page.locator('#explore-filter-close').click();assert(!await page.locator('#explore-filter-popover').isVisible());});
  await page.screenshot({path:resolve(output,'explore-mobile.png'),timeout:12000});
  await check('Mobile network label visible',async()=>assert(await page.locator('.workspace-network').isVisible()));
  // An observed Devnet mint keeps route-layout coverage independent of feed/RPC availability.
  const tokenHref=await page.locator('#asset-grid .asset-actions a[href^="/token/"]').evaluateAll(links=>links[0]?.getAttribute('href')) || '/token/9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w';
  await page.goto(new URL(tokenHref,base).href,{waitUntil:'domcontentloaded'});await page.waitForSelector('body.workspace-ready');
  await check('Mobile token trade sheet traps focus and restores it',async()=>{
    const button=page.locator('.mobile-trade-open');await button.click();
    assert.equal(await page.locator('#trade-panel').getAttribute('aria-modal'),'true');
    await page.keyboard.press('Shift+Tab');assert(await page.locator('#trade-panel').evaluate(el=>el.contains(document.activeElement)));
    assert(await page.locator('.mobile-workspace-nav').evaluate(el=>el.inert));
    assert(!(await page.locator('#trade-review-dialog').evaluate(el=>el.inert)));
    assert(!(await page.locator('#mobile-wallet-dialog').evaluate(el=>el.inert)));
    await page.locator('#trade-review-dialog').evaluate(el=>el.showModal());
    await page.locator('#trade-review-cancel').click({timeout:1500});
    assert(!(await page.locator('#trade-review-dialog').evaluate(el=>el.open)));
    await page.keyboard.press('Escape');assert.equal(await button.getAttribute('aria-expanded'),'false');assert(await button.evaluate(el=>el===document.activeElement));
    assert(!(await page.locator('.mobile-workspace-nav').evaluate(el=>el.inert)));
  });
  await page.screenshot({path:resolve(output,'token-mobile.png'),timeout:12000});
  await check('No uncaught JavaScript errors',async()=>assert.deepEqual(errors,[]));
} catch(error) {
  failures.push(`Suite interrupted: ${error.message}`);
} finally {
  await writeFile(resolve(output,'results.json'),JSON.stringify({label:'local-only; no transactions submitted',results,failures,errors},null,2));
  await browser.close();
}
console.log(JSON.stringify({passed:results.filter(x=>x.status==='passed').length,failed:failures.length,failures,output},null,2));
if(failures.length)process.exitCode=1;
