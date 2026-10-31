import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',r=>new URL(r.request().url()).pathname==='/api/fee-policy'
    ?r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}):r.fulfill({status:503,json:{error:'Offline layout fixture'}}));
});

for(const width of[320,390,700])test(`mobile guide menu preserves search, article and focus at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.goto('/#docs/trading');await page.locator('body.product-flows-ready').waitFor();
  const browse=page.getByRole('button',{name:'Browse guides',exact:true}),input=page.locator('#docs-guide-search'),article=page.locator('#docs-guide-article');
  await expect(browse).toHaveAttribute('aria-expanded','false');await expect(input).toBeHidden();await expect(article.locator('h1')).toHaveText('Buying and selling');
  expect(await article.locator('h1').evaluate(e=>e.getBoundingClientRect().top)).toBeLessThan(240);
  await browse.focus();await page.keyboard.press('Enter');await expect(input).toBeVisible();
  await page.keyboard.press('Tab');await expect(page.locator('.docs-back')).toBeFocused();await page.keyboard.press('Tab');await expect(input).toBeFocused();
  await input.fill('pending');const topic=page.getByRole('button',{name:'Pending, unavailable or failed',exact:true});await topic.focus();await page.keyboard.press('Enter');
  await expect(article).toBeFocused();await expect(article.locator('h1')).toHaveText('Pending, unavailable or failed');await expect(page).toHaveURL(/#docs\/troubleshooting$/);
  await browse.focus();await page.keyboard.press('Enter');await expect(input).toBeHidden();await expect(browse).toBeFocused();await expect(article.locator('h1')).toHaveText('Pending, unavailable or failed');
  await page.keyboard.press('Enter');await expect(input).toHaveValue('pending');await page.setViewportSize({width:1440,height:900});await expect(browse).toBeHidden();await expect(input).toBeFocused();
  await page.setViewportSize({width,height:844});await expect(input).toBeFocused();await expect(browse).toHaveAttribute('aria-expanded','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const width of[320,390,1440])test(`reward program navigation and settings reflow at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto('/#payments');await page.locator('body.product-flows-ready').waitFor();
  const programs=page.locator('.reward-action-grid');await expect(programs.locator(':scope > :is(a,button)')).toHaveCount(6);
  for(const item of await programs.locator(':scope > :is(a,button)').all())expect((await item.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await programs.getByRole('button',{name:/Coin holder rewards/}).click();await expect(page.locator('#rewards-holder')).toBeVisible();
  await page.evaluate(()=>location.hash='profile');await expect(page.locator('#profile')).toBeVisible();
  const notifications=await page.locator('#notification-preferences').boundingBox(),trades=await page.locator('#trade-preferences').boundingBox();
  if(width>700){expect(notifications.y).toBeCloseTo(trades.y,1);expect(trades.x).toBeGreaterThan(notifications.x+notifications.width-1);}else expect(trades.y).toBeGreaterThan(notifications.y);
  const reminder=page.locator('#profile [data-open-activity]');await reminder.focus();await page.keyboard.press('Enter');await expect(page.locator('dialog[open]')).toBeVisible();await page.keyboard.press('Escape');await expect(reminder).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
