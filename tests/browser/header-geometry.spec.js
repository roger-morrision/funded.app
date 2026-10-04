import { test, expect } from '@playwright/test';

const failures=new WeakMap();
test.beforeEach(async({page})=>{
  const errors=[];failures.set(page,errors);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Offline layout fixture"}'}));
  await page.route('https://**/*',route=>route.abort());
});
test.afterEach(async({page})=>expect(failures.get(page),'No uncaught browser errors').toEqual([]));

for(const width of [1440,1024,901])test(`pilot header remains outside the sidebar throughout navigation at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});await page.goto('/#overview');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  // Sample real animation frames, including the previously obscured first 200ms.
  const frames=await page.evaluate(async()=>{
    location.hash='pilot';const start=performance.now(),frames=[];
    while(performance.now()-start<600){
      await new Promise(requestAnimationFrame);
      if(!document.body.classList.contains('page-route-pilot'))continue;
      const sidebar=document.querySelector('#sidebar').getBoundingClientRect();
      const header=document.querySelector('.topbar').getBoundingClientRect();
      const label=document.querySelector('[data-route-label]'),box=label.getBoundingClientRect();
      const point=box.width?document.elementFromPoint(box.left+2,box.top+box.height/2):null;
      frames.push({headerGap:header.left-sidebar.right,labelGap:box.width?box.left-sidebar.right:null,labelUncovered:!box.width||point===label||label.contains(point)});
    }
    return frames;
  });
  expect(frames.length).toBeGreaterThan(1);
  expect(frames.filter(frame=>frame.headerGap<0||frame.labelGap!==null&&frame.labelGap<0||!frame.labelUncovered),'No rendered pilot frame hides header content behind navigation').toEqual([]);
  await page.screenshot({path:testInfo.outputPath(`pilot-fullpage-${width}.png`),fullPage:true});
  const toggle=page.locator('#desktop-sidebar-toggle');await toggle.focus();
  await page.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(toggle).toBeFocused();
  expect(await toggle.evaluate(element=>parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('mobile pilot header controls remain usable with keyboard menu focus restoration',async({page})=>{
  await page.setViewportSize({width:390,height:900});await page.goto('/pilot');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  for(const selector of ['#open-menu','.header-search-trigger','#connect-button']){
    const target=page.locator(selector);await expect(target).toBeVisible();const box=await target.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await target.evaluate(element=>{const b=element.getBoundingClientRect();return element.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
  }
  await expect(page.locator('[data-route-label]')).toHaveText('Creator pilot');
  await page.locator('#open-menu').focus();await page.keyboard.press('Enter');await expect(page.locator('#open-menu')).toHaveAttribute('aria-expanded','true');await expect(page.locator('#close-menu')).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('#open-menu')).toBeFocused();await expect(page.locator('#open-menu')).toHaveAttribute('aria-expanded','false');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
