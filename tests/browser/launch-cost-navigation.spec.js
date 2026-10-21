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
