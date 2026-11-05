import {test,expect} from '@playwright/test';
import {build} from 'vite';
import {fileURLToPath} from 'node:url';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const built=await build({root,configFile:false,logLevel:'silent',build:{write:false,lib:{entry:root+'tests/fixtures/community-layout.js',name:'CommunityFixture',formats:['iife']}}});
const fixture=built[0].output.find(row=>row.type==='chunk').code;
const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z',signature='3'.repeat(64);
async function setup(page,width,path){
  await page.setViewportSize({width,height:900});await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Mocked unavailable'}}));
  await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/launches',r=>r.fulfill({json:[{mint,signature,cluster:'devnet',onchainVerified:true,creatorWallet:mint,name:'Community fixture',symbol:'COMM',creatorLaunchBurn:{tier:'pro',status:'verified',amountTokens:1000,receipt:{signature,verified:true,atomicWithPumpLaunch:true}}}]}));
  await page.route(`**/api/tokens/${mint}/chat`,r=>r.fulfill({json:{messages:[],enabled:true}}));
  await page.goto(path);await page.locator('body.product-flows-ready').waitFor();await page.addScriptTag({content:fixture});
}
for(const width of [320,390,768,1440]) {
  test(`token header, single Post and rewards dashboard at ${width}px (mocked data)`,async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));await setup(page,width,`/token/${mint}`);
    await expect(page.locator('.coin-hero-card')).toHaveAttribute('data-launch-tier','pro');
    const identity=await page.locator('.coin-identity').boundingBox(),profile=await page.locator('.coin-hero-aside').boundingBox();
    if(width>1100){expect(profile.x).toBeGreaterThanOrEqual(identity.x+identity.width);expect(profile.y).toBeLessThan(identity.y);}
    else expect(profile.y).toBeGreaterThanOrEqual(identity.y+identity.height);
    await page.locator('[data-coin-tab="chat"]').click();await expect(page.locator('#coin-chat-form button')).toHaveCount(1);await expect(page.locator('[name="callout"]')).toHaveCount(0);
    await page.locator('[data-coin-tab="rewards"]').click();await expect(page.locator('#coin-activity-list')).toContainText('Connect a wallet');
    await page.evaluate(({mint,signature})=>{document.querySelector('#coin-activity-list').innerHTML=CommunityFixture.coinMyRewardsMarkup({wallet:{rows:[{mint,payouts:[{kind:'holder',signature,amountLamports:125000000,paidAt:'2026-11-05T00:00:00Z'}]}]}},mint);},{mint,signature});
    await expect(page.locator('.coin-my-rewards-stats')).toContainText('0.125 SOL');await expect(page.getByRole('cell',{name:'Coin Holder',exact:true})).toBeVisible();
    await expect(page.locator('.coin-rewards-table a')).toHaveAttribute('href',`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    const receipt=await page.locator('.coin-rewards-table a').boundingBox();expect(receipt.x+receipt.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.locator('.coin-my-rewards').screenshot({path:info.outputPath(`rewards-${width}.png`)});
    await page.evaluate(mint=>{document.querySelector('#coin-activity-list').innerHTML=CommunityFixture.coinMyRewardsMarkup({wallet:{rows:[]}},mint);},mint);
    await expect(page.locator('.coin-my-rewards')).toContainText('No payments yet');
    await page.locator('.coin-hero-card').screenshot({path:info.outputPath(`header-${width}.png`)});expect(errors).toEqual([]);
  });
  test(`saved Portfolio tabs and confirmed-success popup at ${width}px (mocked data)`,async({page},info)=>{
    await setup(page,width,'/#my-launches');
    for(const name of ['Tracking wallets','Favorited coins']){const tab=page.getByRole('tab',{name,exact:true});await tab.click();await expect(tab).toHaveAttribute('aria-selected','true');await expect(page.locator('#portfolio-'+(name==='Tracking wallets'?'tracking':'favorites')+'-panel')).toBeVisible();}
    await page.evaluate(({mint,signature})=>CommunityFixture.showLaunchSuccess({mint,name:'Community fixture',symbol:'COMM',signature,registered:false}),{mint,signature});
    const dialog=page.getByRole('dialog',{name:'Token created successfully'});await expect(dialog).toBeVisible();await expect(dialog).toContainText('registration is still pending');
    await expect(dialog.getByRole('link',{name:'Open token page'})).toHaveAttribute('href',`/token/${mint}`);
    await expect(dialog.getByRole('link',{name:'Open token page'})).toBeFocused();
    await page.screenshot({path:info.outputPath(`success-${width}.png`)});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  });
}

test('compact coin cards load the verified logo and display supplied market data (mocked)',async({page})=>{
 await setup(page,390,'/#my-launches');const image='https://gateway.pinata.cloud/ipfs/bafy'+'a'.repeat(55);
 await page.route(image,r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" fill="gold"/></svg>'}));
 await page.evaluate(({mint,image})=>{
  window.fundedVerifiedSearchCandidates=()=>[{mint,symbol:'LOGO',imageUri:image,marketCap:'$12.3K'}];
  const link=document.createElement('a');document.body.append(link);link.id='compact-logo-fixture';
  CommunityFixture.updateCompactTokenLink(link,{mint});
 },{mint,image});
 const link=page.locator('#compact-logo-fixture');await expect(link.locator('img')).toBeVisible();
 await expect(link).toContainText('LOGO');await expect(link).toContainText('Current MC · $12.3K');
 await expect(link).toHaveAttribute('href',`/token/${mint}`);
});
