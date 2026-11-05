import {test,expect} from '@playwright/test';
const mint='So11111111111111111111111111111111111111112',creator='11111111111111111111111111111111';
async function mount(page,tokenLock,bundleDetection={status:'not-scanned'}){
 await page.goto('/tests/launch-review.html');
 await page.evaluate(async({mint,creator,tokenLock,bundleDetection})=>{
  const host=document.createElement('div');host.id='coin-page';host.innerHTML='<div class="coin-socials"></div>';document.body.append(host);
  window.Buffer=(await import('/tests/browser/listing-fixture-deps.js')).Buffer;
  const {initializeLaunchProtection}=await import('/src/features/coin/launch-protection.js');
  window.protectionData={mint,creatorWallet:creator,tokenLock,bundleDetection};
  window.protectionState={connectedWalletAddress:creator,apiRequest:async()=>({available:true,data:window.protectionData})};
  window.protection=initializeLaunchProtection(window.protectionState);
  window.dispatchEvent(new CustomEvent('funded:coin-facts',{detail:{launch:{mint}}}));
 },{mint,creator,tokenLock,bundleDetection});
 await expect(page.locator('#coin-launch-protection')).toHaveCount(0);
}
for(const width of [390,1440])test(`public developer risk panel stays removed at ${width}px (mocked)`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await mount(page,{verified:true,status:'locked',amount:'125000000',unlockAt:1800000000,lock:mint,fundingSignature:'test-signature'},
  {status:'suspected-coordination',coverage:{status:'partial',reasons:['Funding scan limit reached.']},clusters:[{wallets:[creator,mint,creator],source:creator,status:'suspected-coordination',holdingPercent:null,caveat:'Shared funding is not proof of ownership.',fundingProofs:[{wallet:creator,signature:'funding-proof'}]}]});
 await expect(page.locator('#coin-developer-token-claim')).toBeHidden();await expect(page.getByRole('button',{name:'Claim unlocked developer tokens'})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('connecting, switching and disconnecting wallets updates the escrow claim action (mocked)',async({page})=>{
 await mount(page,{verified:true,status:'claimable',amount:'1',unlockAt:1800000000,lock:mint});
 const claim=page.getByRole('button',{name:'Claim unlocked developer tokens'});
 for(const address of [null,'different-wallet',creator,null]){
  await page.evaluate(address=>{window.protectionState.connectedWalletAddress=address;window.dispatchEvent(new Event('funded:reward-identity-change'));},address);
  await expect(claim).toHaveCount(address===creator?1:0);
 }
});

test('refresh checks finalized lock status before offering a claim and removes stale claims on failure (mocked)',async({page})=>{
 await mount(page,{verified:true,status:'locked',amount:'1',unlockAt:1800000000,lock:mint});
 const claim=page.getByRole('button',{name:'Claim unlocked developer tokens'});
 await page.evaluate(()=>{window.protectionData.tokenLock.status='claimable';});
 await expect(claim).toHaveCount(0);
 await page.evaluate(()=>window.protection.refresh());await expect(claim).toBeVisible();
 await page.evaluate(()=>{window.protectionState.apiRequest=async()=>({available:false});});
 await page.evaluate(()=>window.protection.refresh());await expect(claim).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('funded:reward-identity-change')));
 await expect(claim).toHaveCount(0);
});
test('claim is offered only after verified unlock; unavailable history never becomes safe (mocked)',async({page})=>{
 await mount(page,{verified:true,status:'claimable',amount:'1',unlockAt:1800000000,lock:mint},{status:'unavailable'});
 await expect(page.getByRole('button',{name:'Claim unlocked developer tokens'})).toBeVisible();
 await page.evaluate(()=>window.protection.render({creatorWallet:'different-wallet',tokenLock:{verified:false,status:'unavailable'},bundleDetection:{status:'not-scanned'}}));
 await expect(page.getByRole('button',{name:'Claim unlocked developer tokens'})).toHaveCount(0);await expect(page.locator('#coin-developer-token-claim')).toBeHidden();
});
