import{test,expect}from'@playwright/test';
import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';
const mint='So11111111111111111111111111111111111111112';
for(const width of[320,390,768,1440])test(`shared discovery controls and route highlights at ${width}px (mocked APIs)`,async({page,baseURL},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width,height:960});const errors=[],writes=[];
 await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(baseURL).origin?r.fallback():r.abort());
 await page.route('**/api/**',r=>{const q=r.request(),path=new URL(q.url()).pathname;if(q.method()!=='GET'&&path!=='/api/solana/rpc')writes.push(path);
  if(path==='/api/fee-policy')return r.fulfill({json:{revision:6,split:PROTOCOL_FEE_SPLIT}});
  if(path==='/api/launches')return r.fulfill({json:[{mint,name:'Surface fixture',symbol:'SURF',cluster:'devnet',onchainVerified:true,creatorWallet:'11111111111111111111111111111111'}]});
  if(path==='/api/pump/explore')return r.fulfill({json:{items:[],fetchedAt:new Date().toISOString()}});
  return r.fulfill({status:503,json:{error:'Unavailable surface-review fixture'}});
 });
 await page.goto('/#explore');await page.locator('body.product-flows-ready').waitFor();
 const route=async hash=>{await page.evaluate(hash=>location.hash=hash,hash);await expect(page.locator('body')).toHaveClass(new RegExp(`page-route-${hash}(?: |$)`));};
 const homeCard=page.locator('#asset-grid .home-launch-card').first();await expect(homeCard).toBeVisible();
 const actionStyle=e=>{const s=getComputedStyle(e);return[s.backgroundColor,s.borderColor,s.color]};
 await page.mouse.move(0,0);const homeAction=await homeCard.locator('.token-card-action-share').evaluate(actionStyle);
 await homeCard.locator('.token-card-action-share').click();await expect(page.locator('#share-dialog')).toHaveJSProperty('open',true);await page.keyboard.press('Escape');await expect(page.locator('#share-dialog')).toHaveJSProperty('open',false);
 const home=page.locator('.home-launch-toolbar .review-buy-setting input');await expect(home).toBeHidden();
 await route('explore');await expect(page.locator('#explore .review-buy-setting input')).toHaveCount(0);
 const search=page.locator('#explore-search');await search.fill('SURF');await expect(page.locator('#global-search')).toHaveValue('SURF');await expect(search).toHaveValue('SURF');
 const exploreCard=page.locator('#asset-grid .home-launch-card').first();await expect(exploreCard).toBeVisible();await page.mouse.move(0,0);await expect.poll(()=>exploreCard.locator('.token-card-action-share').evaluate(actionStyle)).toEqual(homeAction);
 await search.focus();const ring=await search.evaluate(e=>{const s=getComputedStyle(e.closest('label'));return{style:s.outlineStyle,width:parseFloat(s.outlineWidth)}});expect(ring.style).toBe('solid');expect(ring.width).toBeGreaterThanOrEqual(2);
 for(const control of[search]){expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);if(width<=700)expect(await control.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);}
 await page.screenshot({path:info.outputPath(`explore-${width}.png`)});await route('overview');await expect(home).toBeHidden();
 await route('marketing-agency');await expect(page.locator('.agency-agent')).toHaveCount(3);await expect(page.locator('.agency-agent').nth(1)).toContainText('verified $100,000 market cap');await expect(page.locator('.agency-agent').nth(2)).toContainText('verified $300,000 market cap');
 await expect(page.locator('[data-agency-funded]')).toHaveText('-');await expect(page.locator('[data-agency-spent]')).toHaveText('-');
 const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/marketing-agency'));await page.locator('[data-agency-refresh]').click();await refreshed;await expect(page.locator('[data-agency-status]')).toContainText('unavailable');
 const policy=page.locator('.agency-policy'),summary=policy.locator('summary');await summary.focus();await page.keyboard.press('Enter');await expect(policy).toHaveAttribute('open','');await expect(policy).toContainText('Actions require verified funding');await page.keyboard.press('Space');await expect(policy).not.toHaveAttribute('open','');
 await page.screenshot({path:info.outputPath(`agency-${width}.png`)});
 const nav=page.locator('.mobile-workspace-nav');
 for(const [hash,label]of[['marketing-agency','Create'],['bonuses','Rewards'],['capital-flow','Rewards'],['analytics-detail','Explore']]){await route(hash);if(width<=700){await expect(nav.getByRole('link',{name:label,exact:true})).toHaveAttribute('aria-current','page');await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);}else await expect(nav).toBeHidden();}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);expect(writes).toEqual([]);
});
