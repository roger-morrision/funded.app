import{test,expect}from'@playwright/test';
import{createServer}from'vite';
import{fileURLToPath}from'node:url';
import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';
const root=fileURLToPath(new URL('../../',import.meta.url));let sourceServer;
// Source-only success/focus cases replace read dependencies in memory. No hook
// or alternate source endpoint is included in the production application.
async function controlledOrigin(){
 if(!sourceServer){
  sourceServer=await createServer({root,configFile:false,cacheDir:root+'../../tmp/dev-053-read-fixture-cache',plugins:[{name:'test-only-public-quote-read-dependencies',enforce:'pre',transform(code,id){
   if(!id.replaceAll('\\','/').endsWith('/src/app/controllers/launch-preview.js'))return;
   const marker='export function createLaunchPreviewController(appState) {';
   return code.replace(marker,marker+`
    const base=appState;
    appState=Object.create(base,{
     getSolana:{value:async()=>{window.__retryFixture.attempts++;if(!window.__retryFixture.available)throw Error('Controlled unavailable read');return{};}},
     quoteAtomicReserveBuy:{value:async()=>{window.__retryFixture.reserves++;if(window.__retryFixture.hold)return new Promise(resolve=>{window.__retryFinish=resolve});return{solAmountLamports:'8715246',maxSolAmountLamports:'8802399'};}},
     updateCostSummaryView:{value:(state,deps)=>{window.__retryFixture.quote=structuredClone(state.publicQuote);return base.updateCostSummaryView(state,{...deps,getLaunchFeeLamports:()=> '20000000'});}}
    });window.__retryState=appState;
   `).replace('} catch (error) {','} catch (error) { window.__retryFixture.error=String(error);');
  }}],server:{host:'127.0.0.1',port:4504,strictPort:true}});await sourceServer.listen();
 }return'http://127.0.0.1:4504';
}
test.afterAll(async()=>{await sourceServer?.close()});
async function ready(page,width,origin=''){
 await page.setViewportSize({width,height:width<700?844:900});await page.route('https://**/*',r=>r.abort());await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Controlled offline read'}}));await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
 await page.goto(origin+'/#launch');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.evaluate(()=>document.fonts.ready);await page.locator('#token-name').fill('Retry planning');await page.locator('#token-symbol').fill('RQA');
 if(origin)await page.evaluate(()=>{window.__retryState.feeRouterState={verified:true,status:'ready'};window.__retryState.updateLaunchNavigation()});
 await page.locator('#launch-next').focus();await page.keyboard.press('Enter');await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','2');await expect(page.locator('#launch-public-quote-retry')).toBeVisible({timeout:18000});
}
async function clear(page,control){await expect(control).toBeFocused();await expect.poll(()=>control.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),m=(parseFloat(s.outlineWidth)||0)+Math.max(0,parseFloat(s.outlineOffset)||0),h=document.querySelector('.topbar'),n=document.querySelector('.mobile-workspace-nav'),top=h?.getClientRects().length?h.getBoundingClientRect().bottom:0,bottom=n?.getClientRects().length?n.getBoundingClientRect().top:innerHeight;return r.top-m>=top-1&&r.bottom+m<=bottom+1&&r.left-m>=-1&&r.right+m<=innerWidth+1})).toBe(true)}
const draft=page=>page.locator('#token-name,#token-symbol,#community-airdrop-tokens,#creator-buy-sol').evaluateAll(a=>a.map(e=>({id:e.id,value:e.value})));

