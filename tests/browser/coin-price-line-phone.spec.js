import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

// The phone identity grid places the avatar in a narrow first column. The price row
// must span the card so long sub-cent prices and the 24h change chip stay on one line.
for(const width of [360,390]) test(`coin price row spans the identity card at ${width}px`,async({page})=>{
  const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z';
  await page.setViewportSize({width,height:900});
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline fixture'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('https://**/*',route=>route.abort());
  await page.goto(`/token/${mint}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.evaluate(()=>{
    document.querySelector('#coin-price').textContent='$0.000000030465';
    document.querySelector('#coin-change').textContent='No 24h trades';
  });
  const box=async selector=>page.locator(`#coin-page ${selector}`).first().boundingBox();
  const [avatar,title,line,price,change]=await Promise.all(['.coin-avatar','#coin-page-title','.coin-price-line','#coin-price','#coin-change'].map(box));
  expect(line.width).toBeGreaterThan(avatar.width*3);
  expect(line.y).toBeGreaterThanOrEqual(title.y+title.height-1);
  // The chip keeps its single-line height instead of wrapping its words.
  expect(change.height).toBeLessThan(price.height+4);
  expect(price.x+price.width).toBeLessThanOrEqual(line.x+line.width+1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('#coin-page .coin-identity').screenshot({path:test.info().outputPath(`coin-identity-${width}.png`)});
});
