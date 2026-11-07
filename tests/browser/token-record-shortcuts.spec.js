import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z',signature='3'.repeat(64);
const targets=[['trades','Trades'],['payments','Fee collections'],['claims','Allocations'],['holders','Holders']];
for(const width of [360, 1440])for(const motion of ['no-preference','reduce'])test(`record shortcuts at ${width}px with ${motion} motion reuse native views`,async({page,baseURL},testInfo)=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:width<700?844:900});await page.emulateMedia({reducedMotion:motion});
  if(process.env.FUNDED_RECORD_FOCUS_DIAGNOSTIC==='true')await page.addInitScript(()=>{
    const events=[];window.__recordFocusDiagnostic=events;
    const record=(type,element,args)=>{if(events.length>160)events.shift();events.push({type,time:performance.now(),target:element?.dataset?.coinTab||element?.dataset?.coinRecordTarget||element?.id||element?.className||'window',args,y:scrollY,top:element?.getBoundingClientRect?.().top,scrollTop:element?.scrollTop});};
    for(const name of ['scrollIntoView','focus','scrollBy']){const prototype=name==='focus'?HTMLElement.prototype:Element.prototype,original=prototype[name];if(!original)continue;prototype[name]=function(...args){record(name+':before',this,args);const value=original.apply(this,args);record(name+':after',this,args);return value;};}
    for(const name of ['scrollBy','scrollTo']){const original=window[name];window[name]=function(...args){record('window.'+name+':before',null,args);const value=original.apply(this,args);record('window.'+name+':after',null,args);return value;};}
  });
  let state='loading',releaseRpc,releaseLedger,feeReads=0;
  const rpcGate=new Promise(resolve=>releaseRpc=resolve),ledgerGate=new Promise(resolve=>releaseLedger=resolve);
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline record navigation fixture'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route(`**/api/tokens/${mint}/fee-activity`,async route=>{
    feeReads++;if(state==='loading')await ledgerGate;
    if(state==='unavailable')return route.fulfill({status:503,json:{error:'Fee records unavailable fixture'}});
    return route.fulfill({json:{mint,cluster:'devnet',overview:{available:true,scope:'per-mint-v3'},collections:state==='empty'?[]:[{signature,collectedLamports:'25887'}],claims:state==='empty'?[]:[{claimSignature:signature,grossLamports:'25887',grossCreatorFees:'0.000025887',grossCreatorFeesUnit:'SOL',asset:'SOL',status:'finalized'}]}});
  });
  await page.route('**/api/solana/rpc',async route=>{if(state==='loading')await rpcGate;return route.fulfill({status:503,json:{error:'Synthetic unavailable token read'}})});
  await page.route('https://**/*',route=>{const request=route.request(),url=new URL(request.url());return url.origin===new URL(baseURL).origin&&(request.method()==='GET'||url.pathname.startsWith('/api/'))?route.fallback():route.abort();});
  const ready=async()=>{await page.goto(`/token/${mint}`);await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.evaluate(()=>document.fonts.ready)};
  const canonical=key=>page.locator(`.coin-tabs [data-coin-tab="${key}"]`);
  const clear=async tab=>{
    await expect(tab).toBeFocused();
    let geometry;
    try {await expect.poll(async()=>{geometry=await tab.evaluate(element=>{
      const box=element.getBoundingClientRect(),style=getComputedStyle(element),strip=element.closest('.coin-tabs'),bounds=strip.getBoundingClientRect();
      const rail={left:bounds.left+strip.clientLeft,right:bounds.left+strip.clientLeft+strip.clientWidth,top:bounds.top+strip.clientTop,bottom:bounds.top+strip.clientTop+strip.clientHeight};
      const margin=(parseFloat(style.outlineWidth)||0)+Math.max(0,parseFloat(style.outlineOffset)||0),header=document.querySelector('.topbar'),nav=document.querySelector('.mobile-workspace-nav');
      const top=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0,bottom=nav?.getClientRects().length?Math.min(innerHeight,nav.getBoundingClientRect().top):innerHeight;
      return {key:element.dataset.coinTab,box:{top:box.top,bottom:box.bottom,left:box.left,right:box.right},margin,top,bottom,rail:{left:rail.left,right:rail.right,top:rail.top,bottom:rail.bottom},y:scrollY,x:strip.scrollLeft,clear:box.top-margin>=top-1&&box.bottom+margin<=bottom+1&&box.left-margin>=rail.left-1&&box.right+margin<=rail.right+1&&box.top-margin>=rail.top-1&&box.bottom+margin<=rail.bottom+1};
    });return geometry.clear;},{timeout:1000}).toBe(true);}catch(error){await testInfo.attach('focus-geometry',{body:JSON.stringify(geometry),contentType:'application/json'});if(process.env.FUNDED_RECORD_FOCUS_DIAGNOSTIC==='true')await testInfo.attach('scroll-operations',{body:JSON.stringify(await page.evaluate(()=>window.__recordFocusDiagnostic)),contentType:'application/json'});await page.screenshot({path:testInfo.outputPath('focus-clipped.png'),fullPage:true});throw new Error(JSON.stringify(geometry),{cause:error});}
  };
  const nativeMove=async(key,target)=>{await page.keyboard.press(key);await expect(canonical(target)).toHaveAttribute('aria-selected','true');await expect(page.locator('.coin-tabs [aria-selected="true"]')).toHaveCount(1);await clear(canonical(target));};
  const nativeSequence=async()=>{
    for(const [key,target] of [['Home','chat'],['ArrowLeft','holders'],['ArrowRight','chat'],['End','holders'],['ArrowLeft','claims'],['ArrowLeft','payments'],['ArrowLeft','trades'],['ArrowLeft','rewards'],['ArrowLeft','chat'],['ArrowRight','rewards'],['ArrowRight','trades'],['ArrowRight','payments']])await nativeMove(key,target);
    // Check after native focus scrolling has settled, as well as immediately.
    await page.waitForTimeout(1000);await clear(canonical('payments'));
  };
  const activate=async(key,keyboard=true)=>{if(keyboard){await canonical(key).focus();await page.keyboard.press(key==='claims'?'Space':'Enter')}else await canonical(key).click();await expect(canonical(key)).toHaveAttribute('aria-selected','true');await expect(page.locator('.coin-tabs [aria-selected="true"]')).toHaveCount(1);await clear(canonical(key));};
  try {
  await ready();
  expect(await page.locator('.coin-tabs [data-coin-tab]').evaluateAll(tabs=>tabs.map(tab=>tab.dataset.coinTab))).toEqual(['chat','rewards','trades','payments','claims','holders']);
  await expect(page.locator('#coin-page > .coin-community-panel')).toHaveCount(0);
  // The header record shortcuts are hidden by design; the record tabs are the only entry.
  await expect(page.locator('.coin-record-shortcuts')).toBeHidden();
  await canonical('trades').click();await clear(canonical('trades'));
  for(const [key] of targets)await activate(key);
  await expect(page.locator('#coin-activity-list')).toContainText('Reading token records');
  await activate('holders');await nativeSequence();state='populated';releaseLedger();releaseRpc();
  await expect(page.locator('#coin-activity-list')).toContainText('0.000025887 SOL');await clear(canonical('payments'));await page.screenshot({path:testInfo.outputPath(`focused-collections-${width}-${motion}-mocked.png`)});
  for(const [key] of targets){await activate(key);const text=await page.locator('#coin-activity-list').innerText();await canonical(key).click();await expect(page.locator('#coin-activity-list')).toHaveText(text,{useInnerText:true});}
  await activate('payments');const before=await page.evaluate(()=>({y:scrollY,x:document.querySelector('.coin-tabs').scrollLeft}));
  await canonical('payments').evaluate(button=>button.click());await clear(canonical('payments'));expect(await page.evaluate(()=>({y:scrollY,x:document.querySelector('.coin-tabs').scrollLeft}))).toEqual(before);
  await canonical('payments').evaluate(button=>{button.click();document.querySelector('#coin-copy-address').focus({preventScroll:true});});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(page.locator('#coin-copy-address')).toBeFocused();expect(await page.evaluate(()=>({y:scrollY,x:document.querySelector('.coin-tabs').scrollLeft}))).toEqual(before);await canonical('payments').focus();
  await nativeSequence();
  await expect(page.locator('.coin-tabs [data-coin-tab="payments"]')).toContainText('Fee collections');await expect(page.locator('.coin-tabs')).not.toContainText('Fee claims');
  await page.getByRole('tab',{name:'Updates',exact:true}).click();await expect(page.locator('#coin-profile')).toContainText('No updates yet');await page.getByRole('tab',{name:'About',exact:true}).click();
  await expect(page.locator('.coin-holders-aside')).toBeHidden();
  if(width<700){await page.locator('.mobile-trade-open').click();await expect(page.locator('.token-trading-panel')).toHaveAttribute('role','dialog');await page.keyboard.press('Escape');await expect(page.locator('#coin-page')).not.toHaveClass(/trade-sheet-open/);}
  expect(feeReads).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('.coin-tabs').scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`records-${width}-${motion}-mocked.png`),fullPage:true});
  for(const nextState of ['empty','unavailable']){state=nextState;await ready();await expect(page.locator('#coin-description')).toContainText('We could not load');await activate('payments',false);await expect(page.locator('#coin-activity-list')).toContainText(nextState==='empty'?'No fee collections recorded':'Token data unavailable');await activate('claims');await expect(page.locator('#coin-activity-list')).toContainText(nextState==='empty'?'No reward shares recorded':'Token data unavailable');await nativeSequence();}
  await page.getByRole('link',{name:/Back to explore/i}).click();await expect(page).toHaveURL(/#explore$/);
  } finally {releaseLedger();releaseRpc();}
});

