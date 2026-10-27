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
          ? page.getByRole('navigation', { name: 'Mobile workspace' }).getByRole('link', { name: 'Home' })
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
const stageTab=(page,name)=>page.locator(`[data-home-launch-tab="${name}"]`),stageTitle=page=>page.locator('#home-launch-grid .empty-state strong');
async function stageEvidence(page,info,f,label){
 const fonts=await page.evaluate(async()=>{await document.fonts.ready;const result=[];for(const e of document.querySelectorAll('.home-launch-tabs button,#home-launch-grid .empty-state strong')){const s=getComputedStyle(e);if(!s.fontFamily.includes('Manrope'))continue;const request=s.fontWeight+' 14px '+s.fontFamily.split(',')[0];result.push({request,loaded:(await document.fonts.load(request)).some(x=>x.status==='loaded')});}return result;});expect(fonts.length).toBeGreaterThan(0);expect(fonts.every(x=>x.loaded)).toBe(true);
 const state=await page.evaluate(()=>({title:document.querySelector('#home-launch-grid .empty-state strong')?.textContent,body:document.querySelector('#home-launch-grid').innerText,selected:document.querySelector('[data-home-launch-tab][aria-selected="true"]')?.dataset.homeLaunchTab,stageScope:document.querySelector('#explore-pulse-scope').textContent,sourceLabel:document.querySelector('#explore-cluster-label')?.textContent,documentWidth:document.documentElement.scrollWidth,viewport:innerWidth}));
 await info.attach(label,{body:JSON.stringify({mode:f.mode,state,fonts,reads:f.reads,writes:f.writes,errors:f.errors,qualification:'Controlled full bootstrap with SDK-encoded account bytes and read-only API fixtures; not public service recovery or chain proof.'},null,2),contentType:'application/json'});await page.screenshot({path:info.outputPath(label+'.png')});expect(state.documentWidth).toBeLessThanOrEqual(state.viewport+1);expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
}
const stageCases=[
 {id:'registry-unknown-curve',mode:'fallback',tab:'curve',title:'Curve verification is unavailable.',retry:true},
 {id:'mint-known-stage-unknown',mode:'unknown',tab:'migrated',title:'Migration verification is unavailable.',retry:true},
 {id:'complete-pool-unavailable',mode:'complete-unknown',tab:'migrated',title:'Migration verification is unavailable.',retry:true},
 {id:'active-curve-is-not-unknown-migration',mode:'curve',tab:'migrated',title:'No verified launches in this view.',retry:false},
 {id:'complete-no-pool-is-confirmed-not-migrated',mode:'complete-none',tab:'migrated',title:'No verified launches in this view.',retry:false},
 {id:'confirmed-empty',mode:'empty',tab:'curve',title:'No verified launches in this view.',retry:false},
];
for(const width of[390,1440]){
 for(const scenario of stageCases)test(`FQA-069 Home ${scenario.id} at ${width}px`,async({page},info)=>{
  const f=await stageAvailabilityFixture(page,width,scenario.mode);await f.open();await stageTab(page,scenario.tab).click();await stageEvidence(page,info,f,scenario.id+'-'+width);
  await expect(stageTitle(page)).toHaveText(scenario.title);await expect(page.locator('#home-launch-grid [data-verified-feed-retry]')).toHaveCount(scenario.retry?1:0);
  if(scenario.retry)await expect(page.locator('#home-launch-grid .empty-state span')).toContainText('All');
  await page.locator('[data-home-view="table"]').click();await expect(page.locator('#home-launch-table-body .home-table-empty strong')).toHaveText(scenario.title);await expect(page.locator('#home-launch-table-body [data-verified-feed-retry]')).toHaveCount(scenario.retry?1:0);await page.locator('[data-home-view="grid"]').click();
  await stageTab(page,'all').click();await expect(page.locator('#home-launch-grid .home-launch-card')).toHaveCount(scenario.mode==='empty'?0:2);
  if(scenario.mode==='curve'){await stageTab(page,'curve').click();await expect(page.locator('#home-launch-grid .home-launch-card')).toHaveCount(2);await expect(page.locator('#home-launch-grid')).not.toContainText('verification is unavailable');}
  if(scenario.mode.startsWith('complete')){await stageTab(page,'curve').click();await expect(stageTitle(page)).toHaveText('No verified launches in this view.');}
  if(scenario.mode==='empty'){await stageTab(page,'migrated').click();await expect(stageTitle(page)).toHaveText('No verified launches in this view.');}
 });
 test(`FQA-069 Home initial held check remains loading at ${width}px`,async({page},info)=>{
  const f=await stageAvailabilityFixture(page,width,'unknown'),gate=f.hold();try{await f.open(true);await gate.started;await stageTab(page,'curve').click();await expect(stageTitle(page)).toHaveText('Checking launch stages…');await expect(page.locator('#home-launch-grid [data-verified-feed-retry]')).toHaveCount(0);await stageEvidence(page,info,f,'initial-loading-'+width);}finally{gate.release();}
  await expect(stageTitle(page)).toHaveText('Curve verification is unavailable.');
 });
 test(`FQA-069 Home explicit retry deduplicates and recovers selected curve at ${width}px`,async({page},info)=>{
  const f=await stageAvailabilityFixture(page,width,'unknown');await f.open();await stageTab(page,'curve').click();const retry=page.locator('#home-launch-grid [data-verified-feed-retry]');await expect(retry).toBeVisible();
  const before=f.feedReads(),gate=f.hold();f.mode='curve';try{
   if(width===390)await retry.click();else{for(let i=0;i<80&&!await retry.evaluate(e=>document.activeElement===e);i++)await page.keyboard.press('Tab');await expect(retry).toBeFocused();await page.keyboard.press('Enter');}
   await gate.started;await expect(retry).toBeDisabled();await expect(retry).toHaveText('Checking launches…');await page.keyboard.press('Enter');expect(f.feedReads()-before).toBe(1);await expect(stageTab(page,'curve')).toHaveAttribute('aria-selected','true');
  }finally{gate.release();}
  await expect(page.locator('#home-launch-grid .home-launch-card')).toHaveCount(2);expect(f.feedReads()-before).toBe(1);await expect(stageTab(page,'curve')).toHaveAttribute('aria-selected','true');await stageEvidence(page,info,f,'retry-recovered-'+width);
 });
 test(`FQA-069 Home query empty is not masked by unrelated unknown stages at ${width}px`,async({page},info)=>{
  const f=await stageAvailabilityFixture(page,width,'unknown');await f.open();await stageTab(page,'curve').click();await expect(stageTitle(page)).toHaveText('Curve verification is unavailable.');
  await page.locator('.home-feed-settings summary').click();await page.locator('#home-filter-search').fill('unmatched-069-query');await page.locator('.home-filter-apply').click();await expect(stageTitle(page)).toHaveText('No launches match these filters.');await expect(page.locator('#home-launch-grid [data-verified-feed-retry]')).toHaveCount(0);await stageEvidence(page,info,f,'query-empty-'+width);
  await page.locator('.home-feed-settings summary').click();await expect(page.locator('#home-filter-search')).toHaveValue('unmatched-069-query');await page.locator('#home-filter-reset').click();await page.locator('#home-filter-close').click();await expect(stageTitle(page)).toHaveText('Curve verification is unavailable.');
 });
 test(`FQA-069 Home retains known curve snapshot after a failed native refresh at ${width}px`,async({page},info)=>{
  const f=await stageAvailabilityFixture(page,width,'curve');await f.open();await stageTab(page,'curve').click();await expect(page.locator('#home-launch-grid .home-launch-card')).toHaveCount(2);
  const nav=name=>width===390?page.getByRole('navigation',{name:'Mobile workspace'}).getByRole('link',{name,exact:true}):page.locator('#sidebar a.nav-item[href="#'+(name==='Home'?'overview':'explore')+'"]');await nav('Explore').click();f.mode='rpc-failure';await page.locator('#explore-sort').selectOption('newest');await expect(page.locator('#explore-pulse-scope')).toHaveText('Launch stages use the last verified feed.');await nav('Home').click();await expect(stageTab(page,'curve')).toHaveAttribute('aria-selected','true');await expect(page.locator('#home-launch-grid .home-launch-card')).toHaveCount(2);await expect(page.locator('#home-launch-grid')).not.toContainText('verification is unavailable');await stageEvidence(page,info,f,'known-stale-'+width);
 });
}

