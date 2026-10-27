import { test, expect } from '@playwright/test';
import { PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const [premierMint, holderMint] = [1, 2].map(value => new PublicKey(new Uint8Array(32).fill(value)).toBase58());
const creatorWallet = '11111111111111111111111111111111';
const launches = [
  { mint: premierMint, name: 'Fee premier QA', symbol: 'PREM', cluster: 'devnet', onchainVerified: true,
    creatorWallet, signature: 'premier-fixture-proof', creatorLaunchBurn: { tier: 'premier', status: 'verified',
      amountTokens: 100, receipt: { verified: true, atomicWithPumpLaunch: true, signature: 'premier-fixture-proof' } } },
  { mint: holderMint, name: 'Holder rewards QA', symbol: 'HOLD', cluster: 'devnet', onchainVerified: true,
    creatorWallet, feeDistribution: { creatorDirected: { shares: { holderAirdropPercent: 10 } } } },
];

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`UX-008 combined Explore guidance and recovery at ${width}px (mocked launches)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('https://**/*', route => route.abort());
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Offline fixture' } }));
    await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
    await page.route('**/api/launches', route => route.fulfill({ json: launches }));
    await page.route('**/api/pump/explore?*', route => route.fulfill({ json: { items: [], fetchedAt: new Date().toISOString() } }));
    await page.goto('/#explore');
    await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
    await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(2);

    const toggle = page.locator('#explore-filter-toggle');
    const filters = page.locator('#explore-filter-popover');
    await toggle.click();
    await page.locator('#explore-promotion-filter').selectOption('premier');
    await expect(page.locator('#asset-grid')).toContainText('Fee premier QA');
    await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(1);
    await page.locator('#explore-reward-filter').selectOption('holder-fees');
    await expect(page.locator('#asset-grid .empty-state strong')).toHaveText('No tokens match this combination.');
    await expect(page.locator('#asset-grid .explore-empty-criteria')).toHaveText('Premier · Holder rewards');
    await expect(page.locator('#launch-list .explore-empty-criteria')).toHaveText('Premier · Holder rewards');
    await page.keyboard.press('Escape');
    await expect(filters).toBeHidden();
    await expect(toggle).toBeFocused();

    await page.locator('#explore-search').fill('Fee premier QA');
    await expect(page.locator('#asset-grid .explore-empty-criteria')).toHaveText('Premier · Holder rewards · Search: Fee premier QA');
    await expect(page.locator('#launch-list .explore-empty-criteria')).toHaveText('Premier · Holder rewards · Search: Fee premier QA');
    await page.locator('#asset-grid .explore-empty-criteria').evaluate(node => node.scrollIntoView({ behavior: 'instant', block: 'center' }));
    const summaryGeometry = await page.locator('#asset-grid .explore-empty-criteria').evaluate(node => {
      const box = node.getBoundingClientRect();
      const navigation = document.querySelector('.mobile-workspace-nav');
      const visibleBottom = navigation && getComputedStyle(navigation).position === 'fixed'
        ? navigation.getBoundingClientRect().top : innerHeight;
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        visibleBottom, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth };
    });
    expect(summaryGeometry.left, JSON.stringify(summaryGeometry)).toBeGreaterThanOrEqual(0);
    expect(summaryGeometry.right, JSON.stringify(summaryGeometry)).toBeLessThanOrEqual(summaryGeometry.viewportWidth);
    expect(summaryGeometry.top, JSON.stringify(summaryGeometry)).toBeGreaterThanOrEqual(0);
    expect(summaryGeometry.bottom, JSON.stringify(summaryGeometry)).toBeLessThanOrEqual(summaryGeometry.visibleBottom);
    expect(summaryGeometry.documentWidth, JSON.stringify(summaryGeometry)).toBeLessThanOrEqual(summaryGeometry.viewportWidth);
    await page.screenshot({ path: `test-results/ux-008-combination-${width}.png` });

    const clear = page.locator('#asset-grid [data-explore-empty-action="clear"]');
    await clear.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(2);
    await expect(page.locator('#explore-promotion-filter')).toHaveValue('all');
    await expect(page.locator('#explore-reward-filter')).toHaveValue('all');
    await expect(page.locator('#explore-search')).toHaveValue('');
    await expect(page.locator('#explore-search')).toBeFocused();

    await page.locator('#explore-search').fill('missing token');
    await expect(page.locator('#asset-grid .empty-state strong')).toHaveText('No token matches your search.');
    await page.locator('#explore-search').fill('Fee premier QA');
    await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(1);
    await expect(page.locator('#asset-grid')).toContainText('Fee premier QA');

    await page.locator('#explore-search').fill('');
    await toggle.click();
    await page.locator('#explore-promotion-filter').selectOption('pro');
    await expect(page.locator('#asset-grid .empty-state strong')).toHaveText('No Pro tokens match this view.');
    await page.locator('#explore-reward-filter').selectOption('holder-fees');
    await expect(page.locator('#asset-grid .empty-state strong')).toHaveText('No tokens match this combination.');
    await page.locator('#explore-promotion-filter').selectOption('all');
    await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(1);
    await expect(page.locator('#asset-grid')).toContainText('Holder rewards QA');
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    for (const view of ['grid', 'table']) {
      await page.locator(`button[data-explore-view="${view}"]`).click();
      await toggle.click();
      await page.locator('#explore-promotion-filter').selectOption('premier');
      await page.locator('#explore-reward-filter').selectOption('holder-fees');
      await page.keyboard.press('Escape');
      await page.locator('#explore-search').fill('Fee premier QA');
      const clearAll = page.locator('#workspace-filter-summary button');
      await expect(clearAll).toBeVisible();
      const box = await clearAll.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.locator('#explore-search'), `First pointer click clears edited Search in ${view}`).toHaveValue('');
      await expect(page.locator('#explore-promotion-filter')).toHaveValue('all');
      await expect(page.locator('#explore-reward-filter')).toHaveValue('all');
      await expect(page.locator('#explore-search')).toBeFocused();
      await expect(page.locator('#workspace-filter-summary')).toBeHidden();
      await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(2);

      await toggle.click();
      await page.locator('#explore-promotion-filter').selectOption('premier');
      await page.locator('#explore-reward-filter').selectOption('holder-fees');
      await page.keyboard.press('Escape');
      await page.locator('#explore-search').fill('Fee premier QA');
      await clearAll.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#explore-search'), `Keyboard Clear all restores focus in ${view}`).toBeFocused();
      await expect(page.locator('#workspace-filter-summary')).toBeHidden();
      await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(2);
    }
  });
}

// UX-008 actual bootstrap with deterministic transport. No app state/DOM/style injection.
function observeActivityControl(original, readiness = {}) {
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
      const ready = location.hash === readiness.hash && element?.isConnected && element.getClientRects().length > 0;
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

async function activityTabTo(page, selector) {
  const original=await page.locator(selector).elementHandle();expect(original).not.toBeNull();
  for(let n=0;n<180;n++){if(await original.evaluate(e=>e===document.activeElement))return original;await page.keyboard.press('Tab');}
  throw Error('Native Tab did not reach '+selector);
}
async function activityArm(page, selector, type, key=null, triggerSelector=null) {
  const original=await page.locator(selector).elementHandle(),trigger=triggerSelector?await page.locator(triggerSelector).elementHandle():null;
  expect(original).not.toBeNull();
  await original.evaluate((element,{source,type,key,trigger})=>{
    let resolve;const state=window.__activityProof={promise:new Promise(r=>resolve=r),events:[],beforeActive:document.activeElement===element};
    const focused=e=>state.events.push({original:e.target===element,activatedControl:e.target===trigger,id:e.target.id,tag:e.target.tagName});
    document.addEventListener('focusin',focused,true);
    const begin=e=>{
      if(!e.isTrusted||type==='keydown'&&e.key!==key||type==='pointerdown'&&e.target!==trigger)return;
      window.removeEventListener(type,begin,true);state.began=performance.now();
      state.trigger={type:e.type,key:e.key??null,trusted:e.isTrusted,pointerType:e.pointerType??null};
      (new Function('return ('+source+')')())(element,{hash:'#explore'}).then(proof=>{
        document.removeEventListener('focusin',focused,true);
        resolve({proof,trigger:state.trigger,beforeActive:state.beforeActive,events:state.events,began:state.began,ended:performance.now(),active:document.activeElement===element,connected:element.isConnected});
      });
    };window.addEventListener(type,begin,true);
  },{source:observeActivityControl.toString(),type,key,trigger});
}
async function activityProof(page, phase, pointer=false) {
  const v=await page.evaluate(()=>window.__activityProof.promise);
  await test.info().attach('activity-native-'+phase,{body:JSON.stringify(v),contentType:'application/json'});
  expect(v.proof.pass,JSON.stringify(v)).toBe(true);expect(v.ended-v.began).toBeLessThanOrEqual(1000);
  expect(v.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);expect(v.active&&v.connected&&v.trigger.trusted).toBe(true);
  // A real pointer activation may focus its captured original button before its handler returns focus to Search.
  // Only these TWO pre-captured nodes are permitted; keyboard target transfers must contain only the original target.
  expect(v.events.some(e=>e.original)).toBe(true);
  expect(v.events.every(e=>e.original||pointer&&e.activatedControl)).toBe(true);
}
async function activityRead(page, locator, label) {
  const read=()=>locator.evaluate(e=>{
    const r=e.getBoundingClientRect(),h=document.querySelector('.topbar'),n=document.querySelector('.mobile-workspace-nav');
    const top=h?.getClientRects().length?Math.max(0,h.getBoundingClientRect().bottom):0,bottom=n?.getClientRects().length?Math.min(innerHeight,n.getBoundingClientRect().top):innerHeight;
    return{label:e.tagName,text:e.textContent,top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,width:r.width,usableTop:top,usableBottom:bottom,
      full:r.top>=top&&r.bottom<=bottom&&r.left>=0&&r.right<=innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  for(let i=0;i<180;i++){const r=await read();if(r.full){expect(r.overflow).toBe(false);return{...r,label,arrows:i};}await page.keyboard.press(r.top<r.usableTop?'ArrowUp':'ArrowDown');await page.evaluate(()=>new Promise(requestAnimationFrame));}
  throw Error('Native Arrow reading could not reveal '+label+': '+JSON.stringify(await read()));
}
async function activityFont(page) {
  const f=await page.evaluate(async()=>{const request='700 14px "Manrope"',faces=await document.fonts.load(request,'Available activity');await document.fonts.ready;return{request,available:document.fonts.check(request,'Available activity'),faces:faces.map(f=>({family:f.family,weight:f.weight,status:f.status,style:f.style}))};});
  await test.info().attach('activity-loaded-font',{body:JSON.stringify(f),contentType:'application/json'});
  expect(f.available&&f.faces.length>0).toBe(true);
  expect(f.faces.some(f=>{const weights=f.weight==='bold'?[700]:f.weight.split(/\s+/).map(Number);return f.family.replaceAll('"','').replaceAll("'",'')==='Manrope'&&f.status==='loaded'&&f.style==='normal'&&(weights.length===1?weights[0]===700:weights.length===2&&weights[0]<=700&&weights[1]>=700);})).toBe(true);
}
async function activityFixture(page,width,kind) {
  const origin=new URL(test.info().project.use.baseURL).origin,f={api:[],rpc:[],rpcUnavailable:[],activity:[],forbidden:[],errors:[],failed:[],qualification:'Entire API/RPC launch/mint/activity payloads are synthetic read-only Devnet fixtures; no on-chain, receipt, wallet or financial proof.'};
  const mintBytes=Buffer.alloc(82);mintBytes.writeBigUInt64LE(1_000_000n,36);mintBytes[44]=6;mintBytes[45]=1;
  const mintAccount={data:[mintBytes.toString('base64'),'base64'],owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',executable:false,lamports:1,rentEpoch:0};
  page.on('pageerror',e=>f.errors.push(e.message));page.on('requestfailed',q=>f.failed.push({url:q.url(),method:q.method(),error:q.failure()?.errorText}));
  await page.setViewportSize({width,height:width<700?844:900});
  await page.route('**/*',async route=>{
    const q=route.request(),u=new URL(q.url()),method=q.method();
    if(u.origin!==origin){if(method==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return route.continue();f.forbidden.push({url:q.url(),method});return route.abort();}
    if(u.pathname==='/api/solana/rpc'){
      let payload;try{payload=q.postDataJSON();}catch{}const calls=Array.isArray(payload)?payload:[payload];
      const largestAllowed=x=>x?.method==='getTokenLargestAccounts'&&JSON.stringify(x.params)===JSON.stringify([x.params?.[0],{commitment:'confirmed'}])&&[premierMint,holderMint].includes(x.params?.[0]);
      if(method!=='POST'||!calls.length||!calls.every(x=>x&&(['getSlot','getGenesisHash','getAccountInfo','getMultipleAccounts'].includes(x.method)||largestAllowed(x)))){f.forbidden.push({url:q.url(),method,payload});return route.fulfill({status:403,json:{error:'Only read RPC'}});}
      f.rpc.push(...calls);const account=address=>[premierMint,holderMint].includes(address)?mintAccount:null;
      const rows=calls.map(x=>{if(largestAllowed(x)){const response={jsonrpc:'2.0',id:x.id,error:{code:-32004,message:'Synthetic Devnet holder sample unavailable'}};f.rpcUnavailable.push({url:q.url(),method,payload:x,response});return response;}return({jsonrpc:'2.0',id:x.id,result:x.method==='getSlot'?100:x.method==='getGenesisHash'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG':{context:{slot:100},value:x.method==='getMultipleAccounts'?(x.params?.[0]||[]).map(account):account(x.params?.[0])}});});
      return route.fulfill({json:Array.isArray(payload)?rows:rows[0]});
    }
    if(!['GET','HEAD','OPTIONS'].includes(method)){f.forbidden.push({url:q.url(),method});return route.fulfill({status:403,json:{error:'No writes'}});}
    if(!u.pathname.startsWith('/api/'))return route.continue();f.api.push({url:q.url(),path:u.pathname,method});
    if(u.pathname==='/api/fee-policy')return route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}});
    if(u.pathname==='/api/launches')return route.fulfill({json:launches});
    if(u.pathname==='/api/pump/explore')return route.fulfill({json:{items:launches.map(r=>({mint:r.mint,name:r.name,symbol:r.symbol})),fetchedAt:new Date().toISOString()}});
    if(/^\/api\/tokens\/[^/]+\/market-activity$/.test(u.pathname)){
      const mint=decodeURIComponent(u.pathname.split('/')[3]),incomplete=mint===premierMint;
      const one={volumeSol:0,tradeCount:incomplete&&kind==='missing'?null:0,traderCount:0,coverage:incomplete&&kind==='partial'?'partial':'complete'};
      const body={mint,cluster:'devnet',observedAt:new Date().toISOString(),observedCoverage:'complete',coverage:'complete',volume24hSol:3,tradeCount24h:3,buyCount24h:2,sellCount24h:1,recentTrades:[],
        activityWindows:{'1h':one,'6h':{volumeSol:0,tradeCount:0,traderCount:0,coverage:'complete'},'24h':{volumeSol:3,tradeCount:3,traderCount:3,coverage:'complete'}}};
      f.activity.push({url:q.url(),body});return route.fulfill({json:body});
    }
    if(u.pathname==='/api/rewards/automatic')return route.fulfill({json:{status:'unavailable',reason:'Offline activity fixture',schedules:[],serverTime:'2026-10-23T00:00:00.000Z'}});
    return route.fulfill({status:503,json:{error:'Offline activity supporting service'}});
  });return f;
}
async function activityMinimum(page,value) {
  const toggle=page.locator('#explore-filter-toggle');await toggle.click();
  await page.locator('#explore-min-trades').fill(String(value));await page.keyboard.press('Escape');
  await expect(page.locator('#explore-filter-popover')).toBeHidden();await expect(toggle).toBeFocused();
}
async function activityPointerPoint(page, selector, info) {
  const original = await page.locator(selector).elementHandle();
  expect(original).not.toBeNull();
  try {
    const result = await original.evaluate(element => new Promise(resolve => {
      const began = performance.now(); let previous = null, stationaryAt = null, frame, timer;
      const finish = value => { cancelAnimationFrame(frame); clearTimeout(timer); resolve(value); };
      const tick = () => {
        const now = performance.now(), box = element.getBoundingClientRect();
        const x = box.left + box.width / 2, y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        const ready = element.isConnected && document.activeElement === document.querySelector('#explore-search')
          && box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth
          && box.top >= 0 && box.bottom <= innerHeight && (hit === element || element.contains(hit));
        const position = JSON.stringify([box.left, box.top, box.width, box.height, scrollX, scrollY]);
        if (ready) { if (previous !== position || stationaryAt === null) stationaryAt = now; }
        else stationaryAt = null;
        previous = position;
        if (now - began > 1000) return finish({ pass:false, ready, elapsed:now-began });
        if (ready && now - stationaryAt >= 100) return finish({ pass:true, x, y, stationaryMs:now-stationaryAt, elapsed:now-began });
        frame = requestAnimationFrame(tick);
      };
      timer = setTimeout(() => finish({ pass:false, elapsed:performance.now()-began }), 1000);
      frame = requestAnimationFrame(tick);
    }));
    await info.attach('activity-original-pointer-point',{body:JSON.stringify(result),contentType:'application/json'});
    expect(result.pass,JSON.stringify(result)).toBe(true);
    expect(result.stationaryMs).toBeGreaterThanOrEqual(100);
    expect(result.elapsed).toBeLessThanOrEqual(1000);
    return result;
  } finally { await original.dispose(); }
}
for(const width of[360,390,1440])test.describe(`activity viewport${width}`,()=>{
  test.use({hasTouch:width<700});
  for(const view of['grid','table'])for(const recovery of['pointer','Enter'])test(`UX-008 available activity ${view} first ${recovery} Clear at${width}px`,async({page},info)=>{
    test.setTimeout(30000);const kind=view==='grid'?'missing':'partial',f=await activityFixture(page,width,kind),reading=[];
    const root=view==='grid'?'#asset-grid':'#launch-list',rows=view==='grid'?root+' .explore-launch-card':root+' .scanner-row';
    try{
      await page.goto('/#explore');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await activityFont(page);
      await expect(page.locator(rows)).toHaveCount(2);await expect.poll(()=>f.activity.length).toBeGreaterThanOrEqual(2);
      await page.locator(`button[data-explore-view="${view}"]`).click();
      await page.locator('[data-explore-window="6h"]').click();await activityMinimum(page,1);
      await expect(page.locator(root+' .empty-state strong')).toHaveText('No launch meets these trade-activity minimums.');
      await page.locator('[data-explore-window="24h"]').click();await expect(page.locator(rows)).toHaveCount(2);
      await page.locator('[data-explore-window="1h"]').click();
      await expect(page.locator(root+' .empty-state strong')).toHaveText('Available activity data cannot confirm matches.');
      await activityTabTo(page,'#explore-search');await page.keyboard.type('QA');
      await expect(page.locator(root+' .explore-empty-criteria')).toHaveText('Minimum trades: 1 · Search: QA');
      await expect(page.locator(root+' .empty-state span').first()).toContainText('Some 1h activity data is unavailable or incomplete. Search and active filters apply together.');
      // Native reading from an actual button owner; Arrow keys are not sent into the Search text editor.
      const emptyClear=root+' [data-explore-empty-action="clear"]';await activityTabTo(page,emptyClear);
      for(const [selector,label] of [[root+' .empty-state strong','headline'],[root+' .empty-state span','detail'],[root+' .explore-empty-criteria','criteria'],['#explore-activity-coverage','coverage']])reading.push(await activityRead(page,page.locator(selector).first(),label));
      await page.screenshot({path:info.outputPath(`activity-${view}-${recovery}-${width}.png`)});
      const clear=recovery==='pointer'?'#workspace-filter-summary button':emptyClear;
      await activityTabTo(page,clear);await page.keyboard.press('Shift+Tab');
      await activityArm(page,clear,'keydown','Tab');await page.keyboard.press('Tab');await activityProof(page,'clear-control');
      expect((await page.locator(clear).boundingBox()).height).toBeGreaterThanOrEqual(44);
      if(recovery==='pointer'){
        // Edited Search remains focused immediately before the FIRST real pointer/touch activation.
        await activityTabTo(page,'#explore-search');await page.keyboard.press('Control+A');await page.keyboard.type('QA');await expect(page.locator('#explore-search')).toBeFocused();
        // Observe native Search scrolling settle; never aim at stale coordinates
        // or scroll/focus the target on behalf of the application.
        const point=await activityPointerPoint(page,clear,info);
        await activityArm(page,'#explore-search','pointerdown',null,clear);
        if(width<700)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
        await activityProof(page,'first-pointer-search',true);
      }else{
        await activityArm(page,'#explore-search','keydown','Enter',clear);await page.keyboard.press('Enter');await activityProof(page,'first-enter-search');
      }
      await expect(page.locator('#explore-search')).toHaveValue('');await expect(page.locator('#explore-search')).toBeFocused();
      await expect(page.locator('#explore-min-trades')).toHaveValue('');await expect(page.locator('#explore-promotion-filter')).toHaveValue('all');await expect(page.locator('#explore-reward-filter')).toHaveValue('all');
      await expect(page.locator('[data-explore-window="24h"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator(rows)).toHaveCount(2);
      await expect(page.locator('#workspace-filter-summary')).toBeHidden();await expect(page).toHaveURL(/#explore$/);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect(f.forbidden).toEqual([]);expect(f.errors).toEqual([]);expect(f.failed).toEqual([]);
      await info.attach('activity-complete-journey',{body:JSON.stringify({width,view,recovery,kind,reading,states:['6h-complete-zero','24h-complete-positive','1h-'+kind,'query-plus-minimum','first-'+recovery+'-Clear-reset24h-positive'],
        qualification:'Actual application/bootstrap/read-only deterministic mint/activity fixtures; Grid/Table native control states and first real pointer/touch or Enter Clear. Original target captured before every proof; pointer focus may traverse ONLY its separately captured original activated button then original Search. Full1000ms/100ms original-control outline geometry required. Mobile touch is browser-emulated, not physical device/OS; old two legacy JSfocus/forcedsummaryscroll cases retained separately. 5m has no current UI control and is covered in pure state only. No wallet/financial/public or live data outcome.'}),contentType:'application/json'});
    }finally{await info.attach('activity-reads',{body:JSON.stringify(f),contentType:'application/json'});}
  });
});
