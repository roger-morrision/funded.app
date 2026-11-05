import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

for (const width of [320, 390, 1440]) test(`Home getting-started tasks and header stay in place while the workspace initializes at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height:844 });
  await page.route('**/api/**', route => new URL(route.request().url()).pathname === '/api/fee-policy'
    ? route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } })
    : route.fulfill({ status:503, json:{ error:'Offline layout fixture' } }));
  await page.route('https://**/*', route => route.abort());
  let held;
  await page.route('**/workspace-ui*.js*', route => { held = route; });
  await page.goto('/#overview', { waitUntil:'domcontentloaded' });
  await expect.poll(() => Boolean(held)).toBe(true);
  const selectors = ['.hero-section', '.home-start', '#connect-button', '#header-search-trigger'];
  const geometry = () => page.evaluate(selectors => selectors.map(selector => {
    const { x,y,width,height } = document.querySelector(selector).getBoundingClientRect();
    return { x,y,width,height };
  }), selectors);
  const before = await geometry();
  await held.continue();
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
  const after = await geometry();
  for (let i=0;i<selectors.length;i++) for (const key of ['x','y','width','height'])
    expect(Math.abs(after[i][key]-before[i][key]), `${selectors[i]} ${key} moved`).toBeLessThanOrEqual(1);
  expect(after[1].y, 'Getting-started tasks begin within the first screen').toBeLessThan(844);
  expect(await page.evaluate(() => {
    const board=document.querySelector('.home-launch-board'), directory=document.querySelector('#public-discovery');
    return Boolean(board && !directory && board.getBoundingClientRect().width===0)
      && !document.querySelector('.public-discovery-list,.public-discovery-empty')
      && document.documentElement.scrollWidth<=innerWidth;
  })).toBe(true);
});

for (const width of [320, 768, 1440]) test(`Home task cards are readable and extended FAQs remain reachable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({width,height:900});
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline layout fixture'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.goto('/#overview');await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
  const cards=page.locator('.home-start-grid > a');await expect(cards).toHaveCount(3);
  for(const card of await cards.all()){
    await expect(card).toBeVisible();await card.focus();await expect(card).toBeFocused();
    expect(await card.evaluate(e=>[...e.querySelectorAll('h3,p,strong')].every(n=>n.scrollWidth<=n.clientWidth+1))).toBe(true);
  }
  await expect(page.locator('.home-faq-primary > details')).toHaveCount(4);
  const more=page.locator('.home-faq-more');await expect(more).not.toHaveAttribute('open','');
  await more.locator(':scope > summary').focus();await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('open','');await expect(more.locator('[data-faq="fees"] > summary')).toBeVisible();
  await expect(page.locator('#home-launch-board-title')).toBeHidden();
  await expect(page.locator('.home-welcome-guide')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