// Same passive whole-outline observer as the admitted token/wallet benchmark;
// function name alone changes. No geometry, deadline or stationary-time waiver.
function observeHomeRetryFocus(selector) {
  const began = performance.now();
  return new Promise(resolve => {
    const samples = []; let stationaryAt = null, previous = null, frame;
    const finish = pass => { cancelAnimationFrame(frame); clearTimeout(timer); resolve({ pass, samples }); };
    const tick = () => {
      const element = document.querySelector(selector), rect = element?.getBoundingClientRect();
      const style = element && getComputedStyle(element);
      const edge = style ? (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0) : 0;
      const bounds = { left:0, right:innerWidth, top:0, bottom:innerHeight }, clips = [];
      let cornersClear = true;
      const rootStyle = getComputedStyle(document.documentElement);
      const root = { tag:document.documentElement.tagName, display:rootStyle.display,
        overflowX:rootStyle.overflowX, overflowY:rootStyle.overflowY, contain:rootStyle.contain };
      for (const chrome of document.querySelectorAll('.topbar,.mobile-workspace-nav')) {
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
      const clear = Boolean(rect && cornersClear && element === document.activeElement && element.matches(':focus-visible')
        && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
        && rect.left - edge >= bounds.left && rect.right + edge <= bounds.right
        && rect.top - edge >= bounds.top && rect.bottom + edge <= bounds.bottom);
      const now = performance.now(), geometry = JSON.stringify([position, scrollX, scrollY, bounds]);
      if (clear) { if (stationaryAt === null || previous !== geometry) stationaryAt = now; }
      else stationaryAt = null;
      previous = geometry;
      samples.push({ at:now - began, clear, position, edge, bounds, clips, root, cornersClear,
        stationaryMs:stationaryAt === null ? 0 : now - stationaryAt });
      if (now - began > 1000) return finish(false);
      if (clear && now - stationaryAt >= 100) return finish(true);
      frame = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => finish(false), 1000);
    frame = requestAnimationFrame(tick);
  });
}

async function homeRetryPadding(page) {
 return page.evaluate(() => {
  const s = getComputedStyle(document.documentElement);
  return {top:s.scrollPaddingTop,bottom:s.scrollPaddingBottom};
 });
}
for (const width of [390,1440]) for (const view of ['grid','table']) {
 test(`FQA-069 native Retry outline and recovery ${view} at ${width}px`, async ({page},info) => {
  const f = await stageAvailabilityFixture(page,width,'unknown');
  await f.open();
  await stageEvidence(page,info,f,`native-start-${view}-${width}`);
  const baselinePadding = await homeRetryPadding(page), padding = [];
  const observePadding = async label => {
   const value = await homeRetryPadding(page); padding.push({label,...value});
   expect(value.top).toBe(baselinePadding.top); return value;
  };
  const inactive = async label => expect((await observePadding(label)).bottom).toBe(baselinePadding.bottom);
  const active = async label => {
   const value = await observePadding(label);
   if (width === 390) expect(parseFloat(value.bottom)).toBeGreaterThanOrEqual(96);
   else expect(value.bottom).toBe(baselinePadding.bottom);
  };
  await page.locator(`[data-home-view="${view}"]`).click();
  await stageTab(page,'curve').click(); await active('visible-retry');
  // The regular table retains old Retry markup while paid listings hide it.
  await stageTab(page,'paid-listing').click();
  await expect(page.locator('#home-launch-grid [data-verified-feed-retry]')).toHaveCount(0);
  await expect(page.locator('#home-launch-table-body [data-verified-feed-retry]')).toHaveCount(1);
  await expect(page.locator('#home-launch-table-body').locator('..')).toBeHidden();
  await inactive('hidden-regular-table-duplicate');
  await stageTab(page,'curve').click(); await active('retry-restored');
  const nav = name => width === 390
   ? page.getByRole('navigation',{name:'Mobile workspace'}).getByRole('link',{name,exact:true})
   : page.locator('#sidebar a.nav-item[href="#'+(name==='Home'?'overview':'explore')+'"]');
  await nav('Explore').click();
  await expect(page.locator('body')).toHaveClass(/page-route-explore/);
  await expect(page.locator('#home-launch-grid [data-verified-feed-retry]')).toHaveCount(1);
  await inactive('ordinary-explore-exit-with-retained-home-markup');
  await nav('Home').click(); await active('home-return');
  await expect(stageTab(page,'curve')).toHaveAttribute('aria-selected','true');
  await expect(page.locator(`[data-home-view="${view}"]`)).toHaveAttribute('aria-pressed','true');
  const selector = view === 'grid' ? '#home-launch-grid [data-verified-feed-retry]'
   : '#home-launch-table-body [data-verified-feed-retry]';
  const retry = page.locator(selector);
  const predecessorSelector = view === 'grid' ? '.home-feed-settings > summary' : '#home-table-sort-mc';
  const predecessor = page.locator(predecessorSelector), walk = [];
  for (let i=0;i<80;i++) {
   const at = await predecessor.evaluate(e => ({same:document.activeElement===e,id:document.activeElement?.id,tag:document.activeElement?.tagName}));
   walk.push(at); if (at.same) break; await page.keyboard.press('Tab');
  }
  await expect(predecessor).toBeFocused();
  const armed = await page.evaluate(({selector,predecessorSelector,source}) => {
   const target = document.querySelector(selector), predecessor = document.querySelector(predecessorSelector);
   const tabbable = [...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')]
    .filter(e => e.tabIndex >= 0 && !e.disabled && !e.closest('[hidden],[inert]') && e.getClientRects().length
     && getComputedStyle(e).visibility === 'visible');
   const index = tabbable.indexOf(predecessor), next = tabbable[index+1];
   const observer = new Function('return ('+source+')')();
   const state = window.__homeRetryNative = {began:performance.now(),original:target};
   state.promise = observer(selector).then(focus => ({focus,endedAt:performance.now(),began:state.began,key:state.key}));
   document.addEventListener('keydown',e => {state.key={key:e.key,trusted:e.isTrusted,at:performance.now()};},{capture:true,once:true});
   return {at:performance.now(),predecessor:document.activeElement===predecessor,nextIsOriginal:index >= 0 && next===target,
    targetConnected:Boolean(target?.isConnected),targetCurrent:target===document.querySelector(selector),
    next:{id:next?.id,tag:next?.tagName,retry:next?.hasAttribute('data-verified-feed-retry')}};
  },{selector,predecessorSelector,source:observeHomeRetryFocus.toString()});
  expect(armed.predecessor).toBe(true); expect(armed.nextIsOriginal).toBe(true);
  expect(armed.targetConnected).toBe(true); expect(armed.targetCurrent).toBe(true);
  const original = await page.evaluateHandle(() => window.__homeRetryNative.original);
  await page.keyboard.press('Tab');
  const postTab = await page.evaluate(() => {
   const active=document.activeElement, original=window.__homeRetryNative.original;
   return {sameOriginal:active===original,connected:original.isConnected,id:active?.id,tag:active?.tagName,retry:active?.hasAttribute('data-verified-feed-retry')};
  });
  const proof = await page.evaluate(() => window.__homeRetryNative.promise);
  await info.attach('native-whole-outline',{body:JSON.stringify({width,view,predecessorSelector,armed,postTab,proof,padding,walk,qualification:'Actual native final Tab; observer before input, inclusive1s/100ms unchanged. SDK/API fixtures are controlled, not chain recovery.'},null,2),contentType:'application/json'});
  expect(postTab.sameOriginal).toBe(true); expect(postTab.connected).toBe(true); expect(postTab.retry).toBe(true);
  expect(proof.key?.trusted).toBe(true); expect(proof.key.key).toBe('Tab'); expect(proof.key.at).toBeGreaterThanOrEqual(armed.at);
  expect(proof.endedAt-proof.began).toBeLessThanOrEqual(1000);
  expect(proof.focus.pass,JSON.stringify(proof.focus)).toBe(true);
  expect(proof.focus.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);
  expect(await original.evaluate(e => e.isConnected&&document.activeElement===e)).toBe(true);
  await page.screenshot({path:info.outputPath(`native-retry-${view}-${width}.png`)});
  const before = f.feedReads(), gate = f.hold(); f.mode='curve';
  try {
   await page.keyboard.press('Enter'); await gate.started;
   await expect(retry).toBeDisabled(); await page.keyboard.press('Enter');
   expect(f.feedReads()-before).toBe(1);
  } finally { gate.release(); }
  const recovered = view === 'grid' ? '#home-launch-grid .home-launch-card' : '#home-launch-table-body tr';
  await expect(page.locator(recovered)).toHaveCount(2); expect(f.feedReads()-before).toBe(1);
  await inactive('no-retry-after-recovery');
  await expect(stageTab(page,'curve')).toHaveAttribute('aria-selected','true');
  await expect(page.locator(`[data-home-view="${view}"]`)).toHaveAttribute('aria-pressed','true');
  await stageEvidence(page,info,f,`native-recovered-${view}-${width}`);
  await info.attach('native-padding-boundaries',{body:JSON.stringify({baselinePadding,padding},null,2),contentType:'application/json'});
 });
}

// Isolated complete startup binding with explicit fake DOM/RAF only.
// These checks prove cancellation logic, not native browser timing or visibility.
async function homeRetryBindingVm(){
 const [{default:vm},fs,{createHash}]=await Promise.all([import('node:vm'),import('node:fs'),import('node:crypto')]);
 const bytes=fs.readFileSync(new URL('../../src/app/startup/home-feed.js',import.meta.url));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe('5b8590757663d6d9d79cf75bd41ac087d536b9250871a49dd1f32123c3635095');
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
