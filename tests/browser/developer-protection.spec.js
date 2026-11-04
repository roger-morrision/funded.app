import {test,expect} from '@playwright/test';
const mint='So11111111111111111111111111111111111111112',creator='11111111111111111111111111111111';
async function mount(page,tokenLock,bundleDetection={status:'not-scanned'}){
 await page.goto('/tests/launch-review.html');
 await page.evaluate(async({mint,creator,tokenLock,bundleDetection})=>{
  const host=document.createElement('div');host.id='coin-summary-dashboard';document.body.append(host);
  window.Buffer=(await import('/tests/browser/listing-fixture-deps.js')).Buffer;
  const {initializeLaunchProtection}=await import('/src/features/coin/launch-protection.js');
  window.protection=initializeLaunchProtection({connectedWalletAddress:creator,apiRequest:async()=>({available:true,data:{mint,creatorWallet:creator,tokenLock,bundleDetection}})});
  window.dispatchEvent(new CustomEvent('funded:coin-facts',{detail:{launch:{mint}}}));
 },{mint,creator,tokenLock,bundleDetection});
 await expect(page.locator('#coin-launch-protection')).toBeVisible();
}
for(const width of [390,1440])test(`locked developer allocation and partial risk evidence remain visible at ${width}px (mocked)`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await mount(page,{verified:true,status:'locked',amount:'125000000',unlockAt:1800000000,lock:mint,fundingSignature:'test-signature'},
  {status:'suspected-coordination',coverage:{status:'partial',reasons:['Funding scan limit reached.']},clusters:[{wallets:[creator,mint,creator],source:creator,status:'suspected-coordination',holdingPercent:null,caveat:'Shared funding is not proof of ownership.',fundingProofs:[{wallet:creator,signature:'funding-proof'}]}]});
 const panel=page.locator('#coin-launch-protection');await expect(panel).toContainText('125 developer tokens');await expect(panel).not.toContainText('12-hour hold');await expect(panel).not.toContainText('Bundle-wallet signals');await expect(panel.getByRole('button',{name:'Claim unlocked developer tokens'})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('claim is offered only after verified unlock; unavailable history never becomes safe (mocked)',async({page})=>{
 await mount(page,{verified:true,status:'claimable',amount:'1',unlockAt:1800000000,lock:mint},{status:'unavailable'});
 await expect(page.getByRole('button',{name:'Claim unlocked developer tokens'})).toBeVisible();await expect(page.locator('#coin-launch-protection')).not.toContainText('no safety assessment');
 await page.evaluate(()=>window.protection.render({creatorWallet:'different-wallet',tokenLock:{verified:false,status:'unavailable'},bundleDetection:{status:'not-scanned'}}));
 await expect(page.getByRole('button',{name:'Claim unlocked developer tokens'})).toHaveCount(0);await expect(page.locator('#coin-launch-protection')).toContainText('could not be verified');
});
