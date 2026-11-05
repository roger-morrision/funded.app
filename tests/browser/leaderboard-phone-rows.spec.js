import {test,expect} from '@playwright/test';

// The Traders board stacks each row on phones instead of scrolling sideways.
for(const width of [320,375,1440])test(`Traders rows fit a ${width}px screen`,async({page,baseURL})=>{
  await page.setViewportSize({width,height:800});
  await page.route('https://**/*',route=>{const request=route.request(),url=new URL(request.url());return url.origin===new URL(baseURL).origin&&request.method()==='GET'&&!url.pathname.startsWith('/api/')?route.fallback():route.abort();});
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline leaderboard fixture'}}));
  await page.goto('/#leaderboard');await page.locator('body.workspace-ready.product-experience-ready').waitFor();
  await page.getByRole('tab',{name:'Traders'}).click();
  await page.locator('#leaderboard-table').evaluate(table=>{
    table.dataset.view='traders';
    const row=i=>`<div class="leaderboard-row" role="row"><span role="cell" class="rank-number">0${i}</span><span role="cell" class="leader-identity"><a class="leaderboard-profile" href="/wallet/w${i}"><span class="leader-avatar blue" aria-hidden="true">AB</span><span class="leaderboard-profile-copy"><strong>AbCdEf…UvWxYz</strong><small>3 coins traded</small></span></a></span><span role="cell"><b>12</b><small>8 buy · 4 sell</small></span><span role="cell" class="leader-value">1.234567 SOL</span><span role="cell"><a class="leaderboard-proof" href="#">Trade ↗</a></span></div>`;
    table.innerHTML=`<div class="leaderboard-table-head" role="row"><span role="columnheader">Rank</span><span role="columnheader">Wallet</span><span role="columnheader">Trades</span><span role="columnheader">SOL volume</span><span role="columnheader">Proof</span></div>${row(1)}${row(2)}`;
  });
  const geometry=await page.locator('#leaderboard-table').evaluate(table=>({scroll:table.scrollWidth,client:table.clientWidth,page:document.documentElement.scrollWidth,cells:[...table.querySelector('.leaderboard-row').children].map(cell=>{const r=cell.getBoundingClientRect();return{top:r.top,bottom:r.bottom,right:r.right};}),head:getComputedStyle(table.querySelector('.leaderboard-table-head')).display}));
  expect(geometry.page).toBeLessThanOrEqual(width+1);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client+1);
  // The compact table now retains its column headings at every width.
  expect(geometry.head).not.toBe('none');
  const identity=page.locator('#leaderboard-table .leaderboard-profile').first();
  await expect(identity).toBeVisible();await expect(page.locator('#leaderboard-table .leader-value').first()).toBeVisible();
  await page.locator('#leaderboard-table').screenshot({path:test.info().outputPath(`traders-${width}.png`)});
});
