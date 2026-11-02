import {test,expect} from '@playwright/test';
const policy={revision:6,split:{operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10}};
for(const width of [320,390,901,1440])test(`all left-menu destinations remain directly available at ${width}px`,async({page,baseURL},info)=>{
  await page.setViewportSize({width,height:620});
  await page.addInitScript(()=>{localStorage.removeItem('funded.sidebar.collapsed');sessionStorage.setItem('funded.app.wallet.manual-disconnect','1');});
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(baseURL).origin&&r.request().method()==='GET'?r.fallback():r.abort());
  await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Mocked menu-layout fixture'}}));
  await page.route('**/api/fee-policy',r=>r.fulfill({json:policy}));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/#launch');await page.locator('body.product-flows-ready').waitFor();
  const sidebar=page.locator('#sidebar'),nav=sidebar.getByRole('navigation',{name:'Primary navigation'}),links=nav.locator('.nav-more-menu a.nav-item:not([href="#marketing-agency"])');
  if(width<=700)await page.locator('#open-menu').click();
  await expect(nav.locator('details,summary')).toHaveCount(0);await expect(links).toHaveCount(11);
  for(const link of await links.all()){
    await expect(link).toBeVisible();await expect(link.locator('.nav-icon svg')).toHaveCount(1);await link.focus();await expect(link).toBeFocused();
    await expect.poll(()=>link.evaluate(e=>{const r=e.getBoundingClientRect(),n=e.closest('.primary-nav').getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=n.top-1&&r.bottom<=n.bottom+1&&e.contains(hit);})).toBe(true);
    expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(width<=700?44:40);
  }
  await links.first().focus();await page.keyboard.press('Tab');await expect(links.nth(1)).toBeFocused();
  await nav.locator('a[href="#bonuses"]').click();await expect(page.locator('body')).toHaveClass(/page-route-bonuses/);
  if(width<=700)await page.locator('#open-menu').click();await expect(nav.locator('a[href="#bonuses"]')).toHaveAttribute('aria-current','page');
  await nav.locator('a[href="#docs"]').click();await expect(page.locator('body')).toHaveClass(/page-route-docs/);
  if(width<=700){await expect(sidebar).toHaveAttribute('inert','');await page.locator('#open-menu').click();}
  await expect(nav.locator('a[href="#docs"]')).toHaveAttribute('aria-current','page');await expect(links).toHaveCount(11);
  if(width>700){
    await page.locator('#desktop-sidebar-toggle').click();await expect(sidebar).toHaveCSS('width','76px');
    for(const link of await links.all()){await expect(link.locator('.nav-icon')).toBeVisible();await link.focus();await expect(link).toBeFocused();}
    await page.locator('#desktop-sidebar-toggle').click();
  }else{
    await page.keyboard.press('Escape');await expect(sidebar).toHaveAttribute('inert','');await expect(page.locator('#open-menu')).toBeFocused();await page.locator('#open-menu').click();
  }
  await nav.locator('a[href="#analytics-detail"]').scrollIntoViewIfNeeded();await sidebar.screenshot({path:info.outputPath(`expanded-menu-${width}.png`)});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});
