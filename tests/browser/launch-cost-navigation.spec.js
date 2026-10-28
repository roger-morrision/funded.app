import{test,expect}from'@playwright/test';
import{build}from'vite';import{fileURLToPath}from'node:url';
import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const built=await build({root,configFile:false,logLevel:'silent',build:{write:false,lib:{entry:root+'src/features/launch/cost-view.js',name:'CostNavigationRenderer',formats:['iife']}}});
const renderer=built[0].output.find(x=>x.type==='chunk').code;
// Public Devnet program-global snapshot; mocked reads only, no user wallet/keys.
const globalReadFixture={"address":"4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf","result":{"context":{"slot":513610080,"apiVersion":"4.3.0-alpha.2"},"value":{"lamports":1008382523,"data":["p+joschscn8B5e1C2s3IuEBRxPbMVBH1VhMy+axbQ7u4RBg5bUR0fMpMVRnph2QSuFLK9yKkKB3Na4RqChJ10TqilpIk6FtlsQAQ2EfjzwMAAKPhEQAAAAAAeMX7UdECAACAxqR+jQMAXwAAAAAAAABBNIlYEuHllDSNAD9QVZJnXQSxsk0cZs+3K5YDwZQGQQHB4eQAAAAAAAUAAAAAAAAAUFtWK/D+Rdl7bbILpRjgoMXMME3ZaawXjmt0kYJPs6RbH6NEwFLNubkb6B/Jj3LKJgCQMnu9kX71y3fcGRVcgW4+pUNgtBQCzldEqFyleZuPqkOJPU2j8aY/aVz6Ne8XesODaPA0MP6uVpoVT3fYwPGGCKti3U1EpruifSuLwyyDHciA82NjJTsozkFqYjAYs61LOuRrtGDgGiyBl2/XXbV2De8ejPKOuQLBNf4WWHiUxG4MLzM/UWJkto70noUsuH/2ft020cccww2OxpBtIuyv+79lGDw4xC135DbrpwNBNIlYEuHllDSNAD9QVZJnXQSxsk0cZs+3K5YDwZQGQQ1fCZrJtqU9kWPpkji3qUf0JaQNLkM2bh8LQj1G7OGhAaKLX9JqtHmmqcxsv2sLI+thiFo3HgEgrKkTvu89E4p46JMUH7GOnxV02BDheOGeMGBOMXWqLkoy38hgByfRBwkBNYRTYlYJT5EoGRJ++k5Ea0MzcheT0Th2+arb89x9C19udQGCIPlCZ3ADI3tNa0U3WbSlxpC1nDXZuxh6CQy9KjOYep67E2eZq1mSWxPl3Iswgd8AXbQnwUePpG/4w0egdOlUPz43otBGInrdy06cd0xEJYxD7fJKqKrh8AIUZlvaTDjNbbdDj1m0CLuew7TKnorR8fJGU8SZtXlsINv5sy3dnuo/ObNyEVxxhHwYRc+lNsaFB04DDkTQId4++eNcTLeA8I7i/uhL7ERqV3gl2mjUOfqKXaOwxc/1D2P0VGsBQ55lEMA9ZfrZMeidBL4Ltw1Rlx9RxBX7NEwH20GfISICI1UWqRcTTGdYjEk4IK4VXulmZVd6wbcY2kfdzyoFDuan4iBou4hkCqV/kJMIxh/vcRoBY/WnVcBwvIYNH2NnIHzs2lvMbLHq8PFtaEBFZrGNVtJIGssxcDJlbpBVHHhElkH4SVjcc6dqhdh1b1XALNrKiboZMnkMNoqxV+ktc8VLlrXJMZQeRupL4uDjESd0T8a3TPtFXv6vi9VxeSztRPwfePlKM9CQnF5rX7AhVwrY262N6P2z0g7RzZnrjk6HcBV+6+tnimVduZs39rEybHZX25DPuKh6vvjHtvLIaegDAAAAAAAAoH1BAAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI=","base64"],"owner":"6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P","executable":false,"rentEpoch":18446744073709552000,"space":1088}}};
const healthy={status:'ready',solAmountLamports:'8715246',maxSolAmountLamports:'8802399',developerTokens:0};

function stableFocus(target,{keyboard=true}={}){return new Promise(resolve=>{const start=performance.now(),samples=[];let stable=null,last=null,frame,done=false;const finish=pass=>{if(done)return;done=true;cancelAnimationFrame(frame);clearTimeout(timer);resolve({pass,elapsedMs:performance.now()-start,stableMs:stable===null?0:performance.now()-stable,samples});};const tick=()=>{const r=target.getBoundingClientRect(),s=getComputedStyle(target),margin=(parseFloat(s.outlineWidth)||0)+Math.max(0,parseFloat(s.outlineOffset)||0),header=document.querySelector('.topbar'),nav=document.querySelector('.mobile-workspace-nav'),top=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0,bottom=nav?.getClientRects().length?Math.min(innerHeight,nav.getBoundingClientRect().top):innerHeight;const x={at:performance.now()-start,y:scrollY,focused:document.activeElement===target,visible:(!keyboard||target.matches(':focus-visible'))&&r.top-margin>=top&&r.bottom+margin<=bottom&&r.left-margin>=0&&r.right+margin<=innerWidth,rect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},margin,top,bottom};samples.push(x);if(x.at>1000)return finish(false);if(x.focused&&x.visible&&margin>0&&s.outlineStyle!=='none'){if(stable===null||last!==scrollY)stable=performance.now();last=scrollY;if(performance.now()-stable>=100)return finish(true);}else stable=null;frame=requestAnimationFrame(tick);};const timer=setTimeout(()=>finish(false),1000);frame=requestAnimationFrame(tick);});}

