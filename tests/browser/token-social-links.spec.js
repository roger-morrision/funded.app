import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z';
const missing='#coin-website-link,#coin-x-link,#coin-telegram-link,#coin-discord-link';
for(const width of [375,1440])test(`token header at ${width}px only shows provided project links on phones`,async({page,baseURL})=>{
  await page.setViewportSize({width,height:width<700?812:900});
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline social links fixture'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('https://**/*',route=>{const request=route.request(),url=new URL(request.url());return url.origin===new URL(baseURL).origin&&request.method()==='GET'?route.fallback():route.abort();});
  await page.goto(`/token/${mint}`);await page.locator('body.workspace-ready.product-experience-ready').waitFor();
  const links=page.locator(`.coin-socials :is(${missing})`);
  await expect(links).toHaveCount(4);
  for(const link of await links.all()){await expect(link).toHaveClass(/is-unavailable/);if(width<700)await expect(link).toBeHidden();else await expect(link).toBeVisible();}
  await expect(page.locator('#coin-share-link')).toBeVisible();await expect(page.locator('#coin-refresh')).toBeVisible();
});
