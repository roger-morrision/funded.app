import{test,expect}from'@playwright/test';import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';
for(const width of[320,390,430,600,768,1280,1440])test(`Explore controls align at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.route('https://**/*',r=>r.abort());await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Mocked offline'}}));await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
 await page.goto('/#explore');await page.locator('body.product-flows-ready').waitFor();
 const box=s=>page.locator(s).boundingBox();const tools=await box('.explore-tools'),search=await box('.explore-search-label');expect(Math.abs(search.x-tools.x)).toBeLessThan(2);if(width<1100)expect(Math.abs(search.width-tools.width)).toBeLessThan(2);else expect(search.width).toBeGreaterThanOrEqual(180);
 const selectors=['.explore-timeframe','#explore-filter-toggle','#explore-sort','.explore-view-switch'];const controls=await Promise.all(selectors.map(box));
 for(const r of controls){expect(r.height).toBeGreaterThanOrEqual(44);if(width<1100)expect(r.y).toBeGreaterThanOrEqual(search.y+search.height+(width<=600?8:10));else expect(Math.abs(r.y-search.y)).toBeLessThan(2);}
 if(width<=600){const [time,filter,sort,view]=controls;expect(Math.max(time.y,filter.y,view.y)-Math.min(time.y,filter.y,view.y)).toBeLessThan(2);expect(time.x+time.width).toBeLessThanOrEqual(filter.x);expect(filter.x+filter.width).toBeLessThanOrEqual(view.x);expect(sort.y).toBeGreaterThan(time.y);for(const button of await page.locator('.explore-timeframe button,.explore-view-switch button').all())expect((await button.boundingBox()).width).toBeGreaterThanOrEqual(44);}
 if(width>1100){expect(Math.max(...controls.map(r=>r.y))-Math.min(...controls.map(r=>r.y))).toBeLessThan(2);expect(Math.max(...controls.map(r=>r.height))-Math.min(...controls.map(r=>r.height))).toBeLessThan(3);}
 await expect(page.locator('#explore-trade-preferences')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('#explore-filter-toggle').click();await expect(page.locator('#explore-filter-popover')).toBeVisible();const popover=await box('#explore-filter-popover');expect(popover.x).toBeGreaterThanOrEqual(0);expect(popover.x+popover.width).toBeLessThanOrEqual(width);await page.keyboard.press('Escape');await expect(page.locator('#explore-filter-toggle')).toBeFocused();
 await page.screenshot({path:info.outputPath(`explore-aligned-${width}.png`)});
});
