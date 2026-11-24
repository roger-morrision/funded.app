import {test,expect} from '@playwright/test';

// Mocked index catch-up, with the real deployed UI and route polling.
test('an open empty leaderboard picks up a newly indexed trade without a reload',async({page})=>{
  let indexed=false,refreshes=0;
  await page.route('**/api/leaderboard/traders*',route=>{
    if(new URL(route.request().url()).searchParams.has('refresh'))refreshes++;
    return route.fulfill({contentType:'application/json',body:JSON.stringify({cluster:'mainnet-beta',stale:false,
      syncedAt:new Date().toISOString(),tokenCount:indexed?1:0,traders:indexed?[{
        wallet:'11111111111111111111111111111111',tradeCount:1,buyCount:1,sellCount:0,volumeSol:0.1,tokenCount:1,
        latestSignature:'1'.repeat(88),latestBlockTime:Math.floor(Date.now()/1000),sampleCapped:false,
      }]:[]})});
  });
  await page.goto('/#leaderboard');
  await expect(page.locator('#leaderboard-status-title')).toHaveText('No traders yet');
  indexed=true;
  await expect(page.locator('#leaderboard-status-title')).toHaveText('1 trading wallet',{timeout:25000});
  expect(refreshes).toBeGreaterThan(0);
});
