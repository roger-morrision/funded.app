import {installAccountFixture} from '../fixtures/account-browser-fixture.mjs';
import {test,expect} from '@playwright/test';
import {build} from 'vite';
import {fileURLToPath} from 'node:url';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const built=await build({root,configFile:false,logLevel:'silent',build:{write:false,lib:{entry:root+'tests/fixtures/community-layout.js',name:'CommunityFixture',formats:['iife']}}});
const fixture=built[0].output.find(row=>row.type==='chunk').code;
const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z',signature='3'.repeat(64);
for(const width of [320,390,768,1440])test(`Home unified conversation rail at ${width}px (mocked)`,async({page},info)=>{
 const now=new Date().toISOString(),base={mint,author:mint,createdAt:now};
 await setup(page,width,'/#overview',[
  {...base,id:'chat_plain',text:'Hello community <script>not executable</script>'},
  {...base,id:'chat_call',text:'Holding this coin',callout:{purchasedSol:null,pnlSol:null,marketChangePercent:12.5}},
  ...Array.from({length:8},(_,i)=>({...base,id:`chat_${i}`,text:'Another message'}))]);
 const panel=page.locator('#home-community');await expect(panel).toBeVisible();
 await expect(panel.locator('.home-community-message')).toHaveCount(10);
 await expect(panel.locator('.home-community-token .home-token-avatar')).toHaveCount(10);
 await expect(panel.locator('.home-community-token strong').first()).toHaveText('$COMM');
 await expect(panel.locator('[data-report-message]')).toHaveCount(0);
 await expect(panel.locator('[data-message-id="chat_plain"] .home-community-metrics')).toHaveCount(0);
 await expect(panel.locator('[data-message-id="chat_call"]')).toContainText('Purchased-P&L-');
 await expect(panel.locator('[data-message-id="chat_call"]')).toContainText('MC since call: +12.5%');
 await expect(panel.locator('script')).toHaveCount(0);await expect(panel.locator('form button')).toHaveText('Connect wallet to chat');
 await expect(panel.locator('textarea')).toHaveAttribute('maxlength','280');
 const rail=await panel.boundingBox(),coins=await page.locator('.home-discovery-coins').boundingBox();
 if(width>1100)expect(rail.x).toBeGreaterThanOrEqual(coins.x+coins.width);else expect(rail.y).toBeGreaterThanOrEqual(coins.y+coins.height);
 expect(await panel.locator('.home-community-feed').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await panel.screenshot({path:info.outputPath(`community-${width}.png`)});
});
async function setup(page,width,path,feed){
  await page.setViewportSize({width,height:900});await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',r=>/\/api\/(?:referrals\/session|account-preferences|watchlist|x\/me)/.test(new URL(r.request().url()).pathname)?r.fallback():r.fulfill({status:503,json:{error:'Mocked unavailable'}}));
  await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/launches',r=>r.fulfill({json:[{mint,signature,cluster:'devnet',onchainVerified:true,creatorWallet:mint,name:'Community fixture',symbol:'COMM',creatorLaunchBurn:{tier:'pro',status:'verified',amountTokens:1000,receipt:{signature,verified:true,atomicWithPumpLaunch:true}}}]}));
  await page.route(`**/api/tokens/${mint}/chat`,r=>r.fulfill({json:{messages:[],enabled:true}}));
  if(feed)await page.route('**/api/token-chat/feed',r=>r.fulfill({json:{messages:feed}}));
  await page.goto(path);await page.locator('body.product-flows-ready').waitFor();await page.addScriptTag({content:fixture});
}
test('Home composer connects without posting, then posts to selected token (mocked wallet)',async({page})=>{
 await setup(page,390,'/#overview',[]);
 await page.evaluate(mint=>{
  document.querySelector('#home-community').remove();window.homeTestCalls=[];
  const app={connectedWalletAddress:null,assets:[{address:mint,symbol:'COMM'}],tokenChatSessionReady:()=>true,
   connectWallet:async()=>{app.connectedWalletAddress=mint;},apiRequest:async()=>({available:true,data:{messages:[]}}),
   tokenChatRequest:async(action,payload,target)=>{homeTestCalls.push({action,payload,target});return {available:true,data:action==='post'?{message:{id:'posted'},calloutStatus:'recorded'}:{reported:true}};}};
  CommunityFixture.mountHomeCommunity(app);
 },mint);
 const panel=page.locator('#home-community');await panel.getByRole('button',{name:'Connect wallet to chat'}).click();
 expect(await page.evaluate(()=>homeTestCalls)).toEqual([]);
 await panel.locator('select').selectOption(mint);await panel.locator('textarea').fill('My selected token');await panel.getByRole('button',{name:'Post',exact:true}).click();
 await expect(panel.locator('[role="status"]')).toHaveText('Call posted.');await expect(panel.locator('textarea')).toHaveValue('');
 expect(await page.evaluate(()=>homeTestCalls)).toEqual([{action:'post',payload:{text:'My selected token'},target:mint}]);
});
for(const width of [320,390,768,1440]) {
  test(`token header, single Post and rewards dashboard at ${width}px (mocked data)`,async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));await setup(page,width,`/token/${mint}`);
    await expect(page.locator('.coin-hero-card')).toHaveAttribute('data-launch-tier','pro');
    await expect(page.locator('#coin-liquidity-label')).toHaveText('Price');
    await expect(page.locator('#coin-retry')).toHaveCount(0);await expect(page.locator('#coin-refresh')).toBeVisible();
    await expect(page.locator('#coin-strip-volume')).toBeVisible();await expect(page.locator('#coin-strip-trades')).toBeVisible();
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
    if(width===1440){
      await page.evaluate(()=>{document.querySelector('.coin-hero-card').dataset.launchTier='standard';document.querySelector('.coin-artwork').hidden=true;document.querySelector('#coin-fee-route').hidden=false;document.querySelector('#coin-fee-route-value').textContent='Holders 80%';document.querySelector('.coin-stat-strip').classList.add('has-fee-allocation');});
      const stats=await page.locator('.coin-stat-strip > div').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width};}));
      expect(stats).toHaveLength(6);expect(stats[0].y).toBe(stats[2].y);expect(stats[3].y).toBe(stats[5].y);expect(Math.abs(stats[3].width-stats[5].width)).toBeLessThan(1);
      expect((await page.locator('.coin-hero-card').boundingBox()).height).toBeLessThan(420);
      await page.locator('.coin-hero-card').screenshot({path:info.outputPath('header-standard-1440.png')});
    }
  });
  test(`saved Portfolio tabs and confirmed-success popup at ${width}px (mocked data)`,async({page},info)=>{
    await setup(page,width,'/#my-launches');
    for(const [key,name] of [['tracking','Tracking wallets'],['favorites','Favorited coins'],['rewards','My rewards'],['referral','My referral']]){const tab=page.getByRole('tab',{name,exact:true});await tab.click();await expect(tab).toHaveAttribute('aria-selected','true');await expect(page.locator('#portfolio-'+key+'-panel')).toBeVisible();}
    await expect(page.locator('#portfolio-referral-panel a').first()).toHaveAttribute('href','#referrals');
    await page.getByRole('tab',{name:'My rewards',exact:true}).click();
    for(const [label,href] of [['View bonus history','#bonuses'],['View airdrops','#airdrops'],['View rewards','#payments']])await expect(page.locator('#portfolio-rewards-panel').getByRole('link',{name:new RegExp(label)})).toHaveAttribute('href',href);
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

for(const width of [320,390,768,1440,1800])test(`Home compact cards are newest first and trending follows observed participation at ${width}px (mocked)`,async({page},info)=>{
 await setup(page,width,'/#overview');
 await page.evaluate(()=>{
  document.querySelector('.home-launch-board').dataset.discovery='new';
  const assets=Array.from({length:8},(_,i)=>({address:String(i+1).repeat(32),name:'A long community token '+i,symbol:'COIN'+i,createdTimestamp:100+i,volume24hSol:i===0?1000:i===7?null:i,curveCapSol:100+i,verifiedAt:new Date().toISOString(),complete:false,activityWindows:{'24h':{coverage:'partial',trending:{basis:'observed-wallet-participation-v1',score:i===7?0:10-i,walletCount:3}}}}));
  const state={assets,homeLaunchWindow:'24h',homeFeeAmounts:new Map(),EXPLORE_CLUSTER:'devnet',coinSolUsdPrice:100,homeLaunchSort:'volume',verifiedBoosts:{},exploreFeedAvailable:true};
  assets[7].migrated=true;assets[7].holders=12;
  assets[6].curveProgressBasis='pump-global';assets[6].curveProgressPercent=42;assets[6].holderWalletCount=23;assets[6].holderWalletCoverage='lower-bound';
  const policy=()=>({onchainVerified:true});
  CommunityFixture.renderHomeLaunchBoard(state,{verifiedLaunchPolicyForMint:policy,withVerifiedExploreBenefits:x=>x,launchCardVolumeUsd:()=>'$1',exploreBoostAmountMarkup:()=>'',getWatchlist:()=>[],promotionForMint:()=>null,formatCoinUsd:n=>n==null?'—':`$${n}`,loadVerifiedTokenLogos:()=>{},
   setupHomeTicker:(el,html)=>el.innerHTML=html,
   homeLaunchCardMarkup:(item,options)=>CommunityFixture.homeLaunchCardMarkup(item,options,{verifiedBoosts:{[assets[7].address]:{multiplier:10,expiresAt:new Date(Date.now()+3600000).toISOString()}},EXPLORE_CLUSTER:'devnet'},{formatOnchainAge:()=> '1h',formatCoinUsd:n=>n==null?'—':`$${n}`}),
   decorateHomeLaunchCard:card=>CommunityFixture.decorateHomeLaunchCard(card,card.dataset.mint,{}, {promotionElement:()=>null,verifiedLaunchPolicyForMint:policy})});
 });
 const cards=page.locator('#home-launch-grid .home-new-token-card');await expect(cards).toHaveCount(6);
 expect(await cards.evaluateAll(nodes=>nodes.map(n=>n.dataset.mint[0]))).toEqual(['8','7','6','5','4','3']);
 await expect(cards.first().locator('.home-new-token-holders')).toHaveText('Holders12');
 await expect(cards.first().getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
 await expect(cards.nth(1).locator('.home-new-token-holders')).toHaveText('Holders≥23');
 await expect(cards.nth(1).getByRole('progressbar')).toHaveAttribute('aria-valuenow','42');
 await expect(cards.nth(2).locator('.home-new-token-holders')).toHaveText('Holders-');
 await expect(cards.nth(2).locator('.home-new-token-track')).not.toHaveAttribute('aria-valuenow');
 await expect(cards.first().locator('.home-new-token-heading .boost-package-badge')).toHaveText('⚡10x');
 await expect(page.locator('#home-launch-grid .participation-note')).toHaveCount(0);
 const holders=await cards.first().locator('.home-new-token-holders').boundingBox(),progress=await cards.first().locator('.home-new-token-progress').boundingBox();expect(holders.y+holders.height).toBeLessThanOrEqual(progress.y);
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

test('tracked wallet displays a compact identity card and can be unfollowed (authenticated account fixture)',async({page},info)=>{
 const account=await installAccountFixture(page);account.preferences.wallets=[{address:mint,roles:['creator']}];
 await setup(page,390,'/#my-launches');await account.connect();await page.getByRole('tab',{name:'Tracking wallets',exact:true}).click();
 const card=page.locator('.portfolio-wallet-card');await expect(card).toHaveCount(1);await expect(card.locator('.portfolio-wallet-avatar')).toBeVisible();await expect(card.getByRole('link',{name:'View wallet'})).toHaveAttribute('href','/wallet/'+mint);
 await page.screenshot({path:info.outputPath('tracked-wallet.png'),animations:'disabled'});await card.getByRole('button',{name:/Unfollow/}).click();await expect(card).toHaveCount(0);
});

for(const reduced of [false,true])test(`Home trade animation pauses under pointer and keyboard focus; reduced motion ${reduced} (mocked trades)`,async({page})=>{
 await setup(page,1440,'/#overview');await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await page.mouse.move(0,0);
 await page.evaluate(()=>{
  window.liveFixtureClock=1000000;window.liveFixtureRows=[{address:'old',createdTimestamp:1},{address:'new',createdTimestamp:2}];document.querySelector('#home-launch-grid').replaceChildren();
  window.renderLiveFixture=()=>CommunityFixture.homeLiveCards(document.querySelector('#home-launch-grid'),window.liveFixtureRows,{now:()=>window.liveFixtureClock,markup:item=>`<article class="home-new-token-card" data-mint="${item.address}"><a class="home-new-token-link" href="#${item.address}" aria-label="${item.address}"></a><div class="home-new-token-art">${item.address}</div></article>`,decorate:()=>{},loadLogos:()=>{}});window.renderLiveFixture();
 });
 const cards=page.locator('#home-launch-grid .home-new-token-card');await expect(cards.first()).toHaveAttribute('data-mint','new');await cards.first().hover();
 const hoverAnimation=await cards.first().evaluate(n=>getComputedStyle(n).animationName);expect(hoverAnimation).toBe(reduced?'none':'home-card-vibrate');
 await page.evaluate(()=>{window.liveFixtureClock+=1000;window.liveFixtureRows[0].recentTrades=[{signature:'3'.repeat(88),side:'buy',blockTime:1001}];window.renderLiveFixture();});await expect(cards.first()).toHaveAttribute('data-mint','new');
 await page.mouse.move(0,0);await expect(cards.first()).toHaveAttribute('data-mint','old');await expect(cards.first()).toHaveClass(/has-new-trade/);expect(await cards.first().evaluate(n=>getComputedStyle(n).animationName)).toBe(reduced?'none':'home-card-trade');
 await cards.first().locator('a').focus();await page.evaluate(()=>{window.liveFixtureClock+=1000;window.liveFixtureRows[1].recentTrades=[{signature:'4'.repeat(88),side:'sell',blockTime:1002}];window.renderLiveFixture();});await expect(cards.first()).toHaveAttribute('data-mint','old');await expect(cards.first().locator('a')).toBeFocused();
 await page.evaluate(()=>document.activeElement.blur());await expect(cards.first()).toHaveAttribute('data-mint','new');
});
