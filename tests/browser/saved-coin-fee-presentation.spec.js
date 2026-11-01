import{test,expect}from'@playwright/test';
import{buildFeeDistributionPolicy}from'../../distribution-policy.js';
// Local renderer fixture: real view + policy validation, no RPC or transaction flow.
for(const width of[320,390,1440])test(`saved legacy and agency coin policies keep their own allocation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.route('**/fee-renderer-fixture',r=>r.fulfill({contentType:'text/html',body:'<link rel="stylesheet" href="/styles/fee-distribution-summary.css"><section id="coin-page"><div class="coin-hero-card"><div class="coin-stat-strip"><div id="coin-fee-route"><strong id="coin-fee-route-value"></strong></div></div></div></section>'}));await page.goto('/fee-renderer-fixture');
 const render=async agency=>page.evaluate(async agency=>{
  const{buildFeeDistributionPolicy}=await import('/distribution-policy.js'),{renderCoinRewardsPolicy}=await import('/src/features/coin/promotion-view.js');
  if(agency===null){renderCoinRewardsPolicy(null,'coin-fixture',{EXPLORE_CLUSTER:'devnet'},{verifiedLaunchPolicyForMint:()=>null});return;}
  const fundedSplit=agency?{operationsPercent:40,referralLevelPercents:[3,1.25,0.75],communityPercent:20,buybackPercent:25,agencyPercent:10}:{operationsPercent:40,referralLevelPercents:[10,3,2],communityPercent:20,buybackPercent:25};
  const policy={mint:'coin-fixture',cluster:'devnet',onchainVerified:true,policySignature:'fixture-only',feeDistribution:buildFeeDistributionPolicy({creatorWalletPercent:50,holderAirdropPercent:20,solClaimPercent:10,xRecipient:'@sample'},{fundedSplit})};
  renderCoinRewardsPolicy(policy,policy.mint,{EXPLORE_CLUSTER:'devnet'},{verifiedLaunchPolicyForMint:()=>null});
 },agency);
 await render(false);const details=page.locator('.coin-fixed-fee-details');await expect(details).toHaveCount(1);await expect(page.locator('#coin-page > .coin-fixed-fee-details')).toHaveCount(1);await details.locator(':scope > summary').click();await expect(details.locator('[data-fee-category="referrals"] strong')).toHaveText('3%');await expect(details.locator('[data-fee-category="agency"]')).toHaveCount(0);
 await details.locator(':scope > summary').focus();await render(true);await expect(details.locator(':scope > summary')).toBeFocused();await expect(details).toHaveAttribute('open','');await expect(details.locator('[data-fee-category="referrals"] strong')).toHaveText('1%');await expect(details.locator('[data-fee-category="agency"] strong')).toHaveText('2%');await expect(page.locator('#coin-fee-route-value')).toContainText('Creator 50% · Holders 20%');
 for(let i=0;i<10;i++)await render(true);await expect(details).toHaveCount(1);await expect(details.locator(':scope > summary')).toBeFocused();
 await page.evaluate(()=>{const copy=document.querySelector('.coin-fixed-fee-details').cloneNode(true);copy.dataset.focusedCopy='true';document.querySelector('.coin-hero-card').append(copy);copy.querySelector('summary').focus();});
 await render(true);await expect(details).toHaveCount(1);await expect(details).toHaveAttribute('data-focused-copy','true');await expect(details.locator(':scope > summary')).toBeFocused();await expect(page.locator('#coin-page > .coin-fixed-fee-details')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.evaluate(()=>{const copy=document.querySelector('.coin-fixed-fee-details').cloneNode(true);document.querySelector('.coin-hero-card').append(copy);});await render(null);await expect(details).toHaveCount(0);await expect(page.locator('#coin-fee-route')).toBeHidden();
});

const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z';
const split={operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10};
for(const width of[390,1440])test(`one saved fee panel survives token refreshes at ${width}px (mocked APIs)`,async({page,baseURL},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width,height:900});await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
 const errors=[],writes=[];let legacy=false,reads=0;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(baseURL).origin?r.fallback():r.abort());
 await page.route('**/api/**',r=>{
  const q=r.request(),path=new URL(q.url()).pathname;
  if(path==='/api/fee-policy')return r.fulfill({json:{revision:6,split}});
  if(path==='/api/launches'){reads++;return r.fulfill({json:[{mint,creatorWallet:mint,cluster:'devnet',onchainVerified:true,policySignature:'fixture-only',name:'Fee panel fixture',symbol:'FEE',feeDistribution:buildFeeDistributionPolicy({creatorWalletPercent:50,holderAirdropPercent:20,solClaimPercent:10,xRecipient:'@sample'},{fundedSplit:legacy?{...split,referralLevelPercents:[10,3,2],agencyPercent:undefined}:split})}]});}
  if(path==='/api/solana/rpc'){
   const body=q.postDataJSON(),calls=Array.isArray(body)?body:[body],rows=calls.map(c=>{
    if(!/^(get|isBlockhashValid$)/.test(c.method))writes.push(c.method);let result=null;
    if(c.method==='getSlot')result=100;
    if(c.method==='getAccountInfo')result={context:{slot:100},value:c.params?.[0]===mint?{lamports:1000000,executable:false,owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',rentEpoch:0,data:{program:'spl-token',parsed:{type:'mint',info:{decimals:6,supply:'1000000000000000',isInitialized:true,mintAuthority:null,freezeAuthority:null}},space:82}}:null};
    if(c.method==='getTokenLargestAccounts'||c.method==='getTokenAccountsByOwner')result={context:{slot:100},value:[]};
    if(c.method==='getMultipleAccounts')result={context:{slot:100},value:c.params[0].map(()=>null)};
    if(c.method==='getProgramAccounts'||c.method==='getSignaturesForAddress')result=[];
    return{jsonrpc:'2.0',id:c.id,result};});return r.fulfill({json:Array.isArray(body)?rows:rows[0]});
  }
  if(q.method()!=='GET')writes.push(path);return r.fulfill({status:503,json:{error:'Unavailable fee-panel fixture'}});
 });
 await page.goto(`/token/${mint}`);await page.locator('body.workspace-ready.product-experience-ready.product-flows-ready').waitFor();
 const panel=page.locator('#coin-page .coin-fixed-fee-details');await expect(panel).toHaveCount(1);await panel.locator(':scope > summary').click();await expect(panel.locator('[data-fee-category="referrals"] strong')).toHaveText('1%');
 await expect(panel.locator(':scope > summary')).toHaveText('Saved fee distribution');await expect(panel.locator('.fee-distribution-summary--compact')).toBeVisible();await expect(panel.locator('.fee-distribution-categories small')).toHaveCount(0);
 const benefitDetails=panel.locator('.fee-distribution-details');await expect(benefitDetails).not.toHaveAttribute('open','');await benefitDetails.locator(':scope > summary').click();await expect(benefitDetails).toContainText('Who receives it');await benefitDetails.locator(':scope > summary').click();
 for(let i=0;i<3;i++){const before=reads;await page.locator('#coin-refresh').click();await expect.poll(()=>reads).toBeGreaterThan(before);await expect(panel).toHaveCount(1);await expect(panel.locator('[data-fee-category="agency"] strong')).toHaveText('2%');}
 await expect(page.locator('#coin-page .coin-hero-card .coin-fixed-fee-details')).toHaveCount(0);await expect(panel).toHaveAttribute('open','');
 legacy=true;await page.locator('#coin-refresh').click();await expect(panel.locator('[data-fee-category="referrals"] strong')).toHaveText('3%');await expect(panel.locator('[data-fee-category="agency"]')).toHaveCount(0);await expect(panel).toHaveCount(1);
 await panel.screenshot({path:info.outputPath(`single-fee-panel-${width}.png`)});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);expect(writes).toEqual([]);
});
