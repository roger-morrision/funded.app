import { test, expect } from '@playwright/test';
import { PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const launches = [66, 67].map((value, index) => ({
  mint: new PublicKey(new Uint8Array(32).fill(value)).toBase58(),
  name: `QA recovery ${index}`, symbol: `QR${index}`, cluster: 'devnet', onchainVerified: true,
  creatorWallet: '11111111111111111111111111111111',
}));
const savedMint = new PublicKey(new Uint8Array(32).fill(68)).toBase58();

async function prepare(page, width, fixture) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.addInitScript(mint => {
    localStorage.setItem('funded.app.community.watchlist', JSON.stringify([mint]));
    localStorage.setItem('funded.app.watchlist.guest.v1', JSON.stringify({ mints: [mint],
      importId: '00000000-0000-4000-8000-000000000011', targetAccount: null }));
    localStorage.setItem('funded.app.followed.wallets.v1', '[]');
  }, savedMint);
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Controlled offline fixture' } }));
  await page.route('**/api/x/me', route => route.fulfill({ json: { authenticated: false, configured: false } }));
  await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
  await page.route('**/api/launches', route => route.fulfill(fixture.available
    ? { json: launches } : { status: 503, json: { error: 'Controlled outage' } }));
  await page.route('**/api/pump/explore?*', async route => {
    if (!fixture.available) return route.fulfill({ status: 503, json: { error: 'Controlled outage' } });
    fixture.retryStarted?.();
    if (fixture.hold) await fixture.hold;
    return route.fulfill({ json: { items: [], fetchedAt: new Date().toISOString() } });
  });
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
  await expect(page.locator('#asset-grid [data-explore-empty-action="retry"]')).toBeVisible();
  await page.waitForTimeout(400);
}

for (const width of [390, 1440]) {
  for (const activation of ['pointer', 'keyboard']) {
    test(`FQA-011 first ${activation} Grid retry reveals recovered feed at ${width}px (mocked APIs)`, async ({ page }) => {
      const fixture = { available: false };
      await prepare(page, width, fixture);
      const saved = await page.evaluate(() => localStorage.getItem('funded.app.watchlist.guest.v1'));
      await page.locator('#explore-search').fill('QA recovery');
      fixture.available = true;
      const retry = page.locator('#asset-grid [data-explore-empty-action="retry"]');
      if (activation === 'pointer') await retry.click();
      else { await page.keyboard.press('Shift'); await retry.focus(); await page.keyboard.press('Enter'); }
      await expect(page.locator('#launch-list .scanner-row')).toHaveCount(2);
      await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(2);
      await expect(page.locator('#explore-search')).toBeFocused();
      await expect(page.locator('#explore-search')).toHaveValue('QA recovery');
      const visibleFocus = await page.locator('#explore-search').evaluate(node => {
        const box = node.getBoundingClientRect();
        const nav = document.querySelector('.mobile-workspace-nav');
        const bottom = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : innerHeight;
        return box.top >= 0 && box.bottom <= bottom && box.left >= 0 && box.right <= innerWidth;
      });
      expect(visibleFocus).toBe(true);
      await expect(page.locator('button[data-explore-view="grid"]')).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => localStorage.getItem('funded.app.watchlist.guest.v1'))).toBe(saved);
    });
  }

  test(`FQA-011 failed Grid retry keeps a usable truthful outage at ${width}px (mocked APIs)`, async ({ page }) => {
    const fixture = { available: false };
    await prepare(page, width, fixture);
    const saved = await page.evaluate(() => localStorage.getItem('funded.app.watchlist.guest.v1'));
    await page.locator('#explore-search').fill('unchanged query');
    await page.locator('#explore-filter-toggle').click();
    await page.locator('#explore-promotion-filter').selectOption('premier');
    await page.keyboard.press('Escape');
    await page.locator('#asset-grid [data-explore-empty-action="retry"]').click();
    await expect(page.locator('#asset-grid .empty-state strong')).toHaveText('Tokens are temporarily unavailable.');
    await expect(page.locator('#asset-grid [data-explore-empty-action="retry"]')).toBeVisible();
    await expect(page.locator('#asset-grid [data-explore-empty-action="retry"]')).toBeFocused();
    await expect(page.locator('#explore-search')).toHaveValue('unchanged query');
    await expect(page.locator('#explore-promotion-filter')).toHaveValue('premier');
    expect(await page.evaluate(() => localStorage.getItem('funded.app.watchlist.guest.v1'))).toBe(saved);
  });

  test(`FQA-011 Table outage retry still recovers at ${width}px (mocked APIs)`, async ({ page }) => {
    const fixture = { available: false };
    await prepare(page, width, fixture);
    await page.locator('button[data-explore-view="table"]').click();
    await expect(page.locator('#launch-list .empty-state strong')).toHaveText('Tokens are temporarily unavailable.');
    fixture.available = true;
    await page.locator('#launch-list [data-verified-feed-retry]').click();
    await expect(page.locator('#launch-list .scanner-row')).toHaveCount(2);
    await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
  });

  for (const departure of ['search', 'table', 'route']) {
    test(`FQA-011 late retry completion respects ${departure} at ${width}px (mocked APIs)`, async ({ page }) => {
      let release;
      const hold = new Promise(resolve => { release = resolve; });
      let started;
      const requestStarted = new Promise(resolve => { started = resolve; });
      const fixture = { available: false, hold, retryStarted: started };
      await prepare(page, width, fixture);
      fixture.available = true;
      await page.locator('#asset-grid [data-explore-empty-action="retry"]').click();
      await requestStarted;
      if (departure === 'search') await page.locator('#explore-search').click();
      else if (departure === 'table') await page.locator('button[data-explore-view="table"]').click();
      else {
        const home = width === 390
          ? page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Home' })
          : page.locator('#sidebar a.nav-item[href="#overview"]');
        await home.click();
        await expect(page.locator('body')).toHaveClass(/page-route-overview/);
      }
      release();
      await expect(page.locator('#launch-list .scanner-row')).toHaveCount(2);
      if (departure === 'search') await expect(page.locator('#explore-search')).toBeFocused();
      else if (departure === 'table') {
        await expect(page.locator('button[data-explore-view="table"]')).toBeFocused();
        await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
      } else {
        await expect(page).toHaveURL(/#overview$/);
        await expect(page.locator('#explore-search')).not.toBeFocused();
      }
    });
  }
}