for(const width of[360,390,1440])test(`source read dependencies: public quote success and focus recovery at ${width}px`,async({page},info)=>{
 await page.addInitScript(()=>{window.__retryFixture={available:false,attempts:0,reserves:0,hold:false,quote:null}});await ready(page,width,await controlledOrigin());
 const retry=page.getByRole('button',{name:'Retry budget quote',exact:true}),status=page.locator('#launch-public-quote-retry-status'),before=await draft(page),initial=await page.evaluate(()=>__retryFixture.attempts);
 await expect(retry).toHaveAttribute('aria-disabled','true');await retry.focus();await page.keyboard.press('Enter');expect(await page.evaluate(()=>__retryFixture.attempts)).toBe(initial);await clear(page,retry);expect((await retry.boundingBox()).height).toBeGreaterThanOrEqual(44);
 await page.clock.install();await page.evaluate(()=>{__retryFixture.available=true;__retryFixture.hold=true;window.__retryFinish=null});await page.clock.fastForward(16000);expect(await page.evaluate(()=>__retryFixture.attempts)).toBe(initial);await expect(retry).toHaveAttribute('aria-disabled','false');
 await page.keyboard.press('Enter');await expect(status).toHaveText('Requesting a planning quote…');for(let i=0;i<3;i++)await page.keyboard.press('Enter');await page.clock.runFor(300);await expect.poll(()=>page.evaluate(()=>typeof window.__retryFinish)).toBe('function');expect(await page.evaluate(()=>__retryFixture.attempts)).toBe(initial+1);await expect(retry).toBeFocused();
 await page.evaluate(()=>__retryFinish({solAmountLamports:'8715246',maxSolAmountLamports:'8802399'}));await expect(page.locator('#launch-cost-details dl>div')).toHaveCount(5);await expect(page.locator('#launch-public-quote-retry')).toBeHidden();const heading=page.locator('#public-launch-cost-heading');await clear(page,heading);await expect(page.locator('#launch-cost-details')).toContainText('0.078802 SOL');expect(await draft(page)).toEqual(before);
 await expect(page.locator('#terms-agree')).not.toBeChecked();await expect(page.locator('#fee-route-agree')).not.toBeChecked();expect(await page.evaluate(()=>!!__retryState.wallet)).toBe(false);await expect(page.locator('#launch-button')).not.toHaveAttribute('data-launch-action','launch');
 // New input starts a new guarded request; success must respect moved focus.
 await page.evaluate(()=>{__retryFixture.available=false;__retryFixture.hold=false});
 await page.locator('#community-airdrop-tokens').fill('31000000');
 await page.clock.runFor(300);await expect(status).toContainText('Quote unavailable');
 await page.clock.fastForward(16000);
 await page.evaluate(()=>{__retryFixture.available=true;__retryFixture.hold=true;window.__retryFinish=null});
 try {
  await expect(retry).toHaveAttribute('aria-disabled','false');
  expect(await page.evaluate(()=>__retryState.getLaunchStepState(2))).toEqual(expect.objectContaining({valid:true}));
  await retry.focus();await page.keyboard.press('Enter');await page.clock.runFor(300);
  await expect.poll(()=>page.evaluate(()=>typeof window.__retryFinish)).toBe('function');
 } finally {
  await info.attach('second-recovery-state',{body:JSON.stringify(await page.evaluate(()=>({fixture:__retryFixture,step:__retryState.getLaunchStepState(2),wallet:!!__retryState.wallet,route:__retryState.requestedPageRoute(),aria:document.querySelector('#launch-public-quote-retry-button').getAttribute('aria-disabled')}))),contentType:'application/json'});
 }
 await expect.poll(()=>page.evaluate(()=>__retryFixture.quote.status)).toBe('loading');
 await page.locator('#terms-agree').focus();await page.evaluate(()=>__retryFinish({solAmountLamports:'8715246',maxSolAmountLamports:'8802399'}));
 await expect(page.locator('#launch-public-quote-retry')).toBeHidden();await expect(page.locator('#terms-agree')).toBeFocused();await expect(page.locator('#terms-agree')).not.toBeChecked();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`source-recovered-${width}.png`)});
});

for(const width of[360,390,1440])test(`native quote-only retry with mocked RPC at ${width}px`,async({page},info)=>{
 const rpc=[],writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Registered after ready's API catch-all via a final route override below.
 const routeRpc=async()=>page.route('**/api/solana/rpc*',r=>{const q=r.request().postDataJSON();rpc.push(q.method);return r.fulfill({json:{jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'Controlled read unavailable'}}})});
 await page.route('**/*',r=>{const q=r.request();if(q.method()!=='GET'&&!q.url().includes('/api/solana/rpc'))writes.push({method:q.method(),path:new URL(q.url()).pathname});return r.fallback()});
 // Install the last RPC override before navigation, after the common API route.
 await page.setViewportSize({width,height:width<700?844:900});await page.route('https://**/*',r=>r.abort());await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Controlled offline read'}}));await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));await routeRpc();await page.goto('/#launch');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.locator('#token-name').fill('Retry planning');await page.locator('#token-symbol').fill('RQA');await page.locator('#launch-next').focus();await page.keyboard.press('Enter');
 const retry=page.getByRole('button',{name:'Retry budget quote',exact:true}),status=page.locator('#launch-public-quote-retry-status'),before=await draft(page);await expect(page.locator('#launch-public-quote-retry')).toBeVisible({timeout:18000});await expect(retry).toHaveAttribute('aria-disabled','true');await retry.focus();await clear(page,retry);expect((await retry.boundingBox()).height).toBeGreaterThanOrEqual(44);
 await page.clock.install();await page.clock.fastForward(16000);await expect(retry).toHaveAttribute('aria-disabled','false');const reads=rpc.length;await page.keyboard.press('Enter');await expect(status).toHaveText('Requesting a planning quote…');for(let i=0;i<3;i++)await page.keyboard.press('Enter');expect(rpc.length).toBe(reads);await page.clock.runFor(300);await expect(status).toContainText('Quote unavailable',{timeout:18000});await expect(retry).toHaveAttribute('aria-disabled','true');await clear(page,retry);expect(rpc.length).toBeGreaterThan(reads);expect(await draft(page)).toEqual(before);await expect(page.locator('#terms-agree')).not.toBeChecked();await expect(page.locator('#fee-route-agree')).not.toBeChecked();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);for(const r of writes)expect(r.path).toBe('/cdn-cgi/rum');await page.screenshot({path:info.outputPath(`native-failed-retry-${width}.png`)});await info.attach('mocked-read-request-methods',{body:JSON.stringify(rpc),contentType:'application/json'});
});
