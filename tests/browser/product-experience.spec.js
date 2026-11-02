import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const mint='9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B',wallet='So11111111111111111111111111111111111111112',sig='4'.repeat(64);
async function setup(page,width){
  await page.setViewportSize({width,height:900});await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('https://**/*',route=>process.env.BUILT_BASE&&new URL(route.request().url()).origin===new URL(process.env.BUILT_BASE).origin?route.fallback():route.abort());await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Mocked offline'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/launches',route=>route.fulfill({json:[{mint,creatorWallet:wallet,onchainVerified:true,cluster:'devnet',name:'Recorded fixture',symbol:'REC',createdAt:'2026-10-01T00:00:00Z'}]}));
  await page.route('**/api/rewards/experience**',route=>route.fulfill({json:{cluster:'devnet',evidence:{status:'recorded-finalized-v3'},events:[],tokens:[]}}));
  await page.route('**/api/financial/activity',route=>route.fulfill({json:{cluster:'devnet',statements:[]}}));
}
async function ready(page,path){await page.goto(path);await expect(page.locator('body')).toHaveClass(/product-flows-ready/);}
for(const width of [390,1440]){
  test(`saved preferences, explicit guest import, and unavailable reporting at ${width}px`,async({page})=>{
    await setup(page,width);const errors=[];page.on('pageerror',error=>errors.push(error.message));await ready(page,'/#profile');
    await expect(page.locator('#personal-activity-feed')).not.toBeVisible();
    await page.locator('#notification-preferences-details > summary').click();const preferences=page.locator('#notification-preferences');await preferences.getByLabel('Enable creator activity notices').check();await preferences.getByLabel('Minimum receipt amount (SOL)').fill('0.1');await preferences.getByRole('button',{name:'Save notification preferences'}).click();await expect(preferences).toContainText('Preferences saved');
    await page.locator('#trade-preferences-details > summary').click();const limits=page.locator('#trade-preferences');await limits.getByLabel('Maximum slippage (%)').fill('1');await limits.getByLabel('Estimated network fee cap (SOL)').fill('0.000005');await limits.getByRole('button',{name:'Save trade limits'}).click();
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('funded.trade-preferences.v1')).slippageCap)).toBe(1);
    await page.locator('#preference-transfer-details > summary').click();const transfer=page.locator('#preference-transfer');await transfer.getByLabel('Preference import or export JSON').fill(JSON.stringify({version:1,wallets:[{address:wallet,roles:['creator']}],creators:['123'],reminders:[]}));await transfer.getByRole('button',{name:'Review import',exact:true}).click();
    expect(await page.evaluate(()=>localStorage.getItem('funded.app.followed.wallets.v1'))).toBeNull();await transfer.getByRole('button',{name:'Apply reviewed merge'}).click();await expect(transfer).toContainText('Reviewed preferences merged');
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('funded.app.followed.wallets.v1'))[0].address)).toBe(wallet);
    await page.locator('#issue-reports-details > summary').click();const report=page.locator('#issue-reports');await report.getByLabel('Describe what happened').fill('The form was unavailable during testing');await report.getByRole('button',{name:'Review report',exact:true}).click();await expect(report.locator('pre')).toContainText('The form was unavailable');await expect(report.getByRole('button',{name:'Send reviewed report'})).toBeDisabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);expect(errors).toEqual([]);
  });
  test(`launch form omits planning and saved-draft controls at ${width}px`,async({page},info)=>{
    await page.addInitScript(()=>{
      const key='funded.launch-plans.v1';localStorage.setItem(key,JSON.stringify([{id:'11111111-1111-4111-8111-111111111111',at:Date.now()+60000,draft:{'token-name':'Old planned token','token-symbol':'OLD'}}]));
      window.removedDraftReads=0;const read=Storage.prototype.getItem;Storage.prototype.getItem=function(name){if(name===key)window.removedDraftReads++;return read.call(this,name);};
    });
    await setup(page,width);const writes=[];page.on('request',req=>{if(req.method()==='POST'){if(req.url().includes('/api/solana/rpc')){const body=req.postDataJSON();for(const row of Array.isArray(body)?body:[body])expect(row.method).toMatch(/^get/);}else writes.push(req.url());}});await ready(page,'/#launch');await expect(page.locator('#personal-activity-feed')).not.toBeVisible();
    await expect(page.locator('#launch-planner,#launch-control-room')).toHaveCount(0);await expect(page.locator('#launch-form input[type="datetime-local"]')).toHaveCount(0);
    await expect(page.locator('#token-name')).toHaveValue('');await page.locator('#token-name').fill('Clean launch');await page.locator('#token-symbol').fill('CLEAN');await page.locator('#launch-next').click();
    await expect(page.locator('#launch-final-terms')).toHaveCount(0);await expect(page.locator('#fee-route-agree')).not.toBeChecked();await expect(page.locator('#terms-agree')).not.toBeChecked();
    await expect(page.locator('#launch-agency-options .agency-included-badge')).toHaveCount(3);await expect(page.locator('#launch-button')).toBeDisabled();
    await page.evaluate(()=>{location.hash='my-launches';});await expect(page.locator('#my-launches')).toBeVisible();await expect(page.locator('#launch-control-room')).toHaveCount(0);
    await expect(page.getByRole('button',{name:/Save planned draft|Resume draft|Delete plan/})).toHaveCount(0);await expect(page.locator('.portfolio-tools')).toHaveAttribute('aria-label','Transaction recovery');
    expect(await page.evaluate(()=>window.removedDraftReads)).toBe(0);expect(writes.filter(url=>!url.includes('/api/product/'))).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    await page.screenshot({path:info.outputPath(`portfolio-without-drafts-${width}.png`),fullPage:true});
  });
  test(`exact receipt links preserve evidence and unknown costs at ${width}px`,async({page})=>{
    await setup(page,width);await page.route(`**/api/financial/receipts/${sig}**`,route=>route.fulfill({json:{cluster:'devnet',signature:sig,evidence:'recorded-finalized-v3',currentRpcRecheck:false,events:[{mint,kind:'holder-paid',label:'Holder reward paid',amountLamports:'15',at:null}],recipients:[{wallet,amountLamports:'15',kind:'holder-paid'}],burns:[],sourceSignatures:[],coverage:'Recorded fixture only'}}));
    await ready(page,`/?receipt=${sig}&mint=${mint}&wallet=${wallet}#payments/activity`);const dialog=page.locator('#receipt-inspector');await expect(dialog).toBeVisible();await expect(dialog).toContainText('current RPC recheck is not included');await expect(dialog).toContainText('Time unavailable');await expect(dialog).toContainText('0.000000015 SOL');await expect(dialog).toContainText('Fee payer and recipient net after network costs: unavailable');
    await dialog.getByRole('button',{name:'Close receipt'}).click();await expect(dialog).not.toBeVisible();await expect(page).not.toHaveURL(/receipt=/);
  });
  test(`followed creator notifications still receive receipts without the Home feed at ${width}px`,async({page})=>{
    await setup(page,width);await page.addInitScript(address=>localStorage.setItem('funded.app.followed.wallets.v1',JSON.stringify([{address,roles:['creator']} ])),wallet);await ready(page,'/');
    await page.evaluate(()=>{location.hash='profile';});await page.locator('#profile [data-open-activity]').click();await page.locator('.creator-activity [data-creator-alerts]').check();const notices=page.locator('[data-creator-notices]');await expect(notices).toContainText('REC launched');
    await page.evaluate(({mint,sig})=>window.dispatchEvent(new CustomEvent('funded:financial-experience',{detail:{cluster:'devnet',evidence:{status:'recorded-finalized-v3'},events:[{mint,signature:sig,kind:'holder-paid',label:'New verified receipt',feeSourceVerified:true,amountLamports:'10',at:new Date().toISOString()}]}})),{mint,sig});
    await expect(notices).toContainText('New verified receipt');await expect(notices).toContainText('REC launched');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  });
  test(`recorded engine health and creator wallet facts at ${width}px (mocked ledger)`,async({page})=>{
    await setup(page,width);await page.route('**/api/financial/operations',route=>route.fulfill({json:{cluster:'devnet',evidence:'recorded-finalized-v3',completedRecordedOperations:2,pendingBuybackOperations:1,failedRecordedOperations:0,retryAttempts:null,oldestPendingSeconds:60,lastVerifiedDeliveryAt:null,timing:{fundedToVerifiedHolderPayment:{samples:1,medianSeconds:10,p95Seconds:10}},creators:[{wallet,launches:2,verifiedPaymentReceipts:3,returningRecipients:1,badges:['Verified reward delivery']}],retentionCoverage:'Recorded paid wallets, not unique people',coverage:'Latest recorded events',generatedAt:new Date().toISOString()}}));
    await ready(page,'/#payments/activity');await page.getByText('Financial engine health & creator delivery',{exact:true}).click();const health=page.locator('#financial-engine');await expect(health).toContainText('10s');await expect(health).toContainText('Vault reconciliation: unavailable');await expect(health).toContainText('Retry-attempt countUnavailable');
    await page.goto(`/wallet/${wallet}`);await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
    await page.locator('#wallet-page summary').filter({hasText:'Creator delivery facts'}).click();await expect(page.locator('#creator-wallet-facts')).toContainText('3 recorded payment receipts');await expect(page.locator('#creator-wallet-facts')).toContainText('not an endorsement');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  });
  test(`reserve custody and reviewed issue context at ${width}px (mocked RPC facts)`,async({page})=>{
    await setup(page,width);await page.route('**/api/airdrops/reserves',route=>route.fulfill({json:{cluster:'devnet',checkedAt:new Date().toISOString(),reserves:[{mint,verified:true,status:'drop-active',reservedTokens:'100',fundedTokens:'100',totalBaseUnits:'100000000',claimedBaseUnits:'1',remainingBaseUnits:'99999999',authority:wallet,vault:wallet}]}}));
    await ready(page,`/token/${mint}`);await page.evaluate(mint=>window.dispatchEvent(new CustomEvent('funded:coin-facts',{detail:{mint,parsedMint:{mintAuthority:null,freezeAuthority:null},launch:{onchainVerified:true,creatorWallet:mint},checkedAt:Date.now()}})),mint);
    const facts=page.locator('.launch-facts');await facts.locator(':scope > summary').click();await expect(facts.locator('[data-reserve-facts]')).toContainText('99999999');await expect(facts).toContainText('These token balances are not SOL rewards');
    await facts.getByRole('link',{name:'Report this coin'}).click();const report=page.locator('#issue-reports');await report.getByLabel('Describe what happened').fill('Please investigate the reserve display');await report.getByLabel('Include the current app route').check();await report.getByRole('button',{name:'Review report',exact:true}).click();await expect(report.locator('pre')).toContainText(mint);await expect(report.locator('pre')).toContainText(`/token/${mint}`);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  });
}
test('report submission is explicit and status checks use its private view token (mocked)',async({page})=>{
  await setup(page,390);let writes=0;const id='a'.repeat(32),token='b'.repeat(48);await page.route('**/api/creator-support/issues/config',route=>route.fulfill({json:{enabled:true,cluster:'devnet',tokenHoldingRequired:false}}));
  await page.route('**/api/creator-support/issues',route=>{writes++;expect(route.request().postDataJSON().context).toEqual({route:'/'});return route.fulfill({status:201,json:{id,token,status:'received',createdAt:new Date().toISOString()}});});
  await page.route(`**/api/creator-support/issues/${id}`,route=>{expect(route.request().headers()['x-issue-token']).toBe(token);return route.fulfill({json:{id,status:'investigating',note:'Reproduced',updatedAt:new Date().toISOString()}});});
  await ready(page,'/#profile');await page.locator('#issue-reports-details > summary').click();const report=page.locator('#issue-reports');await report.getByLabel('Describe what happened').fill('This control did not respond');await report.getByRole('button',{name:'Review report',exact:true}).click();expect(writes).toBe(0);await report.getByRole('button',{name:'Send reviewed report'}).click();await expect(report).toContainText('Report received');expect(writes).toBe(1);await report.getByRole('button',{name:'Check status'}).click();await expect(report).toContainText('investigating · Reproduced');
});
test('creator brief uses authenticated API and templates only fill drafts (mocked)',async({page})=>{
  await setup(page,1440);let briefs=0,updates=0;await page.route('**/api/creator-support/me',route=>route.fulfill({json:{csrf:'fixture-csrf',content:{briefs:true},announcements:{scheduling:true},user:{id:'123',username:'fixture'},profile:{listed:true,identityVerified:true,updates:[]},coins:[]}}));
  await page.route('**/api/creator-support/brief',route=>{briefs++;expect(route.request().headers()['x-creator-csrf']).toBe('fixture-csrf');return route.fulfill({json:{...route.request().postDataJSON(),version:1,publishedAt:new Date().toISOString()}});});await page.route('**/api/creator-support/updates',route=>{updates++;return route.fulfill({status:503,json:{error:'No auto publish'}});});
  await ready(page,'/#creator-settings');const root=page.locator('#creator-brief-settings');await root.locator('[name=purpose]').fill('A concrete project purpose');await root.locator('[name=rewards]').fill('Saved policy');await root.getByRole('button',{name:'Review and publish brief'}).click();await expect(root).toContainText('Brief version 1 published');expect(briefs).toBe(1);
  await root.getByText('Creator communication routine', {exact:true}).click();await root.getByRole('button',{name:'Draft progress update'}).click();await expect(page.locator('#creator-update-text')).toHaveValue(/Progress update:/);expect(updates).toBe(0);
});
test('universal search adds creator accounts without claiming wallet ownership (mocked)',async({page})=>{
  await setup(page,390);await page.route('**/api/creators?**',route=>route.fulfill({json:{cluster:'devnet',creators:[{id:'123',name:'Example creator',handle:'@example',identityVerified:true}]}}));await ready(page,'/#explore');await page.locator('#header-search-trigger').click();await page.locator('#header-search-input').fill('@example');
  const result=page.locator('#header-search-results [role=option]').filter({hasText:'Example creator'});await expect(result).toBeVisible();await expect(result).toContainText('Account ownership verified');await expect(result).toContainText('Policy support is not endorsement');await expect(result).toHaveAttribute('href','/creator/x/123');
});
test('trade sharing uses an exact receipt and explains image-only privacy (mocked result)',async({page})=>{
  await setup(page,390);await ready(page,'/#explore');await page.evaluate(async({mint,wallet,sig})=>{const {openShareComposer}=await import('/share-tools.js');openShareComposer({kind:'trade',title:'Fixture trade',text:'Synthetic reviewed result',url:location.origin+'/token/'+mint,result:{kind:'trade',verified:true,side:'buy',mint,receipt:sig,wallet,network:'devnet'}});},{mint,wallet,sig});
  const dialog=page.locator('#share-dialog');await expect(dialog).toBeVisible();await expect(dialog.locator('#share-link')).toHaveValue(new RegExp(`receipt=${sig}`));await expect(dialog.getByLabel('Hide wallet on image')).toBeChecked();await expect(dialog.locator('#share-result-note')).toContainText('do not hide public receipt links');await dialog.locator('#share-close').click();
});
test('recovery inbox labels its in-tab fallback when device storage is full (mocked wallet)',async({page})=>{
  await page.addInitScript(()=>performance.setResourceTimingBufferSize(3000));await setup(page,390);await ready(page,'/#my-launches');await page.evaluate(async({mint,wallet,sig})=>{
    // Reuse the actual app's module URLs, including Vite's cache-version query.
    const loaded=name=>performance.getEntriesByType('resource').find(row=>new URL(row.name).pathname.endsWith('/'+name))?.name;
    const {recordTradeRecovery}=await import(loaded('trade-recovery-store.js'));
    const {initializeRecoveryInbox}=await import(loaded('recovery-inbox.js'));
    recordTradeRecovery({mint,walletAddress:wallet,signature:sig,side:'buy'},{getItem:()=> '[]',setItem(){throw new Error('Fixture quota');}});
    document.querySelector('#recovery-inbox').remove();initializeRecoveryInbox({connectedWalletAddress:wallet,pendingTradeVerifications:new Map(),verifyPendingTrade:async()=>{}});
  },{mint,wallet,sig});
  const inbox=page.locator('#recovery-inbox');await expect(inbox).toContainText('1 unresolved');await expect(inbox).toContainText('This record remains in this tab only');await expect(inbox.getByRole('link',{name:'Inspect transaction'})).toHaveAttribute('href',new RegExp(sig));
  await page.getByRole('button',{name:'Review 1 saved transaction',exact:true}).click();await expect(inbox).toBeFocused();await expect(inbox).toBeInViewport();
});
test('on-chain-policy burns keep a working Explorer proof link (mocked recorded receipt)',async({page})=>{
  await setup(page,390);await page.route('**/api/buyback/status',route=>route.fulfill({json:{cluster:'devnet',pending:[],receipts:[{mint,signature:sig,sourceKind:'onchain-policy',status:'finalized',vaultDebitVerified:true,burnInstructionVerified:true,burnedBaseUnits:'123'}]}}));
  await ready(page,'/#payments/activity');const proof=page.locator('[data-flow-rows]').getByRole('link',{name:'Inspect on-chain policy burn'});await expect(proof).toHaveAttribute('href',`https://explorer.solana.com/tx/${sig}?cluster=devnet`);await expect(proof).toHaveAttribute('target','_blank');
});