// FQA-069: controlled API/SDK account fixtures through the actual bootstrap.
// No wallet, transaction, real clipboard, app-state injection or clock changes.
async function stageAvailabilityFixture(page,width,mode){
 const [{PUMP_SDK,bondingCurvePda},{MintLayout,TOKEN_PROGRAM_ID},{default:BN}]=await Promise.all([import('@pump-fun/pump-sdk'),import('@solana/spl-token'),import('bn.js')]);
 const f={mode,reads:[],writes:[],errors:[]};let gate;
 f.hold=()=>{let release,started;gate={promise:new Promise(r=>release=r),started:new Promise(r=>started=r),release,start:()=>started(),used:false};return gate;};
 const mintData=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000000000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},mintData);
 const curves={};for(const complete of[false,true])curves[String(complete)]=await PUMP_SDK.offlinePumpProgram.coder.accounts.encode('bondingCurve',{virtualTokenReserves:new BN('1000000000000'),virtualQuoteReserves:new BN('30000000000'),realTokenReserves:new BN(complete?'0':'700000000000'),realQuoteReserves:new BN('1000000000'),tokenTotalSupply:new BN('1000000000000000'),complete,creator:PublicKey.default,isMayhemMode:false,isCashbackCoin:false,quoteMint:PublicKey.default,creatorFeeBps:new BN(0),canEditCreatorFee:false,isHolderReward:false});
 const curveKeys=launches.map(r=>bondingCurvePda(new PublicKey(r.mint)).toBase58()),account=(data,owner)=>({lamports:1000000,executable:false,owner,rentEpoch:0,data:[data.toString('base64'),'base64']}),mintInfo=account(mintData,TOKEN_PROGRAM_ID.toBase58());
 const valueFor=key=>launches.some(r=>r.mint===key)?mintInfo:curveKeys.includes(key)&&['curve','complete-unknown','complete-none'].includes(f.mode)?account(curves[String(f.mode!=='curve')],PUMP_SDK.offlinePumpProgram.programId.toBase58()):null;
 await page.setViewportSize({width,height:width===390?844:900});page.on('pageerror',e=>f.errors.push(e.message));
 await page.route('https://**/*',r=>r.request().method()==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.route('**/api/**',async r=>{
  const q=r.request(),u=new URL(q.url());f.reads.push({path:u.pathname,method:q.method(),mode:f.mode});
  if(u.pathname==='/api/fee-policy')return r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}});
  if(u.pathname==='/api/x/me')return r.fulfill({json:{authenticated:false,configured:false}});
  if(u.pathname==='/api/launches')return r.fulfill({json:f.mode==='empty'?[]:launches});
  if(u.pathname==='/api/pump/explore'){const held=gate;if(held&&!held.used){held.used=true;held.start();await held.promise;}return r.fulfill({json:{items:f.mode==='empty'?[]:launches,fetchedAt:new Date().toISOString()}});}
  if(u.pathname==='/api/solana/rpc'){
   const body=q.postDataJSON(),calls=Array.isArray(body)?body:[body],responses=calls.map(c=>{
    const keys=c.params?.[0],multiple=c.method==='getMultipleAccounts',primary=multiple&&keys.some(k=>launches.some(v=>v.mint===k));
    if(multiple&&(['fallback','rpc-failure'].includes(f.mode)||(f.mode==='complete-unknown'&&!primary)))return{jsonrpc:'2.0',id:c.id,error:{code:-32000,message:'Controlled account lookup unavailable'}};
    let result=null;if(multiple)result={context:{slot:100},value:keys.map(valueFor)};
    else if(c.method==='getAccountInfo')result={context:{slot:100},value:valueFor(keys)};
    else if(c.method==='getSlot')result=100;
    else if(c.method==='getGenesisHash')result='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
    else if(c.method==='getTokenLargestAccounts')result={context:{slot:100},value:[]};
    else if(c.method==='getProgramAccounts')result=[];
    else if(c.method==='getTokenAccountsByOwner')result={context:{slot:100},value:[]};
    else f.writes.push({rpc:c.method});return{jsonrpc:'2.0',id:c.id,result};
   });return r.fulfill({json:Array.isArray(body)?responses:responses[0]});
  }
  if(!['GET','HEAD','OPTIONS'].includes(q.method()))f.writes.push({path:u.pathname,method:q.method()});
  return r.fulfill({status:503,json:{error:'Controlled unavailable read; no market activity verification'}});
 });
 // This retained status synchronizes completed rendering, not pool verification.
 f.open=async(loading=false)=>{await page.goto('/#overview');await expect(page.locator('body')).toHaveClass(/product-experience-ready/);if(!loading)await expect(page.locator('#explore-pulse-scope')).toHaveText(/^(Launch stages unavailable\.|\d+ launch stages await curve or pool verification\.|Stages confirmed on-chain\.)$/);};
 f.feedReads=()=>f.reads.filter(x=>x.path==='/api/pump/explore').length;
 return f;
}
// Home now previews discovery; the stage scanner and table remain in Explore.
// Exercise the current controls through the same real bootstrap and RPC fixtures.
for(const width of [390,1440])for(const mode of ['unknown','curve','empty'])test(`Home discovery preview and scanner handoff ${mode} at ${width}px`,async({page})=>{
 const f=await stageAvailabilityFixture(page,width,mode);await f.open();
 await expect(page.locator('.home-launch-tabs')).toBeHidden();
 await expect(page.locator('[data-home-view="table"]')).toBeHidden();
 for(const value of ['trending','near','saved','new']){
  const button=page.locator(`[data-home-discovery="${value}"]`);await button.click();await expect(button).toHaveAttribute('aria-pressed','true');
  if(value==='trending')await expect(page.locator('#home-ranking-note')).toContainText('Paid boosts do not affect this ranking');
 }
 await expect(page.locator('#home-launch-grid .home-new-token-card')).toHaveCount(mode==='empty'?0:2);
 await page.getByRole('link',{name:'View all coins →',exact:true}).click();await expect(page).toHaveURL(/#explore$/);
 await expect(page.locator('#explore-search')).toBeVisible();
 await expect(page.locator('[data-explore-view="table"]')).toBeVisible();
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

// Isolated complete startup binding with explicit fake DOM/RAF only.
// These checks prove cancellation logic, not native browser timing or visibility.
async function homeRetryBindingVm(){
 const [{default:vm},fs,{createHash}]=await Promise.all([import('node:vm'),import('node:fs'),import('node:crypto')]);
 const bytes=fs.readFileSync(new URL('../../src/app/startup/home-feed.js',import.meta.url));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe('db6ede9fe906242ecfce80f73045277b66f8b864db8fc57a334c9766fd63a4de');
 const text=bytes.toString();expect(text.split('export function initializeHomeFeed(')).toHaveLength(2);
 const source=text.replace(/^import[^\n]+\n/,'').replace('export function initializeHomeFeed(','function initializeHomeFeed(');
 const ev=new Map(),pe={},q=new Map(),scroll=[];let id=0;
 const state={overview:true,regular:true},wrap={hidden:false,clientLeft:1,clientWidth:342,scrollWidth:760,scrollLeft:0,scrollTop:7,
  getBoundingClientRect:()=>({left:18,right:362}),addEventListener:(n,fn)=>pe[n]=fn,
  scrollBy:o=>{scroll.push({...o});wrap.scrollLeft+=o.left;wrap.scrollTop+=o.top;}};
 const node=(owned=true)=>({isConnected:true,hidden:false,inert:false,visible:true,keyboard:true,rect:{left:352,right:444},
  matches(){return this.keyboard;},getClientRects(){return this.visible?[{}]:[];},getBoundingClientRect(){return this.rect;},
  closest(s){if(s==='[data-verified-feed-retry]')return owned?this:null;if(s==='#home-launch-table-wrap')return wrap;
   if(s==='#home-launch-table-body')return owned&&state.regular?{}:null;if(s==='[hidden],[inert]')return this.hidden||this.inert?this:null;return null;}});
 const a=node(),b=node(),foreign=node(false),doc={activeElement:null,body:{classList:{contains:()=>state.overview}},
  querySelector:s=>s==='#home-launch-table-wrap'?wrap:s==='#home-paid-listing-table'?{}:null,querySelectorAll:()=>[]};
 const ctx={document:doc,initializeAppState:(s,k,v)=>s[k]=v,scrollX:13,scrollY:211,
  getComputedStyle:e=>({outlineWidth:'3px',outlineOffset:'2px',visibility:e.visible?'visible':'hidden'}),
  requestAnimationFrame:fn=>{const key=++id;q.set(key,()=>{q.delete(key);fn();});return key;},cancelAnimationFrame:key=>q.delete(key)};
 ctx.window={addEventListener:(n,fn)=>{if(!ev.has(n))ev.set(n,new Set());ev.get(n).add(fn);},removeEventListener:(n,fn)=>ev.get(n)?.delete(fn),
  scrollBy:()=>{throw Error('Window scroll is outside the binding scope');},scrollTo:()=>{throw Error('Window scroll is outside the binding scope');}};
 vm.runInNewContext(source+';initializeHomeFeed({});',ctx,{timeout:1000});
 return{a,b,foreign,doc,ctx,state,wrap,q,scroll,ev,pe,emit:n=>[...(ev.get(n)||[])].forEach(fn=>fn()),
  focus:target=>{doc.activeElement=target;pe.focusin({target});},run:()=>{const work=[...q.values()];q.clear();work.forEach(fn=>fn());}};
}
function retryBindingIdle(f,count=0){
 expect(f.q.size).toBe(0);expect(f.scroll).toHaveLength(count);
 for(const n of['keydown','pointerdown','wheel','touchstart','hashchange','pagehide'])expect(f.ev.get(n)?.size||0).toBe(0);
 expect(f.wrap.scrollTop).toBe(7);expect([f.ctx.scrollX,f.ctx.scrollY]).toEqual([13,211]);
}
test('FQA-069 isolated complete binding reveals only the original horizontal outline once',async()=>{
 for(const [rect,delta]of[[{left:352,right:444},88],[{left:10,right:102},-14],[{left:80,right:172},0]]){
  const f=await homeRetryBindingVm();f.a.rect=rect;f.focus(f.a);expect(f.q.size).toBe(1);const old=[...f.q.values()][0];f.run();old();
  expect(f.scroll).toEqual(delta?[{left:delta,top:0,behavior:'instant'}]:[]);expect(f.doc.activeElement).toBe(f.a);retryBindingIdle(f,delta?1:0);
 }
});
test('FQA-069 isolated complete binding yields to later input and superseding focus',async()=>{
 for(const type of['keydown','pointerdown','wheel','touchstart','hashchange','pagehide','focusout']){
  const f=await homeRetryBindingVm();f.focus(f.a);const old=[...f.q.values()][0];
  if(type==='focusout'){f.doc.activeElement=f.foreign;f.pe.focusout();}else f.emit(type);old();retryBindingIdle(f);
  expect(f.doc.activeElement).toBe(type==='focusout'?f.foreign:f.a);
 }
 const f=await homeRetryBindingVm();f.focus(f.a);const old=[...f.q.values()][0];f.focus(f.b);old();expect(f.scroll).toHaveLength(0);
 expect(f.q.size).toBe(1);f.run();expect(f.doc.activeElement).toBe(f.b);retryBindingIdle(f,1);
});
test('FQA-069 isolated complete binding rejects invalid owners and hidden or foreign views',async()=>{
 const changes=[f=>{f.doc.activeElement=f.foreign;},f=>{f.a.isConnected=false;},f=>{f.a.visible=false;},f=>{f.a.hidden=true;},
  f=>{f.a.inert=true;},f=>{f.a.keyboard=false;},f=>{f.state.overview=false;},f=>{f.state.regular=false;},f=>{f.wrap.hidden=true;},f=>{f.wrap.scrollWidth=342;}];
 for(const change of changes){const f=await homeRetryBindingVm();f.focus(f.a);const old=[...f.q.values()][0];change(f);f.run();old();retryBindingIdle(f);}
 for(const setup of[f=>f.foreign,f=>{f.a.keyboard=false;return f.a;},f=>{f.state.regular=false;return f.a;}]){
  const f=await homeRetryBindingVm();f.focus(setup(f));retryBindingIdle(f);
 }
});
