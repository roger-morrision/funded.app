import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

test.beforeEach(async ({page})=>{
  await page.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/fee-policy'
    ?route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}})
    :route.fulfill({status:503,json:{error:'Offline skip-link fixture'}}));
  await page.route('https://**/*',route=>route.abort());
});

const visibleFocus=page=>page.evaluate(()=>{
  const active=document.activeElement,box=active.getBoundingClientRect();
  return {id:active.id,insideSidebar:document.querySelector('#sidebar').contains(active),
    top:box.top,bottom:box.bottom,left:box.left,right:box.right,width:innerWidth,height:innerHeight,
    overflow:document.documentElement.scrollWidth>innerWidth};
});

test('skip bypasses navigation without replacing Explore or a nested Docs article',async ({page})=>{
  for(const [width,height,route,heading,content] of [
    [390,844,'explore','Explore tokens','#explore'],
    [1440,900,'explore','Explore tokens','#explore'],
    [390,844,'docs/trading','Buying and selling','#docs-guide-article'],
    [1440,900,'docs/trading','Buying and selling','#docs-guide-article'],
  ]){
    await page.setViewportSize({width,height});
    await page.goto('/#overview');
    await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await page.evaluate(value=>{location.hash=`#${value}`;},route);
    await expect(page.locator(`${content} h1`).first()).toHaveText(heading);
    const url=page.url(),historyLength=await page.evaluate(()=>history.length);
    const skip=page.locator('.skip-link');
    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(url);
    await expect(page.locator(`${content} h1`).first()).toHaveText(heading);
    expect(await page.evaluate(()=>history.length)).toBe(historyLength);
    let focus=await visibleFocus(page);
    expect(focus.insideSidebar).toBe(false);
    expect(focus.top).toBeGreaterThanOrEqual(0);
    expect(focus.bottom).toBeLessThanOrEqual(height);
    expect(focus.overflow).toBe(false);
    expect(await page.evaluate(selector=>document.querySelector(selector).contains(document.activeElement),content)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(selector=>document.querySelector(selector).contains(document.activeElement),content)).toBe(true);
    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(url);
    await skip.focus();
    await skip.click();
    await expect(page).toHaveURL(url);
    focus=await visibleFocus(page);
    expect(focus.overflow).toBe(false);
    await page.goBack();
    await expect(page).toHaveURL(/#overview$/);
  }
});

test('skip preserves unsaved launch fields and a direct token path',async ({page})=>{
  for(const [width,height] of [[390,844],[1440,900]]){
    await page.setViewportSize({width,height});
    await page.goto('/#launch');
    await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await expect(page.locator('#launch-route-shell')).toBeVisible();
    await expect(page.locator('#token-name')).toBeVisible();
    await page.locator('#token-name').fill('Unsaved QA Draft');
    await page.locator('#token-symbol').fill('QADEMO');
    await expect(page.locator('#token-name')).toHaveValue('Unsaved QA Draft');
    await expect(page.locator('#token-symbol')).toHaveValue('QADEMO');
    await page.locator('.skip-link').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#launch$/);
    await expect(page.locator('#token-name')).toHaveValue('Unsaved QA Draft');
    await expect(page.locator('#token-symbol')).toHaveValue('QADEMO');
    await expect(page.locator('#launch-route-title')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(()=>document.querySelector('#launch-route-shell').contains(document.activeElement))).toBe(true);

    const token='/token/11111111111111111111111111111111?source=skip-qa';
    await page.goto(token,{waitUntil:'domcontentloaded'});
    await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await expect(page.locator('#coin-page')).toBeVisible();
    await page.locator('.skip-link').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${token.replace('?','\\?')}$`));
    await expect(page.locator('#coin-page-title')).toBeFocused();
    const focus=await visibleFocus(page);
    expect(focus.top).toBeGreaterThanOrEqual(0);
    expect(focus.bottom).toBeLessThanOrEqual(height);
    expect(focus.overflow).toBe(false);
  }
});
