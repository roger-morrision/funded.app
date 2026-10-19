import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

test.beforeEach(async ({page})=>{
  await page.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/fee-policy'
    ?route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}})
    :route.fulfill({status:503,json:{error:'Offline navigation fixture'}}));
  await page.route('https://**/*',route=>route.abort());
});

test('closed mobile navigation is absent from keyboard and accessibility navigation', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const sidebar=page.locator('#sidebar'),opener=page.locator('#open-menu');
  await expect(sidebar).toHaveAttribute('inert','');
  await expect(sidebar).toHaveAttribute('aria-hidden','true');
  await expect(page.getByRole('link',{name:'funded.vip home'})).toHaveCount(0);
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>document.querySelector('#sidebar').contains(document.activeElement))).toBe(false);
  await opener.focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(()=>document.querySelector('#sidebar').contains(document.activeElement))).toBe(false);
  await opener.focus();
  await opener.click();
  await expect(sidebar).not.toHaveAttribute('inert','');
  await expect(page.getByRole('link',{name:'funded.vip home'})).toHaveCount(1);
  await expect(page.locator('#close-menu')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await expect(sidebar).toHaveAttribute('inert','');
  await expect(page.getByRole('link',{name:'funded.vip home'})).toHaveCount(0);
});

test('mobile close paths and breakpoint changes retain visible focus and navigation', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const sidebar=page.locator('#sidebar'),opener=page.locator('#open-menu');
  for(const close of ['button','backdrop','route','same-route']){
    await opener.click();
    await expect(page.locator('#close-menu')).toBeFocused();
    if(close==='button')await page.locator('#close-menu').click();
    if(close==='backdrop')await page.locator('#menu-backdrop').click({position:{x:350,y:100}});
    if(close==='route')await sidebar.getByRole('link',{name:'Rewards',exact:true}).click();
    if(close==='same-route')await sidebar.getByRole('link',{name:'Rewards',exact:true}).click();
    await expect(opener).toHaveAttribute('aria-expanded','false');
    await expect(sidebar).toHaveAttribute('inert','');
    await expect(page.locator('body')).not.toHaveClass(/menu-open/);
    if(close==='route'||close==='same-route')
      await expect(page.locator('#payments h1').first()).toBeFocused();
    expect(await page.evaluate(()=>{
      const focus=document.activeElement,box=focus.getBoundingClientRect();
      return !document.querySelector('#sidebar').contains(focus)&&box.width>0&&box.left>=0&&box.left<innerWidth;
    })).toBe(true);
  }
  await opener.click();
  await page.locator('.nav-more summary').click();
  await expect(page.locator('.nav-more')).toHaveAttribute('open','');
  await page.setViewportSize({width:1440,height:900});
  await expect(sidebar).not.toHaveAttribute('inert','');
  await expect(sidebar).not.toHaveAttribute('aria-hidden','true');
  await expect(page.getByRole('link',{name:'funded.vip home'})).toHaveCount(1);
  await expect(page.locator('body')).not.toHaveClass(/menu-open/);
  await expect(sidebar.getByRole('link',{name:'Rewards',exact:true})).toHaveAttribute('aria-current','page');
  await sidebar.getByRole('link',{name:'funded.vip home'}).focus();
  await page.setViewportSize({width:390,height:844});
  await expect(sidebar).toHaveAttribute('inert','');
  await expect(opener).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
