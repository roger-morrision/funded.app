import{test,expect}from'@playwright/test';
import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';

test.beforeEach(async({page,baseURL})=>{
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());return u.origin===new URL(baseURL).origin&&(q.method()==='GET'||u.pathname.startsWith('/api/'))?r.fallback():r.abort();});
  await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Offline mobile action fixture'}}));
  await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
});

const targets=[['overview','.home-launch-tabs button'],['launch','#image-upload,#image-remove'],['payments','#reward-portfolio [data-reward-connect]'],['payments/holders','[data-reward-filter]'],['airdrops','#airdrops button'],['referrals','#referral-command-center .referral-share-tools button,#referral-claim-center button'],['capital-flow','[data-bonus-refresh]'],['bonuses','[data-bonus-history-refresh]'],['paid','.funded-token-contract button,.funded-policy-details>summary'],['buybacks','.concise-tier-preview>summary,.funded-token-contract button,.funded-policy-details>summary']];
for(const width of[320,390,700])test(`secondary actions remain tappable and compact across task pages at ${width}px`,async({page})=>{
  test.setTimeout(60000);await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#overview');await page.locator('body.product-flows-ready').waitFor();
  for(const[route,selector]of targets){
    await page.evaluate(route=>location.hash=route,route);
    const controls=page.locator(selector),visible=()=>controls.evaluateAll(nodes=>nodes.filter(e=>e.getClientRects().length&&!e.closest('[hidden]')).map(e=>{const r=e.getBoundingClientRect();return{text:e.getAttribute('aria-label')||e.textContent.trim(),width:r.width,height:r.height};}));
    await expect.poll(async()=>(await visible()).length,route).toBeGreaterThan(0);
    for(const control of await visible()){expect(control,route).toMatchObject({width:expect.any(Number),height:expect.any(Number)});expect(control.height,JSON.stringify({route,control})).toBeGreaterThanOrEqual(44);expect(control.width,JSON.stringify({route,control})).toBeGreaterThanOrEqual(44);}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route).toBe(true);
    if(route==='payments/holders'){const filter=page.locator('[data-reward-filter]');await filter.selectOption('paid');await expect(filter).toHaveValue('paid');expect(await filter.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);}
  }
});

for(const width of[390,1440])test(`FAQ rows and fee-policy disclosures support pointer and keyboard at ${width}px`,async({page})=>{
  test.setTimeout(60000);await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#referrals');await page.locator('body.product-flows-ready').waitFor();
  const faqs=page.locator('#referral-faq details');await expect(faqs).toHaveCount(6);
  for(const faq of await faqs.all()){
    const summary=faq.locator('summary');expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);await summary.focus();
    const wasOpen=await faq.evaluate(e=>e.open);await page.keyboard.press('Enter');await expect(faq).toHaveJSProperty('open',!wasOpen);await expect(summary).toBeFocused();await page.keyboard.press('Space');await expect(faq).toHaveJSProperty('open',wasOpen);
    const r=await summary.boundingBox();await summary.click({position:{x:r.width-8,y:r.height/2}});await expect(faq).toHaveJSProperty('open',!wasOpen);
  }
  for(const route of['paid','buybacks']){
    await page.evaluate(route=>location.hash=route,route);const details=page.locator('.funded-policy-details'),summary=details.locator('summary').first();await expect(summary).toBeVisible();await expect(details).toHaveClass(/advanced-details/);expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await summary.focus();await page.keyboard.press('Enter');await expect(details).toHaveAttribute('open','');await page.keyboard.press('Space');await expect(details).not.toHaveAttribute('open','');await expect(summary).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
});
