import {test,expect} from '@playwright/test';
const feePolicy={revision:6,split:{operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10}};

test.beforeEach(async({page,baseURL})=>{
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('**/*',r=>{
    const q=r.request(),url=new URL(q.url());if(url.origin!==new URL(baseURL).origin)return r.abort();
    if(url.pathname.startsWith('/api/'))return url.pathname==='/api/fee-policy'?r.fulfill({json:feePolicy}):r.fulfill({status:503,json:{error:'Offline diagram fixture'}});
    return q.method()==='GET'?r.continue():r.abort();
  });
});
const routes=[['/welcome','about-capital-flow'],['/#capital-flow','capital-flow-landscape']];
async function open(page,path){await page.goto(path);if(path!=='/welcome'){await page.locator('body.product-flows-ready').waitFor();await page.locator('#capital-flow-guide > summary').click();}const figure=page.locator('[data-flow-diagram]');await expect(figure).toBeVisible();await expect(figure).toHaveAttribute('data-diagram-state','paused');return figure;}

for(const width of[320,390,1440])test(`capital flow keeps the calculator before the optional diagram at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/#capital-flow');await page.locator('body.product-flows-ready').waitFor();
  const guide=page.locator('#capital-flow-guide'),summary=guide.locator(':scope > summary'),figure=guide.locator('[data-flow-diagram]');
  await expect(guide).toHaveCount(1);await expect(guide).not.toHaveAttribute('open','');await expect(figure).toBeHidden();
  const before=await page.locator('.capital-flow-layout').evaluate(e=>Boolean(e.compareDocumentPosition(document.getElementById('capital-flow-guide'))&Node.DOCUMENT_POSITION_FOLLOWING));expect(before).toBe(true);
  await page.locator('#fee-flow-input').fill('250');for(const[key,value]of Object.entries({creator:200,operations:20,referrals:2.5,community:10,buyback:12.5,agency:5}))await expect(page.locator(`#fee-output-${key}`)).toHaveText(`${value} SOL`);
  await page.screenshot({path:info.outputPath(`capital-flow-compact-${width}.png`),fullPage:true});
  await summary.focus();await page.keyboard.press('Enter');await expect(guide).toHaveAttribute('open','');await expect(figure).toBeVisible();await expect(figure).toHaveAttribute('data-diagram-state','paused');await figure.getByRole('button',{name:'Play animation',exact:true}).click();await expect(figure).toHaveAttribute('data-diagram-state','playing');
  await summary.focus();await page.keyboard.press('Space');await expect(guide).not.toHaveAttribute('open','');await expect(summary).toBeFocused();await expect(figure).toHaveAttribute('data-diagram-state','paused');
  await page.evaluate(()=>{location.hash='explore';});await expect(page.locator('body')).toHaveClass(/page-route-explore/);await page.evaluate(()=>{location.hash='capital-flow';});await expect(guide).not.toHaveAttribute('open','');await expect(guide).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

async function focusClearsNavigation(region){return region.evaluate(e=>{
  const r=e.getBoundingClientRect(),c=getComputedStyle(e),outline=(parseFloat(c.outlineWidth)||0)+Math.max(0,parseFloat(c.outlineOffset)||0);
  const header=document.querySelector('.landing-topbar,.topbar'),nav=document.querySelector('.landing-mobile-nav,.mobile-workspace-nav');
  const top=Math.max(0,header?.getClientRects().length?header.getBoundingClientRect().bottom:0),bottom=nav?.getClientRects().length?nav.getBoundingClientRect().top:innerHeight;
  return r.top-outline>=top-1&&r.bottom+outline<=bottom+1;
});}

async function scrollWithKey(page,region,key,axis){
  // Finish one native scroll before switching axes; Chromium can coalesce rapid arrow keys.
  await region.evaluate(e=>{e.testScrollEnded=new Promise(resolve=>e.addEventListener('scrollend',()=>resolve(),{once:true}));});
  await page.keyboard.press(key);await expect.poll(()=>region.evaluate((e,axis)=>e[axis],axis)).toBeGreaterThan(0);
  await region.evaluate(e=>e.testScrollEnded);
}

for(const[width,height]of[[360,480],[844,390],[1440,500]])for(const[path]of routes)test(`diagram focus and native scrolling fit a short ${width}x${height} viewport at ${path}`,async({page})=>{
  await page.setViewportSize({width,height});await page.emulateMedia({reducedMotion:'reduce'});const figure=await open(page,path),region=figure.getByRole('region');
  await expect.poll(()=>figure.locator('img').evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
  await region.focus();await expect(region).toBeFocused();await expect.poll(()=>focusClearsNavigation(region)).toBe(true);
  if(await region.evaluate(e=>e.scrollWidth>e.clientWidth))await scrollWithKey(page,region,'ArrowRight','scrollLeft');
  expect(await region.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);await scrollWithKey(page,region,'ArrowDown','scrollTop');
  expect(await focusClearsNavigation(region)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const[path]of routes)test(`the fee flow has a compact native text alternative at ${path}`,async({page})=>{
  await page.setViewportSize({width:360,height:480});const figure=await open(page,path),guide=page.locator('.flow-text-guide'),summary=guide.locator('summary');
  expect(await figure.locator('.flow-text-guide').count()).toBe(0);await expect(guide).not.toHaveAttribute('open','');expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await summary.focus();await page.keyboard.press('Enter');await expect(guide).toHaveAttribute('open','');await expect(summary).toBeFocused();
  await expect(guide.locator('li')).toHaveCount(4);await expect(guide).toContainText('Ranked bonus windows must close');await expect(guide).toContainText('separate paths');
  for(const step of await guide.locator('li').all()){await step.scrollIntoViewIfNeeded();await expect(step).toBeVisible();expect(await step.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})).toBe(true);}
  await summary.focus();await page.keyboard.press('Space');await expect(guide).not.toHaveAttribute('open','');await expect(summary).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const width of[360,390,1440])for(const[path,asset]of routes)test(`diagram remains readable, pans natively and plays on request at ${path} ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'no-preference'});const figure=await open(page,path),image=figure.locator('img'),region=figure.getByRole('region');
  await expect(image).toHaveAttribute('src',`/${asset}-static.svg`);await expect.poll(()=>image.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
  await expect(region).toHaveAttribute('tabindex','0');expect(await region.getAttribute('aria-label')).toBeTruthy();
  if(width<1000){expect(await region.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);await region.focus();await expect(region).toBeFocused();await expect.poll(()=>focusClearsNavigation(region)).toBe(true);await page.keyboard.press('ArrowRight');await expect.poll(()=>region.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);}
  await figure.getByRole('button',{name:'Play animation',exact:true}).click();await expect(figure).toHaveAttribute('data-diagram-state','playing');await expect(image).toHaveAttribute('src',`/${asset}.svg`);
  await expect.poll(()=>image.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
  await figure.getByRole('button',{name:'Pause animation',exact:true}).click();await expect(figure).toHaveAttribute('data-diagram-state','paused');await expect(image).toHaveAttribute('src',`/${asset}-static.svg`);
  const full=figure.getByRole('link',{name:/View full diagram/});await expect(full).toHaveAttribute('href',`/${asset}-static.svg`);await expect(full).toHaveAttribute('target','_blank');
  expect((await full.boundingBox()).height).toBeGreaterThanOrEqual(44);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const[path,asset]of routes)test(`diagram respects reduced motion and retains focus when the setting changes at ${path}`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});const figure=await open(page,path),image=figure.locator('img'),button=figure.locator('[data-diagram-motion]'),full=figure.getByRole('link',{name:/View full diagram/});
  await expect(button).toBeHidden();await expect(image).toHaveAttribute('src',`/${asset}-static.svg`);
  await page.emulateMedia({reducedMotion:'no-preference'});await expect(button).toBeVisible();await button.focus();await page.keyboard.press('Enter');await expect(figure).toHaveAttribute('data-diagram-state','playing');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(figure).toHaveAttribute('data-diagram-state','paused');await expect(image).toHaveAttribute('src',`/${asset}-static.svg`);await expect(button).toBeHidden();await expect(full).toBeFocused();
});

for(const[path,asset]of routes)test(`diagram pauses when leaving its view at ${path}`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'no-preference'});const figure=await open(page,path);await figure.getByRole('button',{name:'Play animation',exact:true}).click();await expect(figure).toHaveAttribute('data-diagram-state','playing');
  if(path==='/welcome')await page.locator('#hero-title').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));
  else await page.locator('.mobile-workspace-nav a[href="#explore"]').click();
  await expect(figure).toHaveAttribute('data-diagram-state','paused');await expect(figure.locator('img')).toHaveAttribute('src',`/${asset}-static.svg`);
});

test('the landing diagram remains static, scrollable and opens at full size without JavaScript',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,javaScriptEnabled:false,viewport:{width:390,height:844}}),page=await context.newPage();
  try{await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(baseURL).origin&&r.request().method()==='GET'&&!new URL(r.request().url()).pathname.startsWith('/api/')?r.continue():r.abort());await page.goto('/welcome');
    const figure=page.locator('[data-flow-diagram]'),region=figure.getByRole('region');await expect(figure.locator('[data-diagram-motion]')).toBeHidden();await expect(figure.locator('img')).toHaveAttribute('src','/about-capital-flow-static.svg');
    await region.focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>region.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);
    const guide=page.locator('.flow-text-guide'),summary=guide.locator('summary');await summary.focus();await page.keyboard.press('Enter');await expect(guide).toHaveAttribute('open','');await expect(guide.locator('li')).toHaveCount(4);await expect(guide).toContainText('Ranked bonus windows must close');await page.keyboard.press('Space');await expect(guide).not.toHaveAttribute('open','');
    const popupPromise=context.waitForEvent('page');await figure.getByRole('link',{name:/View full diagram/}).click();const popup=await popupPromise;await popup.waitForLoadState();await expect(popup).toHaveURL(/\/about-capital-flow-static\.svg$/);await expect(popup.locator('svg')).toBeVisible();
  }finally{await context.close();}
});

test('the app diagram opens its matching full-size static asset',async({page,context})=>{
  const figure=await open(page,'/#capital-flow'),popupPromise=context.waitForEvent('page');await figure.getByRole('link',{name:/View full diagram/}).click();const popup=await popupPromise;await popup.waitForLoadState();await expect(popup).toHaveURL(/\/capital-flow-landscape-static\.svg$/);await expect(popup.locator('svg')).toBeVisible();await popup.close();
});

for(const[path]of routes)test(`diagram animation changes rendered pixels and pause stays still at ${path}`,async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'no-preference'});const figure=await open(page,path),image=figure.locator('img');
  await figure.getByRole('button',{name:'Play animation',exact:true}).click();await expect.poll(()=>image.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
  const first=await image.screenshot();await expect.poll(async()=>!(await image.screenshot()).equals(first)).toBe(true);
  await figure.getByRole('button',{name:'Pause animation',exact:true}).click();await expect.poll(()=>image.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
  const still=await image.screenshot();for(let n=0;n<3;n++){await page.waitForTimeout(120);expect((await image.screenshot()).equals(still)).toBe(true);}
});
