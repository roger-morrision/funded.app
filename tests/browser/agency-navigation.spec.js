import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const mint='9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
test.beforeEach(async({page})=>{
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/fee-policy'
    ?route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}):route.fulfill({status:503,json:{error:'Offline navigation fixture'}}));
});
for(const width of [1918,1440,1180,1179,1024,901,390,320]){
  test(`left navigation stays fixed across routes and reloads at ${width}px (mocked APIs)`,async({page},testInfo)=>{
    test.setTimeout(60000);
    await page.setViewportSize({width,height:900});
    const check=async()=>{
      await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
      if(width<=700){
        await expect(page.locator('#sidebar')).toHaveAttribute('inert','');
        await page.locator('#open-menu').click();await expect(page.locator('#sidebar')).toBeVisible();
        await expect.poll(()=>page.locator('#sidebar').evaluate(element=>element.getBoundingClientRect().x)).toBe(0);
      }else{
        await expect(page.locator('#sidebar')).not.toHaveAttribute('inert','');
        await expect(page.locator('#sidebar')).not.toHaveAttribute('aria-hidden','true');
      }
      const geometry=await page.evaluate(()=>{
        const sidebar=document.querySelector('#sidebar'),rail=sidebar.getBoundingClientRect(),main=document.querySelector('#main-content').getBoundingClientRect(),style=getComputedStyle(sidebar);
        return {x:rail.x,y:rail.y,width:Math.round(rail.width),height:Math.round(rail.height),direction:style.flexDirection,position:style.position,contentLeft:main.x,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      expect(geometry).toEqual({x:0,y:0,width:width<=700?280:220,height:900,direction:'column',position:'fixed',contentLeft:width<=700?0:220,overflow:false});
      await expect(page.locator('#sidebar a[href="#launch"]')).toBeVisible();
      if(width<=700){
        await expect(page.locator('.mobile-workspace-nav a').first()).not.toBeVisible();
        const token=await page.locator('body').evaluate(body=>body.classList.contains('page-route-coin'));
        if(!token)await expect(page.locator('.mobile-workspace-nav')).not.toBeVisible();
        else expect(await page.locator('.mobile-workspace-nav').evaluate(nav=>{const box=nav.getBoundingClientRect();return box.left===0&&box.right<=innerWidth;})).toBe(true);
        await page.locator('#close-menu').click();await expect(page.locator('#sidebar')).toHaveAttribute('inert','');
      }
    };
    await page.goto('/#marketing-agency');await check();
    await expect(page.locator('[data-agency-status]')).toContainText('unavailable');
    for(const route of ['overview','explore','launch','my-launches','payments','marketing-agency']){
      if(width<=700)await page.locator('#open-menu').click();
      await page.locator(`.primary-nav > a[href="#${route}"]`).click();await expect(page.locator('body')).toHaveClass(new RegExp(`page-route-${route}(?: |$)`));await check();
      await expect(page.locator(`.primary-nav > a[href="#${route}"]`)).toHaveAttribute('aria-current','page');
    }
    await page.screenshot({path:testInfo.outputPath('left-navigation.png')});
    await page.reload();await check();
    await page.goto(`/token/${mint}`);await check();
    if(width<=700)await page.locator('#open-menu').click();
    await page.locator('.primary-nav > a[href="#overview"]').click();await check();
    await page.goBack();await expect(page).toHaveURL(new RegExp(`/token/${mint}$`));await check();
    await page.goto(`/wallet/${mint}`);await check();
    if(width>700){
      await page.locator('#desktop-sidebar-toggle').click();await expect(page.locator('#sidebar')).toHaveCSS('width','76px');
      await expect(page.locator('#main-content')).toHaveCSS('margin-left','76px');
      await page.reload();await expect(page.locator('#sidebar')).toHaveCSS('width','76px');
      await page.locator('#desktop-sidebar-toggle').click();await check();
    }
    if(width<=700)await page.locator('#open-menu').click();
    await page.locator('.nav-more > summary').click();await expect(page.locator('.nav-more-menu')).toBeVisible();
    await page.locator('.nav-more a[href="#docs"]').click();await expect(page.locator('body')).toHaveClass(/page-route-docs/);await check();
    await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
    expect(await page.locator('#sidebar').evaluate(element=>element.getBoundingClientRect().top)).toBe(0);
  });
}
for(const width of [1440,390,320])test(`admin shares the left menu at ${width}px (mocked APIs)`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto('/admin.html');
  const expected=width>700?220:280;
  if(width<=700){await expect(page.locator('#sidebar')).toHaveAttribute('inert','');await page.locator('#open-menu').click();await expect(page.locator('#sidebar')).toBeVisible();}
  await expect(page.locator('#sidebar')).toHaveCSS('width',`${expected}px`);
  await expect.poll(()=>page.locator('#sidebar').evaluate(element=>element.getBoundingClientRect().x)).toBe(0);
  expect(await page.locator('#sidebar').evaluate(element=>element.getBoundingClientRect().x)).toBe(0);
  await expect(page.locator('#sidebar a[aria-current="page"]')).toHaveText('Admin');
  await expect(page.locator('#sidebar a[href="/#launch"]')).toBeVisible();
  await expect(page.locator('#auth-panel')).toBeVisible();
  expect(await page.locator('#main-content').evaluate(element=>element.getBoundingClientRect().left)).toBe(width>700?220:0);
  if(width<=700){await page.keyboard.press('Escape');await expect(page.locator('#open-menu')).toBeFocused();await expect(page.locator('#sidebar')).toHaveAttribute('inert','');}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