async function setup(page,{width,height,motion}){
 let healthyReadEnabled=false;const reads=[],writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height});await page.emulateMedia({reducedMotion:motion});
 await page.route('https://**/*',r=>{const q=r.request(),u=new URL(q.url());return q.method()==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname)?r.continue():r.abort()});
 await page.route('**/api/**',r=>{const q=r.request(),path=new URL(q.url()).pathname;reads.push({path,method:q.method()});if(!['GET','HEAD','OPTIONS'].includes(q.method())&&!(path==='/api/solana/rpc'&&['getAccountInfo','getMultipleAccounts','getSlot'].includes(q.postDataJSON()?.method)))writes.push({path,method:q.method()});
   // An unavailable schedule body avoids the unrelated startup reader's
   // documented 1500ms transport retry; no reward activity is fabricated.
   if(path==='/api/solana/rpc'&&healthyReadEnabled){const body=q.postDataJSON();if(body?.method==='getAccountInfo'&&body.params?.[0]===globalReadFixture.address)return r.fulfill({json:{jsonrpc:'2.0',id:body.id,result:globalReadFixture.result}});}
   if(path==='/api/rewards/automatic')return r.fulfill({json:{status:'unavailable',reason:'Offline navigation fixture',serverTime:new Date().toISOString(),schedules:[]}});
   return path==='/api/fee-policy'?r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}):r.fulfill({status:503,json:{error:'Offline launch navigation fixture'}})});
 await page.goto('/#launch');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await expect(page.locator('#cost-total-enabled')).toHaveText('Quote unavailable',{timeout:18000});
 await page.locator('#token-name').fill('Cost planning QA');await page.locator('#token-symbol').fill('CQA');
 await page.locator('details').filter({has:page.locator('#token-description')}).locator('summary').click();await page.locator('#token-description').fill('A local planning draft; no launch or wallet action.');
 await page.locator('#launch-project-links summary').click();await page.locator('#token-website').fill('https://example.invalid/project');
 await page.locator('#launch-next').click();await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','2');await expect(page.locator('#launch-public-quote-retry')).toBeVisible({timeout:18000});await page.locator('#launch-back').click();await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','1');
 await page.addScriptTag({content:renderer});await page.evaluate(()=>{
   window.renderCostNavigationFixture=({quote,fee='20000000',connected=false,review=null,matchRetry=false})=>{
     const api=window.CostNavigationRenderer,format=x=>`${(Number(x)/1e9).toFixed(6)} SOL`,state={wallet:connected?{}:null,publicQuote:quote,estimatedLaunchFeeLamports:connected?review?.budget:null,launchCostReview:review};
     api.updateCostSummary(state,{document,formatLaunchCost:format,getLaunchFeeLamports:()=>fee,renderLaunchCostDetails:()=>api.renderLaunchCostDetails(state,{document,formatLaunchCost:format,getLaunchFeeLamports:()=>fee}),getLaunchBurnPolicy:()=>({requiresBurn:false,label:'Standard',amountTokens:0}),getCreatorBuySummary:()=>({sol:0,tokens:0}),getCommunityAirdropTokens:()=>30000000,getCommunityAllocationPercent:()=>3,formatLaunchBurnAmount:String,creatorBuyExceedsWalletBalance:()=>false,developerBuyLimitReached:()=>false});
     if(matchRetry)api.renderPublicQuoteRetry({...state,active:true},{document});
     return{markup:document.querySelector('#launch-cost-details').innerHTML,total:document.querySelector('#cost-total-enabled').textContent};
   };
 });
 const font=await page.evaluate(async()=>{await document.fonts.ready;const faces=await document.fonts.load('700 14px "Manrope"','View cost breakdown Back to launch form');await document.fonts.ready;return{faces:faces.map(x=>({family:x.family,weight:x.weight,status:x.status})),styles:[...document.querySelectorAll('[data-launch-cost-step],#launch-cost-return')].map(e=>({family:getComputedStyle(e).fontFamily,weight:getComputedStyle(e).fontWeight}))};});
 expect(font.faces.length).toBeGreaterThan(0);expect(font.faces.some(f=>f.family==='Manrope'&&f.status==='loaded'&&(f.weight==='700'||f.weight==='400 800'))).toBe(true);expect(font.styles.every(x=>x.family.includes('Manrope')&&x.weight==='700')).toBe(true);
 return{reads,writes,errors,font,enableHealthyQuote:()=>{healthyReadEnabled=true}};
}
const snapshot=page=>page.evaluate(()=>({hash:location.hash,history:history.length,step:document.querySelector('#launch-dialog').dataset.step,fields:[...document.querySelectorAll('#launch-form input,#launch-form textarea,#launch-form select')].map(e=>({id:e.id,value:e.type==='file'?e.files.length:e.value,checked:e.checked,invalid:e.getAttribute('aria-invalid')})),hint:document.querySelector('#wizard-hint').textContent,launchDisabled:document.querySelector('#launch-button').disabled,launchStatus:document.querySelector('#launch-status').textContent,pendingReviewOpen:document.querySelector('#launch-review-dialog')?.open}));

