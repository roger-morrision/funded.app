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
    await expect(page.locator('#coin-liquidity-label')).toHaveText('Price');
    await page.evaluate(mint=>CommunityFixture.mountHolderRewardsCard({getCoinMintAddress:()=>mint,coinSolUsdPrice:100,apiRequest:async()=>({available:true,data:{cluster:'devnet',tokens:[{mint,symbol:'COMM',holderSharePercent:10,holderPaidLamports:1000000,totals:{holder:2000000},holderPaidWallets:2,holderPayoutCount:2}],events:[]}})}),mint);
    await expect(page.locator('#coin-page > #holder-rewards-card')).toBeVisible();await expect(page.locator('.coin-hero-card #holder-rewards-card')).toHaveCount(0);
    const holder=await page.locator('#holder-rewards-card').boundingBox(),layout=await page.locator('.coin-layout').boundingBox();expect(holder.y).toBeGreaterThanOrEqual(layout.y+layout.height);
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
    for(const [key,name] of [['tracking','Tracking wallets'],['favorites','Favorited coins'],['rewards','My rewards'],['referral','My referral']]){const tab=page.getByRole('tab',{name,exact:true});await tab.click();await expect(tab).toHaveAttribute('aria-selected','true');await expect(page.locator('#portfolio-'+key+'-panel')).toBeVisible();}
    await expect(page.locator('#portfolio-referral-panel a').first()).toHaveAttribute('href','#referrals');
    await page.getByRole('tab',{name:'My rewards',exact:true}).click();
    for(const [label,href] of [['Check my bonus','#bonuses'],['Check my airdrops','#airdrops'],['Check my rewards','#payments']])await expect(page.locator('#portfolio-rewards-panel').getByRole('link',{name:new RegExp(label)})).toHaveAttribute('href',href);
    await expect(page.locator('#portfolio-favorites-link,[data-recovery-shortcut]')).toHaveCount(0);
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

for(const width of [320,390,768,1440,1800])test(`Home compact cards are newest first and trending follows observed volume at ${width}px (mocked)`,async({page},info)=>{
 await setup(page,width,'/#overview');
 await page.evaluate(()=>{
  const assets=Array.from({length:8},(_,i)=>({address:String(i+1).repeat(32),name:'A long community token '+i,symbol:'COIN'+i,createdTimestamp:100+i,volume24hSol:i===0?1000:i===7?null:i,curveCapSol:100+i,verifiedAt:new Date().toISOString(),complete:false}));
  const state={assets,homeLaunchWindow:'24h',homeFeeAmounts:new Map(),EXPLORE_CLUSTER:'devnet',coinSolUsdPrice:100,homeLaunchSort:'volume',verifiedBoosts:{},exploreFeedAvailable:true};
  const policy=()=>({onchainVerified:true});
  CommunityFixture.renderHomeLaunchBoard(state,{verifiedLaunchPolicyForMint:policy,withVerifiedExploreBenefits:x=>x,launchCardVolumeUsd:()=>'$1',exploreBoostAmountMarkup:()=>'',getWatchlist:()=>[],promotionForMint:()=>null,formatCoinUsd:n=>n==null?'—':`$${n}`,loadVerifiedTokenLogos:()=>{},
   setupHomeTicker:(el,html)=>el.innerHTML=html,
   homeLaunchCardMarkup:(item,options)=>CommunityFixture.homeLaunchCardMarkup(item,options,{verifiedBoosts:{},EXPLORE_CLUSTER:'devnet'},{formatOnchainAge:()=> '1h',formatCoinUsd:n=>n==null?'—':`$${n}`}),
   decorateHomeLaunchCard:card=>CommunityFixture.decorateHomeLaunchCard(card,card.dataset.mint,{}, {promotionElement:()=>null,verifiedLaunchPolicyForMint:policy})});
 });
 const cards=page.locator('#home-launch-grid .home-new-token-card');await expect(cards).toHaveCount(6);
 expect(await cards.evaluateAll(nodes=>nodes.map(n=>n.dataset.mint[0]))).toEqual(['8','7','6','5','4','3']);
 await expect(page.locator('#home-market-ticker-items > a').first()).toHaveAttribute('href','/token/'+'1'.repeat(32));
 await expect(page.locator('#home-market-ticker-items > a[href="/token/'+'8'.repeat(32)+'"]')).toHaveCount(0);
 for(const card of await cards.all()){await expect(card).toBeVisible();await expect(card.locator('.home-launch-media-package')).toContainText('Standard');const box=await card.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);}
 const art=await cards.first().locator('.home-new-token-art').boundingBox();expect(Math.abs(art.width-art.height)).toBeLessThan(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('.home-launch-board').screenshot({path:info.outputPath(`compact-cards-${width}.png`)});
});

test('connected balance is wallet-scoped and post result explains missing calls (mocked)',async({page})=>{
 await setup(page,390,'/#launch');await page.locator('#token-name').fill('Balance fixture');await page.locator('#token-symbol').fill('BAL');await page.locator('#launch-next').click();
 for(const [wallet,status,expected]of[['wallet-a','ready','1234.5 $FUNDED available'],['wallet-b','ready','Balance unavailable'],['wallet-a','loading','Checking Devnet balance']]){
  await page.evaluate(({wallet,status})=>CommunityFixture.renderLaunchBurnSelection({connectedWalletAddress:'wallet-a',fundedBurnState:{wallet,status,balanceBaseUnits:1234500000n,decimals:6},LAUNCH_BURN_TIERS:[],launchTierPricing:{},launchBurnReadiness:{ready:true}}, {getLaunchBurnPolicy:()=>({tier:'standard',label:'Standard',requiresBurn:false}),currentLaunchTierAmounts:()=>null,currentLaunchTierQuote:()=>null,formatLaunchBurnAmount:String}),{wallet,status});
  await expect(page.locator('#launch-tier-wallet-balance')).toContainText(expected);await expect(page.locator('#launch-tier-wallet-balance')).toBeVisible();
 }
 await page.goto('/token/'+mint);await page.locator('body.product-flows-ready').waitFor();await page.addScriptTag({content:fixture});await page.locator('[data-coin-tab="chat"]').click();
 await page.evaluate(()=>CommunityFixture.showChatPostResult({calloutStatus:'holdings-unavailable'}));await expect(page.locator('#coin-chat-post-result')).toContainText('no call was recorded');
 await page.evaluate(()=>CommunityFixture.showChatPostResult({calloutStatus:'recorded',message:{callout:{}}}));await expect(page.locator('#coin-chat-post-result a')).toHaveAttribute('href','#callouts');
});

test('tracked wallet displays a compact identity card and can be unfollowed (local storage fixture)',async({page},info)=>{
 await page.addInitScript(mint=>localStorage.setItem('funded.app.followed.wallets.v1',JSON.stringify([{address:mint,roles:['creator']}])) ,mint);
 await setup(page,390,'/#my-launches');await page.getByRole('tab',{name:'Tracking wallets',exact:true}).click();
 const card=page.locator('.portfolio-wallet-card');await expect(card).toHaveCount(1);await expect(card.locator('.portfolio-wallet-avatar')).toBeVisible();await expect(card.getByRole('link',{name:'View wallet'})).toHaveAttribute('href','/wallet/'+mint);
 await page.screenshot({path:info.outputPath('tracked-wallet.png'),animations:'disabled'});await card.getByRole('button',{name:/Unfollow/}).click();await expect(card).toHaveCount(0);
});
