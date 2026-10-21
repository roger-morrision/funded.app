import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z',signature='3'.repeat(64);
const targets=[['trades','Trades'],['payments','Fee collections'],['claims','Allocations'],['holders','Holders']];
for(const width of [360,390,1440])for(const motion of ['no-preference','reduce'])test(`record shortcuts at ${width}px with ${motion} motion reuse native views`,async({page},testInfo)=>{
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
  await page.route('https://**/*',route=>route.abort());
  const ready=async()=>{await page.goto(`/token/${mint}`);await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.evaluate(()=>document.fonts.ready)};
  const canonical=key=>page.locator(`.coin-tabs [data-coin-tab="${key}"]`),shortcut=key=>page.locator(`[data-coin-record-target="${key}"]`);
  const clear=async tab=>{
    await expect(tab).toBeFocused();
    let geometry;
    try {await expect.poll(async()=>{geometry=await tab.evaluate(element=>{
      const box=element.getBoundingClientRect(),style=getComputedStyle(element),strip=element.closest('.coin-tabs'),rail=strip.getBoundingClientRect();
      const margin=(parseFloat(style.outlineWidth)||0)+Math.max(0,parseFloat(style.outlineOffset)||0),header=document.querySelector('.topbar'),nav=document.querySelector('.mobile-workspace-nav');
      const top=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0,bottom=nav?.getClientRects().length?Math.min(innerHeight,nav.getBoundingClientRect().top):innerHeight;
      return {key:element.dataset.coinTab,box:{top:box.top,bottom:box.bottom,left:box.left,right:box.right},margin,top,bottom,rail:{left:rail.left,right:rail.right,top:rail.top,bottom:rail.bottom},y:scrollY,x:strip.scrollLeft,clear:box.top-margin>=top-1&&box.bottom+margin<=bottom+1&&box.left-margin>=rail.left-1&&box.right+margin<=rail.right+1&&box.top-margin>=rail.top-1&&box.bottom+margin<=rail.bottom+1};
    });return geometry.clear;},{timeout:1000}).toBe(true);}catch(error){await testInfo.attach('focus-geometry',{body:JSON.stringify(geometry),contentType:'application/json'});if(process.env.FUNDED_RECORD_FOCUS_DIAGNOSTIC==='true')await testInfo.attach('scroll-operations',{body:JSON.stringify(await page.evaluate(()=>window.__recordFocusDiagnostic)),contentType:'application/json'});await page.screenshot({path:testInfo.outputPath('focus-clipped.png'),fullPage:true});throw new Error(JSON.stringify(geometry),{cause:error});}
  };
  const activate=async(key,keyboard=true)=>{if(keyboard){await shortcut(key).focus();await page.keyboard.press(key==='claims'?'Space':'Enter')}else await shortcut(key).click();await expect(canonical(key)).toHaveAttribute('aria-selected','true');await expect(page.locator('.coin-tabs [aria-selected="true"]')).toHaveCount(1);await clear(canonical(key));};
  try {
  await ready();
  await expect(page.getByRole('group',{name:'Token records shortcuts'}).getByRole('button')).toHaveCount(4);
  const layout=await page.locator('.coin-record-shortcuts').evaluate(element=>{
    const bounds=element.getBoundingClientRect(),socials=document.querySelector('.coin-socials').getBoundingClientRect();
    return {right:bounds.right,bottom:bounds.bottom,socialTop:socials.top,targets:[...element.querySelectorAll('button')].map(button=>({width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height})),viewport:innerWidth};
  });
  expect(layout.bottom).toBeLessThanOrEqual(layout.socialTop+1);expect(layout.right).toBeLessThanOrEqual(width);for(const target of layout.targets){expect(target.width).toBeGreaterThanOrEqual(44);expect(target.height).toBeGreaterThanOrEqual(44);}
  await page.locator('#coin-copy-address').focus();await page.keyboard.press('Tab');await expect(shortcut('trades')).toBeFocused();await page.keyboard.press('Enter');await clear(canonical('trades'));
  for(const [key] of targets)await activate(key);
  await expect(page.locator('#coin-activity-list')).toContainText('Reading token records');
  await activate('payments');state='populated';releaseLedger();releaseRpc();
  await expect(page.locator('#coin-activity-list')).toContainText('0.000025887 SOL');await clear(canonical('payments'));await page.screenshot({path:testInfo.outputPath(`focused-collections-${width}-${motion}-mocked.png`)});
  for(const [key] of targets){await activate(key);const text=await page.locator('#coin-activity-list').innerText();await canonical(key).click();await expect(page.locator('#coin-activity-list')).toHaveText(text,{useInnerText:true});}
  await activate('payments');const before=await page.evaluate(()=>({y:scrollY,x:document.querySelector('.coin-tabs').scrollLeft}));
  await shortcut('payments').evaluate(button=>button.click());await clear(canonical('payments'));expect(await page.evaluate(()=>({y:scrollY,x:document.querySelector('.coin-tabs').scrollLeft}))).toEqual(before);
  await shortcut('payments').evaluate(button=>{button.click();document.querySelector('#coin-copy-address').focus({preventScroll:true});});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(page.locator('#coin-copy-address')).toBeFocused();expect(await page.evaluate(()=>({y:scrollY,x:document.querySelector('.coin-tabs').scrollLeft}))).toEqual(before);await canonical('payments').focus();
  await page.keyboard.press('End');await expect(canonical('holders')).toBeFocused();await expect(canonical('holders')).toHaveAttribute('aria-selected','true');await page.keyboard.press('Home');await expect(canonical('trades')).toBeFocused();await page.keyboard.press('ArrowRight');await expect(canonical('payments')).toBeFocused();
  await expect(page.locator('.coin-tabs [data-coin-tab="payments"]')).toContainText('Fee collections');await expect(page.locator('.coin-tabs')).not.toContainText('Fee claims');
  await page.getByRole('tab',{name:'Updates',exact:true}).click();await expect(page.locator('#coin-profile')).toContainText('No updates yet');await page.getByRole('tab',{name:'About',exact:true}).click();
  await page.locator('.coin-holders-aside-link').click();await clear(canonical('holders'));
  if(width<700){await page.locator('.mobile-trade-open').click();await expect(page.locator('.token-trading-panel')).toHaveAttribute('role','dialog');await page.keyboard.press('Escape');await expect(page.locator('#coin-page')).not.toHaveClass(/trade-sheet-open/);}
  expect(feeReads).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('.coin-record-shortcuts').scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`shortcuts-${width}-${motion}-mocked.png`),fullPage:true});
  for(const nextState of ['empty','unavailable']){state=nextState;await ready();await expect(page.locator('#coin-description')).toContainText('We could not load');await activate('payments',false);await expect(page.locator('#coin-activity-list')).toContainText(nextState==='empty'?'No fee collections recorded':'Token data unavailable');await activate('claims');await expect(page.locator('#coin-activity-list')).toContainText(nextState==='empty'?'No reward shares recorded':'Token data unavailable');}
  await activate('payments');const missingBefore=await page.evaluate(()=>({active:document.activeElement.dataset.coinTab,y:scrollY}));await canonical('holders').evaluate(element=>element.remove());await shortcut('holders').evaluate(button=>button.click());expect(await page.evaluate(()=>({active:document.activeElement.dataset.coinTab,y:scrollY}))).toEqual(missingBefore);
  await page.getByRole('link',{name:/Back to explore/i}).click();await expect(page).toHaveURL(/#explore$/);
  } finally {releaseLedger();releaseRpc();}
});
