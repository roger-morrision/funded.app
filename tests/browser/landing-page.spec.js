import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/fee-policy'
    ?route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}):route.fulfill({status:503,json:{error:'Offline landing fixture'}}));
});

for(const width of[320,360,390,700,1024,1440])test(`public benefits and native FAQs work without API data at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});
  const api=[],errors=[],scripts=[];
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url());if(r.resourceType()==='script')scripts.push(r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/welcome');await expect(page.locator('.hero h1')).toContainText('Launch your token.');
  await expect(page.locator('#landing-menu-button')).not.toHaveAttribute('hidden','');
  await expect(page.locator('.reward-grid article')).toHaveCount(6);
  await expect(page.locator('.preview-notice')).toContainText('Currently on Solana Devnet');
  await expect(page.locator('.illustration-note')).toContainText('not a live token or payout');
  const sections=page.locator('.section-anchor');expect(await sections.count()).toBe(7);
  for(const section of await sections.all()){
    await section.scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  const question=page.getByText('Are rewards paid after every trade?',{exact:true}),details=question.locator('..');
  await question.focus();await page.keyboard.press('Enter');await expect(details).toHaveAttribute('open','');
  await expect(details).toContainText('cannot be awarded before rankings close');
  await page.keyboard.press('Space');await expect(details).not.toHaveAttribute('open','');await expect(question).toBeFocused();
  await page.evaluate(()=>scrollTo(0,0));
  if(width>=1000){const box=await page.locator('.landing-sidebar').boundingBox();expect(box.x).toBe(0);await expect(page.locator('.landing-mobile-nav')).toBeHidden();}
  else {await expect(page.locator('.landing-mobile-nav a')).toHaveCount(5);await expect(page.locator('.landing-mobile-nav')).toBeVisible();}
  expect(api).toEqual([]);expect(scripts.some(x=>/solana|pump-sdk|bootstrap-entry/.test(x))).toBe(false);expect(errors).toEqual([]);
  await page.screenshot({path:testInfo.outputPath(`welcome-${width}.png`),fullPage:true});
});

for(const width of[360,390])test(`mobile left drawer traps focus, closes and reaches sections at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.goto('/welcome');
  const trigger=page.getByRole('button',{name:'Open navigation'}),menu=page.getByRole('dialog',{name:'Explore funded.vip'});
  await trigger.focus();await page.keyboard.press('Enter');await expect(menu).toBeVisible();await expect(trigger).toHaveAttribute('aria-expanded','true');
  expect((await menu.boundingBox()).x).toBe(0);
  await page.keyboard.press('Shift+Tab');await expect(menu.getByRole('link',{name:'Open app'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(menu.getByRole('button',{name:'Close navigation'})).toBeFocused();
  await page.keyboard.press('Escape');await expect(menu).not.toBeVisible();await expect(trigger).toBeFocused();
  await trigger.click();await menu.getByRole('link',{name:'Community rewards',exact:true}).click();
  await expect(menu).not.toBeVisible();await expect(trigger).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#rewards')).toBeFocused();await expect(page).toHaveURL(/#rewards$/);
  const rect=await page.locator('#rewards-title').boundingBox(),header=await page.locator('.landing-topbar').boundingBox();
  expect(rect.y).toBeGreaterThanOrEqual(header.y+header.height);
  await trigger.click();await page.setViewportSize({width:1440,height:900});await expect(menu).not.toBeVisible();
  await expect(page.locator('.landing-sidebar .brand')).toBeFocused();expect(await page.evaluate(()=>getComputedStyle(document.body).overflow)).not.toBe('hidden');
});

for(const width of[390,1440])for(const[selector,hash]of[['.hero-actions .primary','#launch'],['.hero-actions .outline','#explore']])test(`landing CTA reaches ${hash} at ${width}px with offline API fixtures`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto('/welcome');await page.locator(selector).click();
  await expect(page).toHaveURL(new RegExp('/'+hash+'$'));await page.locator('body.product-flows-ready').waitFor();
  await expect(page.locator(hash==='#launch'?'#launch-form':'#explore')).toBeVisible();
});

test('landing benefits, FAQ and app links remain useful without JavaScript',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}}),page=await context.newPage();
  try{await page.route('https://**/*',r=>r.abort());await page.goto('/welcome');await expect(page.locator('h1')).toContainText('Grow your community.');
    const summary=page.getByText('Which network does the app use?',{exact:true});await summary.click();await expect(summary.locator('..').locator('p')).toBeVisible();
    await expect(page.locator('.hero-actions .primary')).toHaveAttribute('href','/#launch');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }finally{await context.close();}
});

for(const width of[390,1440])test(`app navigation opens the platform introduction at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto('/#overview');await page.locator('body.product-flows-ready').waitFor();
  if(width<1000)await page.getByRole('button',{name:'Open menu',exact:true}).click();
  const more=page.locator('.primary-nav .nav-more');if(!await more.evaluate(e=>e.open))await more.locator(':scope > summary').click();
  await page.getByRole('link',{name:'About funded.vip',exact:true}).click();await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.locator('h1')).toContainText('Launch your token.');await expect(page.locator('body')).toHaveClass('landing-page');
});

test('shortlist benefit opens the existing Favorites filter',async({page})=>{
  await page.goto('/welcome');await page.getByRole('link',{name:/Build your shortlist/}).click();
  await page.locator('body.product-flows-ready').waitFor();await expect(page.getByRole('button',{name:'Favorites',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#explore')).toBeVisible();
});
