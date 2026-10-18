import {test,expect} from '@playwright/test';
for(const width of [320,390,1440])test(`partial activity is visible and older tokens enter ranking at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline fixture'}}));
 await page.route('https://**/*',route=>route.abort());
 await page.goto('/#overview');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
 await page.evaluate(async()=>{
  const sampling=await import('/src/features/explore/activity-sampling.js');
  const market=await import('/market-intelligence.js');
  const fixture={time:600000,items:Array.from({length:9},(_,i)=>({address:String(i),complete:false})),calls:0};
  fixture.refresh=sampling.createExploreActivitySampler({cache:new Map(),now:()=>fixture.time});
  fixture.render=()=>{
   const records=fixture.items.map(item=>market.withMarketWindow(item,'24h'));
   sampling.renderActivityCoverage(document,'home-activity-coverage',records);
   const winner=market.filterMarketRecords(records,{sort:'volume',minVolumeSol:50})[0];
   document.querySelector('#home-board-count').textContent=winner?`Highest volume: older token ${winner.address}`:'No checked token matches the filter';
  };
  fixture.request=async item=>{fixture.calls++;const value=item.address==='8'?100:1;return{observedCoverage:'complete',coverage:'complete',volume24hSol:value,tradeCount24h:1,buyCount24h:1,sellCount24h:0,activityWindows:Object.fromEntries(['1h','6h','24h'].map(period=>[period,{volumeSol:value,tradeCount:1,traderCount:1,coverage:'complete'}]))};};
  window.activityFixture=fixture;await fixture.refresh(fixture.items,fixture.request);fixture.render();
 });
 await expect(page.locator('#home-activity-coverage')).toContainText('5/9 tokens checked');
 await expect(page.locator('#home-activity-coverage')).toContainText('Rankings and activity filters are partial');
 await page.evaluate(async()=>{const f=window.activityFixture;f.time+=60000;await f.refresh(f.items,f.request);f.render();});
 await expect(page.locator('#home-activity-coverage')).toContainText('9/9 tokens checked');
 await expect(page.locator('#home-activity-coverage')).not.toContainText('filters are partial');
 await expect(page.locator('#home-board-count')).toHaveText('Highest volume: older token 8');
 expect(await page.evaluate(()=>window.activityFixture.calls)).toBe(9);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath(`activity-${width}.png`)});expect(errors).toEqual([]);
});
