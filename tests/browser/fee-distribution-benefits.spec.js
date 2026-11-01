import{test,expect}from'@playwright/test';
const split={operationsPercent:40,referralLevelPercents:[3,1.25,0.75],communityPercent:20,buybackPercent:25,agencyPercent:10};
const expected={creator:80,operations:8,referrals:1,community:4,buyback:5,agency:2};
async function offline(page,baseURL){
 await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
 await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());return q.method()==='GET'&&u.origin===new URL(baseURL).origin?r.fallback():r.abort();});
 await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Offline fee presentation fixture'}}));await page.route('**/api/fee-policy',r=>r.fulfill({json:{revision:6,split}}));
}
async function summary(root){
 await expect(root.locator('header')).toContainText('Only 8% for Operations & marketing');await expect(root.locator('header')).toContainText('92% is allocated');
 for(const[key,value]of Object.entries(expected))await expect(root.locator(`[data-fee-category="${key}"] > strong`)).toHaveText(`${value}%`);
 expect(await root.locator('[data-fee-category] > strong').evaluateAll(nodes=>nodes.reduce((sum,node)=>sum+Number.parseFloat(node.textContent),0))).toBe(100);
 await expect(root).toContainText('collected creator fees, not trade volume');await expect(root).toContainText('Existing coins keep their saved rates');
}
for(const width of[320,390,700,1440])test(`published fee distribution and configurable creator share stay consistent at ${width}px (mocked APIs)`,async({page,baseURL},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:900});await offline(page,baseURL);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#capital-flow');await page.locator('body.product-experience-ready').waitFor();await summary(page.locator('#capital-flow [data-fee-distribution]'));
 const ids=['creator','operations','referrals','community','buyback','agency'];
 for(const[id,value]of ids.map(id=>[id,expected[id]]))await expect(page.locator(`#fee-output-${id}`)).toHaveText(`${value} SOL`);
 await page.locator('#fee-flow-input').fill('250');for(const[id,value]of ids.map(id=>[id,expected[id]*2.5]))await expect(page.locator(`#fee-output-${id}`)).toHaveText(`${value} SOL`);
 for(const route of['overview','analytics-detail','paid','docs/fees','launch']){
  await page.evaluate(hash=>{location.hash=hash;},route);
  if(route==='overview'){await expect(page.locator('.home-receipt-card h2')).toContainText('Only 8%');await expect(page.locator('#fee-policy-faq')).toContainText('1% Referral network');}
  if(route==='analytics-detail'){await expect(page.locator('.allocation-chips')).toContainText('2%AI marketing & coin buybacks');await expect(page.locator('.split-legend b')).toHaveText(['80%','8%','12%']);}
  if(route==='paid'){await expect(page.locator('#paid .revenue-flow b')).toHaveText(['80%','8%','12%']);await summary(page.locator('#paid > [data-fee-distribution]'));await expect(page.locator('.app-revenue-grid > span > b')).toHaveText(['8%','1%','4%','5%','2%']);}
  if(route==='docs/fees')await summary(page.locator('#docs-guide-article .fee-distribution-summary'));
  if(route==='launch')await summary(page.locator('.launch-fixed-distribution'));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 await page.locator('#token-name').fill('Fee Policy Test');await page.locator('#token-symbol').fill('FEES');
 await page.locator('#creator-wallet-share').fill('60');await page.locator('#holder-airdrop-share').fill('20');
 await expect(page.locator('#launch-summary-creator')).toHaveText('60%');await expect(page.locator('#launch-summary-holders')).toHaveText('20%');await summary(page.locator('.launch-fixed-distribution'));
 await page.locator('#launch-next').click();
 await expect(page.locator('[data-fee-fixed-list="launch-review"] dd')).toHaveText(['8%','1%','4%','5%','2%']);await expect(page.locator('.launch-fee-options [data-app-allocation]')).toHaveText('8%');await expect(page.locator('#launch-summary-programs-note')).toContainText('8% Operations & marketing + 12%');await expect(page.locator('#launch-button')).toBeDisabled();
 await page.locator('.launch-fixed-distribution').screenshot({path:info.outputPath(`launch-fees-${width}.png`)});expect(errors).toEqual([]);
});
for(const width of[320,390,1440])test(`landing explains all stakeholder allocations without an API or wallet at ${width}px`,async({page,baseURL},info)=>{
 await page.setViewportSize({width,height:900});await offline(page,baseURL);const api=[],errors=[];page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/welcome#transparency');await summary(page.locator('[data-landing-fee-distribution]'));await expect(page.locator('.reward-grid')).toContainText('4% Daily bonus pool');
 await page.locator('[data-landing-fee-distribution]').scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(api).toEqual([]);expect(errors).toEqual([]);
 await page.locator('[data-landing-fee-distribution]').screenshot({path:info.outputPath(`landing-fees-${width}.png`)});
});
