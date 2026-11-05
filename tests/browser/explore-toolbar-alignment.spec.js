import{test,expect}from'@playwright/test';import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';
for(const width of[320,390,768,1280,1440])test(`Explore controls align at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.route('https://**/*',r=>r.abort());await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Mocked offline'}}));await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
 await page.goto('/#explore');await page.locator('body.product-flows-ready').waitFor();
 const box=s=>page.locator(s).boundingBox();const tools=await box('.explore-tools'),search=await box('.explore-search-label');expect(Math.abs(search.x-tools.x)).toBeLessThan(2);expect(Math.abs(search.width-tools.width)).toBeLessThan(2);
 const selectors=['.explore-timeframe','#explore-filter-toggle','#explore-sort','.explore-view-switch','#explore-trade-preferences > summary'];const controls=await Promise.all(selectors.map(box));
 for(const r of controls){expect(r.height).toBeGreaterThanOrEqual(44);expect(r.y).toBeGreaterThanOrEqual(search.y+search.height+10);}
 if(width>1100){expect(Math.max(...controls.map(r=>r.y))-Math.min(...controls.map(r=>r.y))).toBeLessThan(2);expect(Math.max(...controls.map(r=>r.height))-Math.min(...controls.map(r=>r.height))).toBeLessThan(3);}
 await page.locator('#explore-trade-preferences > summary').click();await expect(page.locator('#explore .review-buy-setting input')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('#explore-trade-preferences > summary').click();await page.locator('#explore-filter-toggle').click();await expect(page.locator('#explore-filter-popover')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#explore-filter-toggle')).toBeFocused();
 await page.screenshot({path:info.outputPath(`explore-aligned-${width}.png`)});
});