for(const width of [360,1440])test(`Chat precedes Trades and retains messages and device moderation at ${width}px (mocked API)`,async({page,baseURL})=>{
  await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('**/*',route=>{const request=route.request(),url=new URL(request.url());return url.origin===new URL(baseURL).origin&&(request.method()==='GET'||url.pathname.startsWith('/api/'))?route.fallback():route.abort();});
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline Chat layout fixture'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route(`**/api/tokens/${mint}/chat`,route=>route.fulfill({json:{enabled:true,messages:[{id:'fixture-message',author:mint,text:'Token community fixture message',createdAt:'2026-10-31T00:00:00.000Z'}]}}));
  await page.goto(`/token/${mint}`);await page.locator('body.workspace-ready.product-experience-ready').waitFor();
  const chat=page.getByRole('tab',{name:'Chat',exact:true}),trades=page.getByRole('tab',{name:/^Trades/}),activity=page.locator('#coin-activity-list');
  await trades.click();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await expect(chat).toBeFocused();await expect(chat).toHaveAttribute('aria-selected','true');
  await expect(activity).toContainText('Token community fixture message');await expect(activity.locator('#coin-chat-form')).toHaveCount(1);await expect(activity).toContainText('Connect a Solana wallet to post');
  await activity.getByRole('button',{name:'Hide this wallet',exact:true}).click();await expect(activity).not.toContainText('Token community fixture message');await expect(activity.getByRole('status')).toContainText('Messages from hidden wallets');
  const restore=activity.getByRole('button',{name:'Show 1 hidden wallet',exact:true});await expect(restore).toBeFocused();
  if(width<700)for(const control of[restore,activity.locator('#coin-chat-input')]){expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);}
  await page.keyboard.press('Enter');await expect(activity).toContainText('Token community fixture message');await expect(activity.getByRole('button',{name:'Hide this wallet',exact:true})).toBeFocused();
  await page.keyboard.press('Enter');await expect(restore).toBeFocused();await expect(activity.getByRole('status')).toContainText('Messages from hidden wallets');
  await chat.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await expect(trades).toBeFocused();await expect(trades).toHaveAttribute('aria-selected','true');await expect(activity.locator('.coin-chat')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await expect(chat).toBeFocused();await expect(activity.getByRole('status')).toContainText('Messages from hidden wallets');
  await page.locator('#coin-refresh').click();await expect(page.locator('.coin-tabs [data-coin-tab]')).toHaveCount(6);await chat.click();await expect(activity.getByRole('status')).toContainText('Messages from hidden wallets');
  await expect(page.locator('#coin-page > .coin-community-panel')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