test.describe('actual touch and keyboard',()=>{
test.use({hasTouch:true});
for(const viewport of[{width:360,height:740},{width:360,height:844},{width:390,height:844}])for(const motion of['no-preference','reduce'])test(`Mobile cost jump and return preserve draft at ${viewport.width}x${viewport.height}, ${motion}`,async({page},info)=>{
 test.setTimeout(60_000);let f=await setup(page,{...viewport,motion}),target=page.locator('#launch-cost-details'),back=page.locator('#launch-cost-return');const focus=[];
 const check=async (el,keyboard=true)=>{const x=await el.evaluate(stableFocus,{keyboard});focus.push(x);await info.attach('focus-'+focus.length,{body:JSON.stringify(x),contentType:'application/json'});expect(x.pass,JSON.stringify(x)).toBe(true);expect(x.elapsedMs).toBeLessThanOrEqual(1000);expect(x.stableMs).toBeGreaterThanOrEqual(100);};
 // Start with the most constrained healthy geometry. The approved baseline at
 // 360px observed loading only; it is not evidence that healthy geometry fits.
 await page.evaluate(quote=>window.renderCostNavigationFixture({quote}),healthy);
 const invoke=page.locator('[data-launch-cost-step="1"]');await expect(page.locator('[data-launch-cost-step]:visible')).toHaveCount(1);await page.locator('[data-launch-step-target="2"]').focus();await page.keyboard.press('Tab');await expect(invoke).toBeFocused();await check(invoke);const before=await snapshot(page),requests=f.reads.length;
 await page.keyboard.press('Enter');await check(target);await expect(back).toBeVisible();expect(await target.getAttribute('tabindex')).toBe('-1');expect(await target.getAttribute('aria-label')).toBe('Review launch costs');
 const geometry=await back.evaluate(e=>{const r=e.getBoundingClientRect(),t=document.querySelector('#launch-cost-details').getBoundingClientRect(),s=getComputedStyle(e);return{width:r.width,height:r.height,font:parseFloat(s.fontSize),gap:t.top-r.bottom,liveAncestor:e.closest('[aria-live]')?.id||null,top:r.top,bottom:r.bottom,target:{top:t.top,bottom:t.bottom,height:t.height}}});await info.attach('healthy-geometry',{body:JSON.stringify({viewport,motion,font:f.font,geometry}),contentType:'application/json'});expect(geometry.liveAncestor).toBeNull();expect(geometry.height).toBeGreaterThanOrEqual(44);expect(geometry.width).toBeGreaterThanOrEqual(44);expect(geometry.font).toBeGreaterThanOrEqual(14);expect(geometry.gap).toBeGreaterThanOrEqual(8);await page.screenshot({path:info.outputPath('healthy-native-jump.png')});
 await page.keyboard.press('Shift+Tab');await expect(back).toBeFocused();await check(back);await page.keyboard.press('Space');await expect(invoke).toBeFocused();await check(invoke);expect(await snapshot(page)).toEqual(before);expect(f.reads.length).toBe(requests);expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 // Exact retained target-05 reversal: no wait, assertion or observation on
 // the intervening legacy control. The new Back focus handler must cancel
 // superseded native scrolling without moving focus or intercepting Tab.
 const rapidReverse=async (jump,expectedNext)=>{
  const saved=await snapshot(page),count=f.reads.length;
  await jump.tap();await expect(target).toBeFocused();await check(target,false);
  await page.keyboard.press('Shift+Tab');await check(back);
  await page.evaluate(()=>{window.__costRapidFocus=[];window.__costRapidListener=e=>window.__costRapidFocus.push(e.target.id);document.addEventListener('focusin',window.__costRapidListener)});
  await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await check(back);
  const nativePair=await page.evaluate(()=>{document.removeEventListener('focusin',window.__costRapidListener);return window.__costRapidFocus});if(expectedNext)expect(nativePair).toEqual([expectedNext,'launch-cost-return']);await info.attach('rapid-native-order',{body:JSON.stringify({step:await page.locator('#launch-dialog').getAttribute('data-step'),expectedNext,nativePair}),contentType:'application/json'});
  await back.tap();await expect(jump).toBeFocused();await check(jump,false);
  expect(await snapshot(page)).toEqual(saved);expect(f.reads.length).toBe(count);
 };
 await rapidReverse(invoke,'launch-public-quote-retry-button');
 const states=[{quote:{status:'loading'},total:'Calculating…'},{quote:{status:'unavailable'},total:'Quote unavailable'},{quote:{status:'invalid'},total:'Enter valid amounts'},{quote:healthy,fee:null,total:'Fee policy unavailable'},{quote:{...healthy,solAmountLamports:'1340000000',maxSolAmountLamports:'1350000000'},total:'1.420000 SOL'}];
 for(const step of['1','2']){
  if(step==='2'){await page.locator('#launch-next').click();await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','2');await page.evaluate(quote=>window.renderCostNavigationFixture({quote}),healthy);await page.keyboard.press('Tab');}
  const jump=page.locator(`[data-launch-cost-step="${step}"]`);await expect(page.locator('[data-launch-cost-step]:visible')).toHaveCount(1);expect(await jump.evaluate(e=>e.closest('[aria-live]'))).toBeNull();
  for(const [index,state]of states.entries()){
   const expected=await page.evaluate(x=>window.renderCostNavigationFixture(x),state);await expect(page.locator('#cost-total-enabled')).toHaveText(state.total);const saved=await snapshot(page),count=f.reads.length;
   await jump.focus();await page.keyboard.press(index%2?'Space':'Enter');await check(target);expect(await target.innerHTML()).toBe(expected.markup);await expect(back).toBeVisible();
   // Positive normal-render callback refreshes children while the persistent
   // wrapper or its separate return control owns focus. No test-only endpoint.
   await page.evaluate(x=>window.renderCostNavigationFixture(x),state);await check(target);await page.keyboard.press('Shift+Tab');await expect(back).toBeFocused();await check(back);await page.evaluate(x=>window.renderCostNavigationFixture(x),state);await check(back);
   await page.keyboard.press(index%2?'Enter':'Space');await expect(jump).toBeFocused();await check(jump);expect(await snapshot(page)).toEqual(saved);expect(f.reads.length).toBe(count);
  }
 }
 // Touch activation and return use the same existing handlers. Follow with
 // a keyboard Tab/Shift+Tab pair to verify native order and full focus outline.
 const active=page.locator('[data-launch-cost-step="2"]'),saved=await snapshot(page),count=f.reads.length;
 await active.tap();await expect(target).toBeFocused();await check(target,false);await page.keyboard.press('Shift+Tab');await check(back);const next=page.locator(await page.locator('#launch-public-quote-retry-button').isVisible()?'#launch-public-quote-retry-button':'#fee-route-agree');await page.keyboard.press('Tab');await expect(next).toBeFocused();await info.attach('native-forward-target',{body:await next.evaluate(e=>JSON.stringify({id:e.id,tag:e.tagName,label:e.textContent})),contentType:'application/json'});await check(next);await page.keyboard.press('Shift+Tab');await check(back);await back.tap();await expect(active).toBeFocused();await check(active,false);expect(await snapshot(page)).toEqual(saved);expect(f.reads.length).toBe(count);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
 await rapidReverse(active,'launch-public-quote-retry-button');
 // Preserve the unavailable/Retry flow above. Now let the unchanged controller
 // become ready through one eligible native Retry and deterministic public
 // program-global RPC data, so its real quote clock also keeps Retry hidden.
 const unavailablePhase={reads:[...f.reads],errors:[...f.errors],writes:[...f.writes],font:f.font};expect(unavailablePhase.errors).toEqual([]);expect(unavailablePhase.writes).toEqual([]);
 // Independent fixture page: keep its unrelated automatic-rewards 30s refresh
 // out of a navigation assertion, rather than filtering any request counter.
 // Only the completed synthetic page's dummy local draft is reset here.
 const context=page.context();await page.evaluate(()=>localStorage.clear());await page.close();page=await context.newPage();f=await setup(page,{...viewport,motion});target=page.locator('#launch-cost-details');back=page.locator('#launch-cost-return');
 f.enableHealthyQuote();const quoteReadsBefore=f.reads.length;const retry=page.locator('#launch-public-quote-retry-button');await expect(retry).toHaveAttribute('aria-disabled','false',{timeout:18000});await retry.focus();await page.keyboard.press('Enter');await expect(page.locator('#launch-public-quote-retry')).toBeHidden({timeout:18000});
 const explicitRetryReads=f.reads.slice(quoteReadsBefore);expect(explicitRetryReads.some(x=>x.path==='/api/solana/rpc')).toBe(true);await info.attach('explicit-controller-retry-reads',{body:JSON.stringify({explicitRetryReads,qualification:'One explicit eligible native Retry, separate from unchanged global request equality during navigation.'}),contentType:'application/json'});
 for(const step of['1','2']){
  if(step==='2'){await page.locator('#launch-next').click();await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','2');}
  const matched=await page.evaluate(quote=>window.renderCostNavigationFixture({quote,matchRetry:true}),healthy),jump=page.locator('[data-launch-cost-step="'+step+'"]');await expect(page.locator('#launch-public-quote-retry')).toBeHidden();
  // QA-approved FQA-072 exception: the new native disclosure precedes Step2 cost navigation.
  if(step==='2'){
   await expect(page.locator('#benefits-step-title')).toBeFocused();
   const originalSummary=await page.locator('#launch-availability-details > summary').elementHandle();expect(originalSummary).not.toBeNull();
   await armAvailabilityFocus(originalSummary,{step:'2'},'Tab');
   await page.keyboard.press('Tab');await availabilityFocusProof(page,'legacy-step2-original-summary-before-cost','Tab');
  }
  if(step==='1')await page.locator('[data-launch-step-target="2"]').focus();await page.keyboard.press('Tab');await expect(jump).toBeFocused();await check(jump);
  const saved=await snapshot(page),count=f.reads.length;await page.keyboard.press(step==='1'?'Enter':'Space');await check(target);expect(await target.innerHTML()).toBe(matched.markup);await page.keyboard.press('Shift+Tab');await check(back);await page.keyboard.press(step==='1'?'Space':'Enter');await check(jump);expect(await snapshot(page)).toEqual(saved);expect(f.reads.length).toBe(count);
  await rapidReverse(jump,'fee-route-agree');await expect(page.locator('#launch-public-quote-retry')).toBeHidden();
 }
 expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
 await info.attach('final-draft-and-requests',{body:JSON.stringify({snapshot:await snapshot(page),unavailablePhase,controllerReadyPhase:{reads:f.reads,font:f.font,errors:f.errors,writes:f.writes,explicitRetryReads},focus},null,2),contentType:'application/json'});
});
});

test('Desktop and connected cost review keep original data, consents and navigation',async({page},info)=>{
 test.setTimeout(60_000);const f=await setup(page,{width:1440,height:900,motion:'no-preference'});
 await page.evaluate(quote=>window.renderCostNavigationFixture({quote}),healthy);
 await expect(page.locator('[data-launch-cost-step]:visible')).toHaveCount(0);await expect(page.locator('#launch-cost-return')).toBeHidden();
 const before=await snapshot(page),markup=await page.locator('#launch-cost-details').innerHTML(),reads=f.reads.length;
 await page.locator('[data-launch-cost-step="1"]').evaluate(e=>e.click());await page.locator('#launch-cost-return').evaluate(e=>e.click());expect(await snapshot(page)).toEqual(before);expect(await page.locator('#launch-cost-details').innerHTML()).toBe(markup);expect(f.reads.length).toBe(reads);
 await page.locator('[data-launch-step-target="2"]').focus();await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement.matches('[data-launch-cost-step],#launch-cost-return'))).toBe(false);await page.keyboard.press('Shift+Tab');await expect(page.locator('[data-launch-step-target="2"]')).toBeFocused();
 const models=[];
 for(const width of[1440,360]){
  await page.setViewportSize({width,height:width===360?740:900});
  for(const variant of['fresh','expired','different-approved-fee']){
   const now=Date.now(),review={budget:'935000000',balanceAfterBudget:'1000000000',buyQuote:'840000000',allowance:'10000000',serviceFeeLamports:variant==='different-approved-fee'?'25000000':'35000000',otherLaunchCosts:'45000000',networkFee:'5000000',transactionCount:2,messageCount:2,curvePremiumBps:0,quotedAt:now,expiresAt:variant==='expired'?now-1000:now+60000};
   const result=await page.evaluate(review=>window.renderCostNavigationFixture({connected:true,review}),review);const saved=await snapshot(page),count=f.reads.length;
   await expect(page.locator('[data-launch-cost-step]:visible')).toHaveCount(0);await expect(page.locator('#launch-cost-return')).toBeHidden();await expect(page.locator('#fee-route-agree')).not.toBeChecked();await expect(page.locator('#terms-agree')).not.toBeChecked();
   await page.locator('[data-launch-cost-step="1"]').evaluate(e=>e.click());await page.locator('#launch-cost-return').evaluate(e=>e.click());expect(await page.locator('#launch-cost-details').innerHTML()).toBe(result.markup);expect(await snapshot(page)).toEqual(saved);expect(f.reads.length).toBe(count);models.push({width,variant,review,markup:result.markup});
  }
 }
 await info.attach('connected-render-only-models',{body:JSON.stringify({qualification:'Normal unchanged cost renderer with deterministic review objects; no connected wallet, signing, financial approval or submission. Existing exact-review/controller unit gates remain required.',models},null,2),contentType:'application/json'});expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('Cost navigation fails closed for stale context and preserves invalid draft and guide history',async({page},info)=>{
 test.setTimeout(60_000);const f=await setup(page,{width:360,height:740,motion:'reduce'}),back=page.locator('#launch-cost-return'),target=page.locator('#launch-cost-details');
 const enter=async step=>{const jump=page.locator(`[data-launch-cost-step="${step}"]`);await jump.focus();await page.keyboard.press('Enter');await expect(target).toBeFocused();};
 await page.evaluate(quote=>window.renderCostNavigationFixture({quote}),healthy);await enter('1');await page.locator('#launch-next').focus();await page.keyboard.press('Enter');await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','2');await expect(back).toBeHidden();const step2=await snapshot(page);await back.evaluate(e=>e.click());expect(await snapshot(page)).toEqual(step2);
 await page.evaluate(quote=>window.renderCostNavigationFixture({quote}),healthy);await enter('2');await page.locator('#launch-back').focus();await page.keyboard.press('Enter');await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','1');await expect(back).toBeHidden();
 await page.evaluate(quote=>window.renderCostNavigationFixture({quote}),healthy);await enter('1');await page.setViewportSize({width:1440,height:900});await expect(back).toBeHidden();const resized=await snapshot(page);await back.evaluate(e=>e.click());expect(await snapshot(page)).toEqual(resized);await page.setViewportSize({width:360,height:740});await expect(back).toBeHidden();
 await enter('1');const now=Date.now(),review={budget:'935000000',balanceAfterBudget:'1000000000',buyQuote:'840000000',allowance:'10000000',serviceFeeLamports:'35000000',otherLaunchCosts:'45000000',networkFee:'5000000',transactionCount:2,messageCount:2,curvePremiumBps:0,quotedAt:now,expiresAt:now+60000};await page.evaluate(review=>window.renderCostNavigationFixture({connected:true,review}),review);await expect(back).toBeHidden();const connected=await snapshot(page),privateMarkup=await target.innerHTML(),count=f.reads.length;await back.evaluate(e=>e.click());expect(await snapshot(page)).toEqual(connected);expect(await target.innerHTML()).toBe(privateMarkup);expect(f.reads.length).toBe(count);
 await page.evaluate(quote=>window.renderCostNavigationFixture({quote}),healthy);await enter('1');await page.getByRole('link',{name:'Read the launch guide →',exact:true}).click();await expect(page).toHaveURL(/#docs\/launch$/);await expect(back).toBeHidden();await page.goBack();await expect(page).toHaveURL(/#launch$/);await expect(back).toBeHidden();await expect(page.locator('#token-name')).toHaveValue('Cost planning QA');await expect(page.locator('#token-symbol')).toHaveValue('CQA');await expect(page.locator('#token-description')).toHaveValue('A local planning draft; no launch or wallet action.');
 await page.locator('#token-name').fill('');await page.locator('#launch-next').click();await expect(page.locator('#token-name-warning')).toBeVisible();await page.evaluate(quote=>window.renderCostNavigationFixture({quote}),healthy);const invalid=await snapshot(page);await enter('1');await page.keyboard.press('Shift+Tab');await expect(back).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('[data-launch-cost-step="1"]')).toBeFocused();expect(await snapshot(page)).toEqual(invalid);await expect(page.locator('#token-name-warning')).toBeVisible();await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','1');
 // Only this stale-queue assertion captures scheduling synchronously. All
 // native geometry/motion cases above retain real clocks and native frames.
 const captureFrame=cancelByFocus=>page.evaluate(cancelByFocus=>{const jump=document.querySelector('[data-launch-cost-step="1"]'),other=document.querySelector('[data-launch-step-target="1"]');other.focus({preventScroll:true});const original=window.requestAnimationFrame,originalCancel=window.cancelAnimationFrame,frames=[],canceled=[];window.requestAnimationFrame=callback=>{frames.push(callback);return 1000000000+frames.length};window.cancelAnimationFrame=id=>canceled.push(id);try{jump.focus();if(cancelByFocus)other.focus({preventScroll:true})}finally{window.requestAnimationFrame=original;window.cancelAnimationFrame=originalCancel}window.__staleCostFrames=frames;return{count:frames.length,canceled:canceled.length}},cancelByFocus);
 const flushStale=()=>page.evaluate(()=>{const snapshot=()=>({focus:document.activeElement.id||document.activeElement.outerHTML,x:scrollX,y:scrollY,hash:location.hash,step:document.querySelector('#launch-dialog').dataset.step,backHidden:document.querySelector('#launch-cost-return').hidden}),before=snapshot();for(const callback of window.__staleCostFrames)callback(performance.now());return{before,after:snapshot()}});
 const guardReads=f.reads.length;expect(await captureFrame(true)).toEqual({count:1,canceled:1});const lostFocus=await flushStale();expect(lostFocus.after).toEqual(lostFocus.before);
 expect(await captureFrame(false)).toEqual({count:1,canceled:0});await page.setViewportSize({width:1440,height:900});const lostContext=await flushStale();expect(lostContext.after).toEqual(lostContext.before);await page.setViewportSize({width:360,height:740});
 await info.attach('stale-frame-no-effect',{body:JSON.stringify({lostFocus,lostContext,qualification:'Captured canceled callback manually invoked after real focus/context changes; no acceptance timing override. All native focus cases use real requestAnimationFrame and unchanged1s/100ms checks.'}),contentType:'application/json'});expect(await snapshot(page)).toEqual(invalid);expect(f.reads.length).toBe(guardReads);
 await info.attach('stale-and-invalid-state',{body:JSON.stringify({invalid,requests:f.reads},null,2),contentType:'application/json'});expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

// FQA-072 / UX-053: actual bootstrap and existing finalized 74-byte loader.
// The legacy cost-render-only cases above remain byte-for-byte unchanged.
function observeAvailabilityFocus(original, readiness = {}) {
  const began = performance.now();
  return new Promise(resolve => {
    const samples = []; let stationaryAt = null, previous = null, frame;
    const finish = pass => { cancelAnimationFrame(frame); clearTimeout(timer); resolve({ pass, samples }); };
    const tick = () => {
      const element = original, rect = element?.getBoundingClientRect();
      const style = element && getComputedStyle(element);
      const edge = style ? (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0) : 0;
      const bounds = { left:0, right:innerWidth, top:0, bottom:innerHeight }, clips = [];
      let cornersClear = true;
      const rootStyle = getComputedStyle(document.documentElement);
      const root = { tag:document.documentElement.tagName, display:rootStyle.display,
        overflowX:rootStyle.overflowX, overflowY:rootStyle.overflowY, contain:rootStyle.contain };
      for (const chrome of document.querySelectorAll('.topbar,.mobile-workspace-nav')) {
        if (chrome.contains(element)) continue;
        if (!chrome.getClientRects().length) continue;
        const r = chrome.getBoundingClientRect();
        if (chrome.matches('.topbar')) bounds.top = Math.max(bounds.top, r.bottom);
        else bounds.bottom = Math.min(bounds.bottom, r.top);
      }
      for (let ancestor = element?.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor), r = ancestor.getBoundingClientRect();
        const clipX = /^(hidden|clip|auto|scroll)$/.test(css.overflowX);
        const clipY = /^(hidden|clip|auto|scroll)$/.test(css.overflowY);
        if (clipX || clipY) {
          // CSS Overflow 3: root overflow, or body overflow when the HTML root
          // is visible in both axes, is propagated to the viewport. Its used
          // clip is not its translated document-coordinate border rectangle.
          const viewportClip = ancestor === document.documentElement || (ancestor === document.body
            && rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible'
            && rootStyle.contain === 'none' && css.contain === 'none');
          if (viewportClip) { clips.push({ tag:ancestor.tagName, display:css.display, overflowX:css.overflowX,
            overflowY:css.overflowY, contain:css.contain, viewportClip:true,
            propagationReason:ancestor === document.documentElement ? 'root overflow applies to viewport' : 'visible HTML root propagates body overflow to viewport',
            left:0, top:0, right:innerWidth, bottom:innerHeight }); continue; }
          const box = { left:r.left + ancestor.clientLeft, top:r.top + ancestor.clientTop,
            right:r.left + ancestor.clientLeft + ancestor.clientWidth,
            bottom:r.top + ancestor.clientTop + ancestor.clientHeight };
          const radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']
            .map(key => Math.max(0, (parseFloat(css[key]) || 0) - ancestor.clientLeft));
          if (rect && clipX && clipY) {
            const points = [[rect.left-edge,rect.top-edge],[rect.right+edge,rect.top-edge],
              [rect.right+edge,rect.bottom+edge],[rect.left-edge,rect.bottom+edge]];
            const centers = [[box.left+radii[0],box.top+radii[0]],[box.right-radii[1],box.top+radii[1]],
              [box.right-radii[2],box.bottom-radii[2]],[box.left+radii[3],box.bottom-radii[3]]];
            for (let i=0;i<4;i++) { const radius=radii[i], [x,y]=points[i], [cx,cy]=centers[i];
              const inCorner = (i===0||i===3 ? x<cx : x>cx) && (i<2 ? y<cy : y>cy);
              if (radius && inCorner && (x-cx)**2+(y-cy)**2>radius**2) cornersClear=false;
            }
          }
          clips.push({ id:ancestor.id, tag:ancestor.tagName, display:css.display, overflowX:css.overflowX,
            overflowY:css.overflowY, contain:css.contain, clipX, clipY, radii, ...box });
          if (clipX) { bounds.left = Math.max(bounds.left, box.left); bounds.right = Math.min(bounds.right, box.right); }
          if (clipY) { bounds.top = Math.max(bounds.top, box.top); bounds.bottom = Math.min(bounds.bottom, box.bottom); }
        }
      }
      const position = rect && { top:rect.top, bottom:rect.bottom, left:rect.left, right:rect.right };
      const row = document.querySelector('#launch-availability');
      const panel = row?.closest('[data-launch-step]'), rowRect = row?.getBoundingClientRect();
      const warning = readiness.warning && document.getElementById(readiness.warning);
      const rowVisible = !element.matches('.step-heading h3') || (rowRect && rowRect.top >= bounds.top && rowRect.bottom <= bounds.bottom && rowRect.left >= bounds.left && rowRect.right <= bounds.right);
      const ready = Boolean(row && !panel?.hidden && rowVisible
        && (!readiness.state || row.dataset.state === readiness.state)
        && (!readiness.step || panel.dataset.launchStep === readiness.step)
        && (!readiness.warning || warning?.getClientRects().length));
      const clear = Boolean(ready && element.isConnected && rect && cornersClear && element === document.activeElement && element.matches(':focus-visible')
        && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
        && rect.left - edge >= bounds.left && rect.right + edge <= bounds.right
        && rect.top - edge >= bounds.top && rect.bottom + edge <= bounds.bottom);
      const now = performance.now(), geometry = JSON.stringify([position, scrollX, scrollY, bounds]);
      if (clear) { if (stationaryAt === null || previous !== geometry) stationaryAt = now; }
      else stationaryAt = null;
      previous = geometry;
      samples.push({ at:now - began, clear, ready, position, edge, bounds, clips, root, cornersClear,
        stationaryMs:stationaryAt === null ? 0 : now - stationaryAt });
      if (now - began > 1000) return finish(false);
      if (clear && now - stationaryAt >= 100) return finish(true);
      frame = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => finish(false), 1000);
    frame = requestAnimationFrame(tick);
  });
}

async function armAvailabilityFocus(original, readiness, key = null) {
  await original.evaluate((element, { source, readiness, key }) => {
    let resolve;
    const state = window.__launchAvailabilityFocus = { promise: new Promise(r => { resolve = r; }), events: [], key: null };
    const changed = event => state.events.push({ original: event.target === element, id: event.target.id });
    document.addEventListener('focusin', changed, true);
    const begin = event => {
      if (key && (!event?.isTrusted || event.key !== key)) return;
      if (event) state.key = { key: event.key, trusted: event.isTrusted };
      document.removeEventListener('keydown', begin, true);
      state.began = performance.now();
      (new Function('return (' + source + ')')())(element, readiness).then(proof => {
        document.removeEventListener('focusin', changed, true);
        resolve({ proof, key: state.key, events: state.events, began: state.began, ended: performance.now(),
          connected: element.isConnected, active: document.activeElement === element });
      });
    };
    if (key) document.addEventListener('keydown', begin, true); else begin();
  }, { source: observeAvailabilityFocus.toString(), readiness, key });
}
async function availabilityFocusProof(page, label, key = null) {
  const result = await page.evaluate(() => window.__launchAvailabilityFocus.promise);
  await test.info().attach('availability-native-' + label, { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.proof.pass, JSON.stringify(result)).toBe(true);
  expect(result.ended - result.began).toBeLessThanOrEqual(1000);
  expect(result.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);
  expect(result.connected && result.active).toBe(true);
  expect(result.events.every(e => e.original)).toBe(true);
  if (key) expect(result.key).toEqual({ key, trusted: true });
}
async function availabilityTab(page, selector, readiness = {}) {
  const original = await page.locator(selector).elementHandle(); expect(original).not.toBeNull();
  // Discover the final native Tab from read-only DOM order; never focus/scroll in JS.
  let next = false;
  for (let n = 0; n < 180; n++) {
    next = await original.evaluate(element => {
      const nodes = [...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')]
        .filter(e => e.tabIndex >= 0 && !e.disabled && !e.closest('[hidden],[inert]') && e.getClientRects().length && getComputedStyle(e).visibility === 'visible');
      return nodes[(nodes.indexOf(document.activeElement) + 1) % nodes.length] === element;
    });
    if (next) break;
    await page.keyboard.press('Tab');
  }
  expect(next).toBe(true);
  await armAvailabilityFocus(original, readiness, 'Tab'); await page.keyboard.press('Tab');
  await availabilityFocusProof(page, selector, 'Tab'); return original;
}
async function availabilityEnter(page, selector, readiness = {}) {
  const original = await page.locator(selector).elementHandle(); expect(original).not.toBeNull();
  await armAvailabilityFocus(original, readiness, 'Enter'); await page.keyboard.press('Enter');
  await availabilityFocusProof(page, selector + '-Enter', 'Enter'); return original;
}

async function availabilityFixture(page, width, variant = 'verified', fixtureOrigin = test.info().project.use.baseURL) {
  const { PublicKey } = await import('@solana/web3.js');
  const { deriveFeeRouter, buildExpectedFeeRouterAccountPrefix } = await import('../../fee-router.js');
  const programId = 'BPFLoaderUpgradeab1e11111111111111111111111';
  const authority = '11111111111111111111111111111111';
  const otherAuthority = 'SysvarRent111111111111111111111111111111111';
  const router = deriveFeeRouter(programId), prefix = buildExpectedFeeRouterAccountPrefix();
  expect(prefix.length).toBe(41);
  let bytes = Buffer.concat([Buffer.from(prefix), Buffer.from(new PublicKey(variant === 'authority' ? otherAuthority : authority).toBytes()), Buffer.from([router.bump])]);
  expect(bytes.length).toBe(74);
  if (variant === 'layout') bytes = bytes.subarray(0, 73);
  let releaseConfig, releaseAccount, enteredAccount;
  const configGate = new Promise(r => { releaseConfig = r; }), accountGate = new Promise(r => { releaseAccount = r; });
  const accountEntered = new Promise(r => { enteredAccount = r; });
  const f = { api: [], network: [], forbidden: [], errors: [], failed: [], accountReads: [],
    router: router.address.toBase58(), programId, authority, prefixHex: Buffer.from(prefix).toString('hex'),
    bump: router.bump, dataLength: bytes.length, variant };
  page.on('pageerror', error => f.errors.push(error.message));
  page.on('requestfailed', request => f.failed.push({ url: request.url(), method: request.method(), error: request.failure()?.errorText }));
  await page.setViewportSize({ width, height: width === 360 ? 740 : width === 390 ? 844 : 900 });
  const readMethods = new Set(['getAccountInfo', 'getMultipleAccounts', 'getSlot', 'getGenesisHash']);
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const local = url.origin === new URL(fixtureOrigin).origin;
    f.network.push({ origin: url.origin, path: url.pathname, method });
    if (!local) {
      if (method === 'GET' && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
      f.forbidden.push({ origin: url.origin, path: url.pathname, method }); return route.abort();
    }
    if (url.pathname === '/api/solana/rpc') {
      let body; try { body = request.postDataJSON(); } catch {}
      const calls = Array.isArray(body) ? body : [body];
      f.api.push({ path: url.pathname, method, calls });
      if (method !== 'POST' || !calls.length || !calls.every(c => c && readMethods.has(c.method))) {
        f.forbidden.push({ path: url.pathname, method, calls }); return route.fulfill({ status: 403, json: { error: 'Unapproved RPC fixture call' } });
      }
      const responses = [];
      for (const call of calls) {
        let value;
        if (call.method === 'getAccountInfo' && call.params?.[0] === f.router) {
          const read = { id: call.id, params: call.params, method: call.method, responseLength: bytes.length, replied: false };
          f.accountReads.push(read); enteredAccount(); await accountGate;
          value = { context: { slot: 100 }, value: { data: [bytes.toString('base64'), 'base64'],
            owner: variant === 'owner' ? 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' : programId,
            executable: false, lamports: 1000000, rentEpoch: 0, space: bytes.length } };
          read.replied = true;
        } else if (call.method === 'getAccountInfo') value = { context: { slot: 100 }, value: null };
        else if (call.method === 'getMultipleAccounts') value = { context: { slot: 100 }, value: (call.params?.[0] || []).map(() => null) };
        else if (call.method === 'getSlot') value = 100;
        else value = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
        responses.push({ jsonrpc: '2.0', id: call.id, result: value });
      }
      return route.fulfill({ json: Array.isArray(body) ? responses : responses[0] });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      f.forbidden.push({ path: url.pathname, method }); return route.fulfill({ status: 403, json: { error: 'No writes in availability fixture' } });
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    f.api.push({ path: url.pathname, method });
    if (url.pathname === '/api/v3-launch-config') {
      await configGate;
      if (variant === 'service503') return route.fulfill({ status: 503, json: { error: 'Offline launch service unavailable' } });
      return route.fulfill({ json: { ready: variant !== 'serviceFalse', cluster: 'devnet', programId,
        initialAuthority: authority, protocolSplit: PROTOCOL_FEE_SPLIT, reasons: variant === 'serviceFalse' ? ['Fixture service check has not passed'] : [] } });
    }
    if (url.pathname === '/api/fee-policy') return route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } });
    if (url.pathname === '/api/rewards/automatic') return route.fulfill({ json: { status: 'unavailable', reason: 'Offline availability fixture',
      evidence: { status: 'unavailable' }, serverTime: new Date().toISOString(), schedules: [] } });
    return route.fulfill({ status: 503, json: { error: 'Offline informational planning fixture' } });
  });
  return { ...f, f, releaseConfig, releaseAccount, accountEntered,
    async finish() { releaseConfig(); releaseAccount(); await test.info().attach('availability-actual-loader-reads', { body: JSON.stringify(f), contentType: 'application/json' }); } };
}
async function availabilityStructure(page, original = null) {
  const row = page.locator('#launch-availability'), details = page.locator('#launch-availability-details');
  await expect(row).toHaveCount(1); await expect(page.locator('#fee-router-status')).toHaveCount(1);
  await expect(page.locator('#launch-availability-summary')).toHaveAttribute('role', 'status');
  await expect(page.locator('#launch-availability-summary')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#launch-availability-summary')).toHaveAttribute('aria-atomic', 'true');
  expect(await row.locator('[aria-live]').count()).toBe(1);
  expect(await page.locator('#fee-router-status').getAttribute('role')).toBeNull();
  expect(await page.locator('#fee-router-status').getAttribute('aria-live')).toBeNull();
  expect(await row.evaluate(e => e.previousElementSibling?.classList.contains('step-heading') && !e.parentElement.hidden)).toBe(true);
  if (original) for (const [id, node] of Object.entries(original)) expect(await node.evaluate((e, id) => e === document.getElementById(id) && e.isConnected, id)).toBe(true);
  const geometry = await details.locator('summary').evaluate(e => ({ height: e.getBoundingClientRect().height, font: getComputedStyle(e).fontFamily }));
  expect(geometry.height).toBeGreaterThanOrEqual(44); expect(geometry.font).toContain('Manrope');
  await expect(page.locator('#fee-route-agree')).not.toBeChecked(); await expect(page.locator('#terms-agree')).not.toBeChecked();
  expect(await page.locator('html').getAttribute('data-connected-wallet') || '').toBe('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function availabilityNativePlanning(page, state, validate = false) {
  if (validate) {
    await availabilityTab(page, '#launch-next', { state });
    await availabilityEnter(page, '#token-name', { state, warning: 'token-name-warning' });
    await expect(page.locator('#token-name')).toHaveAttribute('aria-invalid', 'true');
    await page.locator('#token-name').fill('   ');
    await availabilityTab(page, '#launch-next', { state });
    await availabilityEnter(page, '#token-name', { state, warning: 'token-name-warning' });
    await page.locator('#token-name').fill('Launch availability QA');
    await page.locator('#token-symbol').fill('!?');
    await availabilityTab(page, '#launch-next', { state });
    await availabilityEnter(page, '#token-symbol', { state, warning: 'token-symbol-warning' });
    expect((await page.locator('#token-symbol').getAttribute('aria-describedby')).split(' ')).toContain('token-symbol-warning');
  } else await page.locator('#token-name').fill('Launch availability QA');
  await page.locator('#token-symbol').fill('AVQA');
  const description = page.locator('details').filter({ has: page.locator('#token-description') });
  if (await description.getAttribute('open') === null) await description.locator(':scope > summary').click();
  await expect(description).toHaveAttribute('open', '');
  await expect(page.locator('#token-description')).toBeVisible();
  await page.locator('#token-description').fill('A draft only. No account, consent or financial action.');
  await availabilityTab(page, '#launch-next', { state });
  await availabilityEnter(page, '#benefits-step-title', { state, step: '2' });
  await availabilityStructure(page);
  await availabilityTab(page, '#launch-back', { state, step: '2' });
  await availabilityEnter(page, '#coin-step-title', { state, step: '1' });
  await expect(page.locator('#token-name')).toHaveValue('Launch availability QA');
  await expect(page.locator('#token-symbol')).toHaveValue('AVQA');
  await expect(page.locator('#token-description')).toHaveValue('A draft only. No account, consent or financial action.');
  await expect(description).toHaveAttribute('open', '');
}

for (const width of [360, 390, 1440]) test(`Launch availability actual loader checking to verified and native planning ${width}`, async ({ page }, info) => {
  test.setTimeout(60000);
  const fixture = await availabilityFixture(page, width), f = fixture.f;
  try {
    await page.goto('/#launch'); await page.locator('body.workspace-ready.product-experience-ready').waitFor();
    await expect(page.locator('#launch-availability-label')).toHaveText('Checking launch service');
    const original = {};
    for (const id of ['launch-availability', 'launch-availability-details', 'fee-router-status', 'launch-availability-summary']) original[id] = await page.locator('#' + id).elementHandle();
    await page.evaluate(async () => { await document.fonts.ready; await document.fonts.load('700 14px "Manrope"', 'Technical details'); });
    const summary = await availabilityTab(page, '#launch-availability-details > summary', { state: 'checking' });
    await page.keyboard.press('Enter'); await expect(page.locator('#launch-availability-details')).toHaveAttribute('open', '');
    fixture.releaseConfig(); await fixture.accountEntered;
    await armAvailabilityFocus(summary, { state: 'verified' }); fixture.releaseAccount();
    await availabilityFocusProof(page, 'real-account-response-keeps-summary-focus');
    await expect(page.locator('#launch-availability-label')).toHaveText('Launch service verified');
    await expect(page.locator('#launch-availability-guidance')).toHaveText('Your wallet, quote and final launch checks are still required.');
    await expect(page.locator('#cost-total-enabled')).toHaveText('Quote unavailable', { timeout: 18000 });
    await availabilityStructure(page, original);
    const checkingAndVerifiedReads = f.api.filter(x => x.path === '/api/v3-launch-config').length;
    expect(checkingAndVerifiedReads).toBe(1); expect(f.accountReads).toHaveLength(1);
    expect(f.accountReads[0].params[0]).toBe(f.router); expect(f.accountReads[0].params[1].commitment).toBe('finalized');
    expect(f.accountReads[0].replied).toBe(true); expect(f.accountReads[0].responseLength).toBe(74);
    await availabilityNativePlanning(page, 'verified', true); await availabilityStructure(page, original);
    await expect(page.locator('#launch-availability-details')).toHaveAttribute('open', '');
    expect(f.api.filter(x => x.path === '/api/v3-launch-config')).toHaveLength(1); expect(f.accountReads).toHaveLength(1);
    await expect(page.locator('#launch-button')).toHaveAttribute('data-launch-action', 'connect-wallet');
    await expect(page.locator('#launch-button')).toHaveText('Connect wallet to create coin');
    await expect(page.locator('#launch-review-dialog')).not.toBeVisible();
    await page.screenshot({ path: info.outputPath('availability-verified-draft.png') });
    expect(f.forbidden).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await fixture.finish(); }
});

for (const { width, variant } of [
  { width: 360, variant: 'authority' }, { width: 390, variant: 'owner' }, { width: 1440, variant: 'layout' },
  { width: 390, variant: 'serviceFalse' }, { width: 360, variant: 'service503' }
]) test(`Launch availability actual loader rejects ${variant} and preserves drafting ${width}`, async ({ page }, info) => {
  test.setTimeout(60000); const fixture = await availabilityFixture(page, width, variant), f = fixture.f;
  try {
    await page.goto('/#launch'); await page.locator('body.workspace-ready.product-experience-ready').waitFor();
    await expect(page.locator('#launch-availability-label')).toHaveText('Checking launch service');
    await page.evaluate(async () => { await document.fonts.ready; await document.fonts.load('700 14px "Manrope"', 'Technical details'); });
    const summary = await availabilityTab(page, '#launch-availability-details > summary', { state: 'checking' });
    await page.keyboard.press('Enter');
    if (!variant.startsWith('service')) { fixture.releaseConfig(); await fixture.accountEntered; }
    await armAvailabilityFocus(summary, { state: 'unavailable' }); fixture.releaseAccount(); fixture.releaseConfig();
    await availabilityFocusProof(page, 'real-rejected-read-keeps-summary-focus');
    await expect(page.locator('#launch-availability-label')).toHaveText('Submission unavailable');
    await expect(page.locator('#launch-availability-guidance')).toHaveText('You can keep preparing your draft. Launch service verification has not passed.');
    await expect(page.locator('#fee-router-status')).toContainText('Launch blocked:');
    await availabilityNativePlanning(page, 'unavailable', true); await availabilityStructure(page);
    expect(f.api.filter(x => x.path === '/api/v3-launch-config')).toHaveLength(1);
    expect(f.accountReads).toHaveLength(variant.startsWith('service') ? 0 : 1);
    await expect(page.locator('#launch-button')).toBeDisabled();
    await page.screenshot({ path: info.outputPath('availability-unavailable-' + variant + '.png') });
    expect(f.forbidden).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await fixture.finish(); }
});

test('Launch availability presentation preserves ordinary entry and step request counts', async ({ page }, info) => {
  test.setTimeout(60000);
  const baselineURL = info.project.metadata.availabilityBaselineURL;
  expect(typeof baselineURL, 'Separate read-only accepted669 baseline server must be explicitly admitted in runner metadata').toBe('string');
  expect(new URL(baselineURL).hostname).toBe('127.0.0.1');
  const baseline = await page.context().newPage();
  const fixtures = [];
  try {
    const exercise = async (target, url) => {
      const fixture = await availabilityFixture(target, 390, 'serviceFalse', url); fixtures.push(fixture);
      // The baseline's origin is explicitly local and uses this same per-page transport fixture.
      // Route polling pauses in hidden tabs; both sides must own the foreground.
      await target.bringToFront();
      await expect.poll(()=>target.evaluate(()=>document.visibilityState)).toBe('visible');
      await target.goto(url + '/#launch'); await target.locator('body.workspace-ready.product-experience-ready').waitFor();
      fixture.releaseAccount(); fixture.releaseConfig();
      await expect(target.locator('#fee-router-status')).toContainText('Launch blocked:');
      await expect(target.locator('#cost-total-enabled')).toHaveText('Quote unavailable', { timeout: 18000 });
      await target.locator('#token-name').fill('Count comparison'); await target.locator('#token-symbol').fill('COUNT');
      await target.locator('#launch-next').click(); await expect(target.locator('#launch-dialog')).toHaveAttribute('data-step', '2');
      await target.locator('#launch-back').click(); await expect(target.locator('#launch-dialog')).toHaveAttribute('data-step', '1');
      await target.waitForLoadState('networkidle');
      const counts = {};
      for (const r of fixture.f.api) {
        const key = JSON.stringify([r.path, r.method, r.calls?.map(c => ({ method: c.method, params: c.params })) || null]);
        counts[key] = (counts[key] || 0) + 1;
      }
      expect(fixture.f.forbidden).toEqual([]); expect(fixture.f.errors).toEqual([]);
      return counts;
    };
    const ordinary = await exercise(baseline, baselineURL), candidate = await exercise(page, info.project.use.baseURL);
    expect(candidate).toEqual(ordinary);
    await info.attach('availability-baseline-all-api-counts', { body: JSON.stringify({ ordinary, candidate, qualification: 'Same actual-bootstrap local fixture; IDs excluded, no API/RPC/auth path or abort filtered from raw attachments.' }), contentType: 'application/json' });
  } finally { for (const fixture of fixtures) await fixture.finish(); await baseline.close(); }
});
