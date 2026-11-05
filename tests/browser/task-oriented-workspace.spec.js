import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const mint='9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
async function setup(page,width){
  await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline UI fixture'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
}
const ready=async(page,path)=>{await page.goto(path);await expect(page.locator('body')).toHaveClass(/product-flows-ready/);};
const fits=async page=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
for(const width of [320,390,768,1440]){
  test(`task navigation and Home at ${width}px (mocked APIs)`,async({page},info)=>{
    await setup(page,width);const errors=[];page.on('pageerror',e=>errors.push(e.message));await ready(page,'/#overview');
    await expect(page.locator('#home-hero-title')).toContainText('Reward your community');
    await expect(page.locator('.home-benefit-value')).toHaveText(['80%','≥3%','Top 3']);
    await expect(page.locator('.hero-actions > a')).toHaveText(['Launch a coin','Explore coins','Check rewards']);
    await expect(page.locator('.home-welcome-guide > a')).toHaveAttribute('href','/welcome');
    await expect(page.locator('.home-start-grid > a')).toHaveCount(3);
    await expect(page.locator('.home-start')).toBeVisible();
    await expect(page.locator('.home-kpi-dashboard')).not.toBeVisible();
    if(width<=700)await page.locator('#open-menu').click();
    const nav=page.locator('.primary-nav');
    await expect(nav.locator(':scope > .nav-item').filter({hasText:/^(Home|Explore|Create|Portfolio|Rewards)$/})).toHaveCount(5);
    await expect(page.locator('#secondary-navigation')).not.toHaveAttribute('open','');
    await page.locator('#secondary-navigation > summary').click();
    await nav.getByRole('link',{name:'Fee distribution',exact:true}).click();
    await expect(page).toHaveURL(/#capital-flow$/);
    await page.goBack();await expect(page.locator('.home-start')).toBeVisible();await fits(page);
    await page.screenshot({path:info.outputPath(`home-${width}.png`),fullPage:true,animations:'disabled'});
    await expect(page.getByRole('search',{name:'Find coins'})).toBeVisible();
    for(const link of await page.locator('.home-discover-links a').all())expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.locator('#home-coin-search').fill('Community & SOL');
    await page.locator('#home-coin-search').press('Enter');
    await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
    await expect(page.locator('#explore-search')).toHaveValue('Community & SOL');
    await expect(page.locator('button[data-explore-tab="trending"]')).toHaveAttribute('aria-pressed','true');
    for(const [label,tab] of [['New coins','new'],['Favorites','favorites'],['Trending','trending']]){
      await ready(page,'/#overview');
      await page.locator('.home-discover-links').getByRole('link',{name:label,exact:true}).click();
      await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
      await expect(page.locator(`button[data-explore-tab="${tab}"]`)).toHaveAttribute('aria-pressed','true');
      await expect(page.locator('#explore-search')).toHaveValue('');
      await fits(page);
    }
    await ready(page,'/#overview');await page.locator('.home-receipts a').click();
    await expect(page.locator('#rewards-history')).toBeVisible();
    expect(errors).toEqual([]);
  });
  test(`two-stage creation preserves validation and consent at ${width}px (mocked APIs)`,async({page},info)=>{
    await setup(page,width);const writes=[];page.on('request',r=>{
      if(r.method()!=='POST')return;
      if(new URL(r.url()).pathname==='/api/solana/rpc'){
        const body=r.postDataJSON(),calls=Array.isArray(body)?body:[body];
        if(calls.length&&calls.every(call=>/^(get|isBlockhashValid$)/.test(call.method)))return;
      }
      writes.push(r.url());
    });
    await ready(page,'/#launch');
    await expect(page.locator('[data-launch-step-target]')).toHaveCount(2);
    await page.locator('[data-launch-step-target="2"]').click();
    await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','1');
    await expect(page.locator('#token-name')).toBeFocused();
    await page.locator('#token-name').fill('Community Review');await page.locator('#token-symbol').fill('REVIEW');
    await expect(page.locator('#launch-project-links > summary')).toHaveCount(0);
    const socialInputs=page.locator('#launch-project-links input');await expect(socialInputs).toHaveCount(4);
    for(const input of await socialInputs.all()){await expect(input).toBeVisible();expect((await input.boundingBox()).height).toBeGreaterThanOrEqual(44);}
    if(width>600){const boxes=await socialInputs.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));expect(Math.abs(boxes[0]-boxes[1])).toBeLessThan(1);expect(Math.abs(boxes[2]-boxes[3])).toBeLessThan(1);}
    await expect(page.locator('#custom-policy')).not.toBeVisible();
    await page.screenshot({path:info.outputPath(`details-${width}.png`),fullPage:true,animations:'disabled'});
    await page.locator('#launch-next').click();
    await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','2');
    await expect(page.locator('#custom-policy')).toBeVisible();
    await expect(page.locator('#launch-fee-overview > summary')).toHaveCount(0);
    await expect(page.locator('#launch-fee-overview [data-fee-category] > strong')).toHaveText(['80%','8%','3%','4%','5%']);
    for(const rate of await page.locator('#launch-fee-overview [data-fee-category]').all())await expect(rate).toBeVisible();
    await expect(page.locator('#creator-buy-sol')).toHaveValue('0');
    if(width===1440){
      const airdrop=await page.locator('#community-airdrop-tokens').boundingBox(),buy=await page.locator('#creator-buy-sol').boundingBox();
      expect(Math.abs(airdrop.y-buy.y)).toBeLessThan(2);
    }
    await expect(page.locator('#launch-promotion-options')).toBeVisible();await expect(page.locator('#launch-promotion-options > summary')).toHaveCount(0);await expect(page.locator('button[data-burn-tier="pro"]')).toBeVisible();
    await page.screenshot({path:info.outputPath(`funding-${width}.png`),fullPage:true,animations:'disabled'});
    await page.locator('#holder-airdrop-share').fill('20');
    await page.locator('#launch-back').click();
    await page.locator('[data-launch-step-target="2"]').click();
    await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','2');
    await expect(page.locator('#launch-button')).toBeDisabled();
    await page.locator('#creator-wallet-share').fill('60');
    await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','2');
    await expect(page.locator('#launch-summary-creator')).toHaveText('60%');
    await expect(page.locator('#launch-summary-holders')).toHaveText('20%');
    await expect(page.locator('#fee-route-agree')).not.toBeChecked();
    await expect(page.locator('#terms-agree')).not.toBeChecked();
    await expect(page.locator('#launch-button')).toBeDisabled();
    await expect(page.locator('#launch-button')).toBeVisible();
    await expect(page.locator('#fee-route-agree')).toBeVisible();
    await expect(page.locator('#terms-agree')).toBeVisible();
    await expect(page.locator('#launch-review-dialog')).not.toBeVisible();
    await fits(page);await page.screenshot({path:info.outputPath(`review-${width}.png`),fullPage:true,animations:'disabled'});
    await page.locator('#launch-back').click();
    await expect(page.locator('#holder-airdrop-share')).toHaveValue('20');
    await expect(page.locator('#token-name')).toHaveValue('Community Review');
    expect(writes).toEqual([]);
  });
  test(`personal rewards exclude protocol amounts at ${width}px (mocked receipts)`,async({page},info)=>{
    await setup(page,width);
    await page.route('**/api/rewards/experience**',r=>r.fulfill({json:{cluster:'devnet',evidence:{status:'recorded-finalized-v3'},tokens:[],events:[]}}));
    await page.route('**/api/buyback/status',r=>r.fulfill({json:{cluster:'devnet',pending:[{mint,amountLamports:'123000000',status:'below-minimum-order'}],receipts:[]}}));
    await ready(page,'/#payments');
    const center=page.locator('#financial-center');
    await expect(center.locator('[data-flow-empty-title]')).toContainText('Connect a wallet');
    await expect(center.locator('.financial-record')).toHaveCount(0);
    await expect(page.locator('.reward-program-guide summary')).toHaveCount(0);
    await expect(page.locator('.reward-program-guide article')).toHaveCount(6);
    for(const article of await page.locator('.reward-program-guide article').all()) await expect(article).toBeVisible();
    await center.getByLabel('Activity scope').selectOption('protocol');
    await expect(center.locator('.financial-record')).toHaveCount(1);
    await expect(center.locator('[data-flow-status]')).toContainText('not your rewards');
    await center.getByLabel('Activity scope').selectOption('personal');
    await expect(center.locator('.financial-record')).toHaveCount(0);
    await fits(page);await page.screenshot({path:info.outputPath(`rewards-${width}.png`),fullPage:true,animations:'disabled'});
    await page.getByRole('tab',{name:'Token airdrops',exact:true}).click();
    await expect(page.locator('#rewards-funded')).toBeVisible();
    await page.evaluate(()=>{location.hash='payments/x';});await expect(page.locator('#rewards-x')).toBeVisible();
    await page.evaluate(()=>{location.hash='payments/history';});await expect(page.getByRole('tab',{name:'All Payout History',exact:true})).toHaveAttribute('aria-selected','true');
  });
}
