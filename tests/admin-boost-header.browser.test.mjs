import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {activeBoosts} from '../boost-offer.js';

// Isolated browser with mocked HTTP: exercise the real admin button, shared
// boost loader and token header, including a stale read after closing checkout.
test('admin boost shows its icon and stacked total after closing the popup despite stale reads',async()=>{
  const mint='38M2z4UCfZEkUHFzD48vhKQhFhNyRGto8pZbLjNipump',wallet='fixture-admin';
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage();let count=0;const receipts=[];
    await page.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname;
      const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/')return route.fulfill({contentType:'text/html',body:`<section id="coin-page"><div class="coin-identity"><div><span id="coin-symbol">JIMMY</span><h1 id="coin-page-title">Jimmy Rustles</h1><button id="coin-watch">Favorite</button><button id="coin-boost">Boost</button></div></div></section><dialog id="explore-boost-dialog" open><div id="details"><button class="explore-boost-pay">Pay</button></div><button id="close" onclick="this.closest('dialog').close()">Close</button></dialog>`});
      if(path==='/api/auth/admin')return json({admin:true,wallet});
      if(path==='/api/boosts/admin'){
        const now=Date.now(),receipt={mint,cluster:'mainnet-beta',adminBoost:true,status:'finalized',signature:String(++count).repeat(88),packageId:'10x',multiplier:10,
          startsAt:new Date(now-100).toISOString(),expiresAt:new Date(now+3600000).toISOString()};
        receipts.push(receipt);return json({...receipt,active:activeBoosts(receipts,now,'mainnet-beta')[mint]});
      }
      if(path.startsWith('/api/'))return json({cluster:'mainnet-beta',active:{},listings:[]});
      const body=await readFile(new URL(`..${path}`,import.meta.url));
      return route.fulfill({contentType:'text/javascript',body});
    });
    page.on('dialog',dialog=>dialog.accept());
    await page.goto('http://boost.test/');
    await page.evaluate(async({mint,wallet})=>{
      const {decorateAdminBoost}=await import('/src/features/boost/admin-boost-button.js');
      const {createLaunchRegistryController}=await import('/src/app/controllers/launch-registry.js');
      const {renderCoinPromotionBadge}=await import('/src/features/coin/promotion-view.js');
      const {boostPackageBadgesMarkup}=await import('/boost-card-badges.js');
      const {activeBoostMultiplier}=await import('/boost-offer.js');
      const {apiRequest}=await import('/client.js');
      const state=window.testState={EXPLORE_CLUSTER:'mainnet-beta',assets:[],verifiedBoosts:{},verifiedBoostsAvailable:true,apiRequest,activeBoostMultiplier,
        captureWalletSession:()=>({address:wallet}),boostCheckout:{mint,packageId:'10x'},loadExploreBoostHistory:async()=>{},
        renderExploreBoostDialog(){document.querySelector('.explore-boost-admin')?.remove();decorateAdminBoost(state,document.querySelector('#details'));},
        renderCoinPromotionBadge(){renderCoinPromotionBadge(state,{getCoinMintAddress:()=>mint,exploreBoostAmountMarkup:()=>boostPackageBadgesMarkup(state.verifiedBoosts[mint]),
          verifiedLaunchPolicyForMint:()=>null,renderCoinRegistryIdentity(){},renderCoinRewardsPolicy(){}});}};
      for(const name of ['setCardBoostSnapshot','renderExploreAssets','renderRegistry','renderHomeLaunchBoard','renderWatchlist','renderCreatorLaunches','renderAirdropDirectory'])state[name]=()=>{};
      Object.assign(state,createLaunchRegistryController(state));state.renderExploreBoostDialog();state.renderCoinPromotionBadge();
    },{mint,wallet});
    for(const total of [10,20]){
      await page.getByRole('button',{name:'Boost for free (admin)',exact:true}).click();
      await expect(page.locator('#coin-boost-packages')).toHaveText(`⚡${total}x`);
      await page.waitForFunction(()=>window.testState.boostCheckout.message?.includes('No fee was charged.'));
      await page.locator('#close').click();
      await page.evaluate(()=>window.testState.loadVerifiedBoosts());
      await expect(page.locator('#coin-boost-packages')).toBeVisible();
      await expect(page.locator('#coin-boost-packages')).toHaveText(`⚡${total}x`);
      await expect(page.locator('#coin-boost')).toHaveAttribute('aria-label',`View boost packages · ${total}x total`);
      await page.evaluate(()=>document.querySelector('dialog').showModal());
    }
    assert.equal(count,2);
  } finally {await browser.close();}
});
