import {test,expect} from '@playwright/test';
import {adminFixture} from './admin-review-fixture.js';

for(const width of [390,1440]) {
 test(`Welcome allocations and removed diagram at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Offline presentation check'}}));
  await page.goto('/welcome.html');
  const cards=page.locator('.selling-grid article');await expect(cards).toHaveCount(6);
  await expect(cards.filter({hasText:'Referral rewards'})).toContainText('1%');
  await expect(cards.filter({hasText:'AI agents & coin buybacks'})).toContainText('2%');
  await expect(page.locator('#transparency')).toHaveCount(0);
  const first=await cards.nth(0).boundingBox(),last=await cards.nth(5).boundingBox();
  if(width>1000)expect(last.y).toBeLessThan(first.y+first.height*3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 });
 test(`Service status lives inside the authenticated admin workspace at ${width}px (mocked)`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.route('https://**/*',r=>r.abort());
  await adminFixture(page,async({path,send})=>{
   if(path!=='/api/status')return false;
   await send(200,{status:'operational',cluster:'devnet',observedAt:new Date().toISOString(),checks:[{id:'storage',status:'operational'},{id:'network',status:'operational'}]});return true;
  });
  await page.goto('/admin.html');const panel=page.locator('#workspace #service-status');await expect(panel).toBeVisible();
  await panel.getByRole('button',{name:'Check service status'}).click();
  await expect(panel.getByRole('status')).toHaveText('Solana Devnet: storage and network are available.');
  await expect(panel.locator('li')).toHaveCount(2);
  await page.locator('#sign-out').click();await expect(panel).toBeHidden();
  await page.goto('/#docs');await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
  await expect(page.locator('#service-status')).toHaveCount(0);
 });
}
