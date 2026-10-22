import{test,expect}from'@playwright/test';
import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{window.__docsFilterIo=[];const fetchOriginal=window.fetch;window.fetch=function(...args){if(/docs-reference|docs-topic-filter/.test(new Error().stack||''))window.__docsFilterIo.push({type:'fetch',url:String(args[0])});return fetchOriginal.apply(this,args)};for(const method of['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){if(/docs-reference|docs-topic-filter/.test(new Error().stack||''))window.__docsFilterIo.push({type:'storage',method});return original.apply(this,args)}}});
 await page.route('https://**/*',r=>r.abort());await page.route('**/api/**',r=>new URL(r.request().url()).pathname==='/api/fee-policy'?r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}):r.fulfill({status:503,json:{error:'Offline Docs filter fixture'}}));
});
const controls=page=>({input:page.getByRole('searchbox',{name:'Search guides',exact:true}),clear:page.getByRole('button',{name:'Clear search',exact:true}),results:page.locator('#docs-guide-topic-results'),count:page.locator('.docs-guide-count'),article:page.locator('#docs-guide-article')});
const visibleIds=results=>results.getByRole('button').evaluateAll(nodes=>nodes.map(node=>node.dataset.docsTopic));
async function open(page,width){await page.setViewportSize({width,height:width<700?844:900});await page.goto('/#docs');await page.locator('body.workspace-ready.product-experience-ready').waitFor();const c=controls(page);await expect(c.results.getByRole('button')).toHaveCount(29);await expect(c.count).toHaveText('29 guides');await page.evaluate(()=>document.fonts.ready);return c}
for(const width of[360,390,1440])test(`literal local guide filter preserves article/hash/IME and native history at${width}px`,async({page},info)=>{
 const c=await open(page,width),original=await c.article.innerHTML(),hash=new URL(page.url()).hash;await c.input.focus();await c.input.fill('   ');await expect(c.results.getByRole('button')).toHaveCount(29);await expect(c.count).toHaveText('29 guides');await c.input.fill('  WALLET  ');await expect(c.count).toHaveText('3 of 29 guides');expect(await visibleIds(c.results)).toEqual(['wallet','profile','history']);await expect(c.input).toBeFocused();expect(await c.article.innerHTML()).toBe(original);expect(new URL(page.url()).hash).toBe(hash);
 await page.keyboard.press('ArrowDown');await expect(c.input).toBeFocused();const beforeCaret=await c.input.evaluate(e=>e.selectionStart);await page.keyboard.press('ArrowLeft');expect(await c.input.evaluate(e=>e.selectionStart)).toBe(beforeCaret-1);
 await c.input.fill('fees');await expect(c.count).toHaveText('8 of 29 guides');expect(await visibleIds(c.results)).toEqual(['fees','creator-fees','reward-actions','holders','x-rewards','referrals','daily-bonus','buyback']);
 await c.input.fill('no-such-guide-050');await expect(c.count).toHaveText('No guides found');await expect(c.results.getByRole('button')).toHaveCount(0);await expect(c.results.locator('.docs-guide-no-results')).toBeVisible();await page.keyboard.press('ArrowDown');await expect(c.input).toBeFocused();expect(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]))).not.toContain('no-such-guide-050');expect(await c.article.innerHTML()).toBe(original);expect(new URL(page.url()).hash).toBe(hash);
 await c.clear.click();await expect(c.input).toBeFocused();await expect(c.count).toHaveText('29 guides');await c.input.evaluate(e=>{e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));e.value='fees';e.setSelectionRange(2,2);e.dispatchEvent(new InputEvent('input',{bubbles:true,data:'fees',isComposing:true}))});await expect(c.results.getByRole('button')).toHaveCount(29);await expect(c.count).toHaveText('29 guides');expect(await c.input.evaluate(e=>e.selectionStart)).toBe(2);await c.input.evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'fees'})));await expect(c.count).toHaveText('8 of 29 guides');await expect(c.input).toBeFocused();expect(await c.input.evaluate(e=>e.selectionStart)).toBe(2);expect(await c.article.innerHTML()).toBe(original);expect(await page.evaluate(()=>window.__docsFilterIo)).toEqual([]);
 await c.clear.click();await expect(c.input).toHaveValue('');await expect(c.results.getByRole('button')).toHaveCount(29);await c.input.fill('pending');const pending=c.results.getByRole('button',{name:'Pending, unavailable or failed',exact:true});await pending.focus();await page.keyboard.press('Enter');await expect(c.article.locator('h1')).toHaveText('Pending, unavailable or failed');await expect(c.article).toBeFocused();await expect(page).toHaveURL(/#docs\/troubleshooting$/);const selected=await c.article.innerHTML();await c.input.fill('wallet');await expect(c.count).toHaveText('3 of 29 guides');await expect(pending).toBeHidden();expect(await c.article.innerHTML()).toBe(selected);await c.article.locator('.docs-guide-next button').click();await expect(page).toHaveURL(/#docs\/verification$/);await expect(c.article.locator('h1')).toHaveText('Current availability');await page.goBack();await expect(c.article.locator('h1')).toHaveText('Pending, unavailable or failed');await c.clear.click();await expect(c.input).toBeFocused();await expect(c.count).toHaveText('29 guides');await expect(page).toHaveURL(/#docs\/troubleshooting$/);
 await page.goto('/#docs/launch');await expect(c.article.locator('h1')).toHaveText('Launch a token');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await info.attach('scope',{body:JSON.stringify({width,io:await page.evaluate(()=>window.__docsFilterIo),label:'Actual application/native controls with offlineAPI; IMEcomposition events are modeled, not a physicalIME/device claim. Articlebody/hash/query-storage guards checked; no wallet/financial action.'}),contentType:'application/json'});await page.screenshot({path:info.outputPath(`docs-filter-${width}.png`),fullPage:true});
});
for(const width of[360,390,1440])test(`topic boundary focus stays inside results clip/header/nav at${width}px`,async({page},info)=>{
 const c=await open(page,width);const geometry=button=>button.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),extent=(parseFloat(s.outlineWidth)||0)+Math.max(0,parseFloat(s.outlineOffset)||0),p=e.closest('.docs-guide-topic-results'),clip=p.getBoundingClientRect(),top=clip.top+p.clientTop,bottom=top+p.clientHeight,h=document.querySelector('.topbar'),n=document.querySelector('.mobile-workspace-nav'),vt=h?.getClientRects().length?Math.max(0,h.getBoundingClientRect().bottom):0,vb=n?.getClientRects().length?Math.min(innerHeight,n.getBoundingClientRect().top):innerHeight;return{outline:s.outlineStyle,extent,focusVisible:e.matches(':focus-visible'),full:r.top-extent>=top-1&&r.bottom+extent<=bottom+1&&r.top-extent>=vt-1&&r.bottom+extent<=vb+1&&r.left-extent>=clip.left-1&&r.right+extent<=clip.right+1,height:r.height,resultsHeight:p.clientHeight,scrollTop:p.scrollTop}});
 const first=c.results.getByRole('button').first(),faq=c.results.getByRole('button',{name:'FAQ',exact:true});await first.focus();await page.keyboard.press('ArrowUp');await expect(faq).toBeFocused();await expect.poll(async()=>(await geometry(faq)).full).toBe(true);await page.waitForTimeout(750);const last=await geometry(faq);expect(last.full).toBe(true);expect(last.extent).toBeGreaterThan(0);expect(last.focusVisible).toBe(true);expect(last.height).toBeGreaterThanOrEqual(44);expect(last.resultsHeight).toBeGreaterThanOrEqual(190);await page.keyboard.press('ArrowDown');await expect(first).toBeFocused();await expect.poll(async()=>(await geometry(first)).full).toBe(true);const firstFocus=await geometry(first);await c.input.fill('wallet');await expect(c.count).toHaveText('3 of 29 guides');const filteredLast=c.results.getByRole('button').last();await filteredLast.focus();await expect.poll(async()=>(await geometry(filteredLast)).full).toBe(true);await page.keyboard.press('ArrowDown');await expect(c.results.getByRole('button').first()).toBeFocused();await c.input.fill('pending');await expect(c.count).toHaveText('1 of 29 guides');const only=c.results.getByRole('button');await only.focus();await page.keyboard.press('ArrowUp');await expect(only).toBeFocused();await expect.poll(async()=>(await geometry(only)).full).toBe(true);expect((await c.clear.boundingBox()).height).toBeGreaterThanOrEqual(44);await c.clear.click();await expect(c.input).toBeFocused();const focusGuard=await page.evaluate(async()=>{const results=document.querySelector('#docs-guide-topic-results'),input=document.querySelector('#docs-guide-search'),last=results.querySelector('[data-docs-topic=faq]');last.focus({preventScroll:true});input.focus({preventScroll:true});const before={page:scrollY,topics:results.scrollTop};await new Promise(requestAnimationFrame);return{before,after:{page:scrollY,topics:results.scrollTop},input:document.activeElement===input}});expect(focusGuard.input).toBe(true);expect(focusGuard.after).toEqual(focusGuard.before);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await info.attach('focus-geometry',{body:JSON.stringify({width,last,first:firstFocus,focusGuard,label:'Native settled750ms focus, original computed outline extent retained; no outline shrink.'}),contentType:'application/json'});await page.screenshot({path:info.outputPath(`docs-focus-${width}.png`),fullPage:true});
});


// FQA-065 / UX-048: approved existing guide discovery, native reading and recovery.
const chartGuideCopy={"title": "Coin pages and charts", "sectionHeading": "Read charts and trade history", "paragraphs": ["Choose 5m, 1h, 6h or 24h to view the available confirmed trade observations in that time range. The first and last timestamps describe the observations actually drawn.", "Switch between Price and Market cap, and between SOL and USD. Both views are estimates based on observed token prices; Market cap also uses the verified token supply. USD values apply the current SOL/USD quote to the plotted observations, not a historical USD quote for each trade.", "The chart uses bounded recent observations, so the number of prices drawn can be lower than the Trades count. Read the time range, observation count and source coverage together."], "states": [{"term": "No recent prices", "meaning": "No usable confirmed trade observations were found in the selected range of the available data. Try another range."}, {"term": "One recent price", "meaning": "At least two usable confirmed trade observations are needed to draw a line."}, {"term": "Chart unavailable", "meaning": "Recent trade prices could not be loaded. Use Refresh token data to retry."}, {"term": "When history is partial", "meaning": "Some trade history may be missing. An absent observation does not establish zero activity."}, {"term": "USD or market cap unavailable", "meaning": "The selected view needs a current SOL/USD quote or verified token supply. SOL can show price observations without a USD quote; Price can show them without a supply estimate."}]};
const chartGuideOriginalParagraphs=["Coin pages combine token identity, saved V3 creator-fee split, market observations, trading stage, holders and fee/reward records. Creator wallet, holder and X shares belong to that coin’s launch policy.", "Trades, Fee collections, Allocations and Holders describe different records. Collected fees and allocations are not completed payouts. Missing RPC or index data should be treated as unavailable; a curve estimate does not prove a migrated trading pool."];
function observeChartGuideControl(original, readiness = {}) {
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


async function chartGuideTabTo(page, selector) {
  const original = await page.locator(selector).elementHandle(); expect(original).not.toBeNull();
  for (let n=0;n<180;n++) {
    if (await original.evaluate(e => e === document.activeElement)) return original;
    await page.keyboard.press('Tab');
  }
  throw Error('Native Tab did not reach existing '+selector);
}
async function chartGuideArm(page, selector, hash, key) {
  const original = await page.locator(selector).elementHandle(); expect(original).not.toBeNull();
  await original.evaluate((element, { source, hash, key }) => {
    let resolve;
    const state = window.__chartGuideProof = { promise:new Promise(r => { resolve=r; }), events:[] };
    const focus = event => state.events.push({original:event.target===element,id:event.target.id});
    document.addEventListener('focusin',focus,true);
    const begin = event => {
      if (!event.isTrusted || event.key!==key) return;
      window.removeEventListener('keydown',begin,true);
      state.began=performance.now();state.trigger={type:event.type,key:event.key,trusted:event.isTrusted};
      (new Function('return ('+source+')')())(element,{hash}).then(proof => {
        document.removeEventListener('focusin',focus,true);
        resolve({proof,trigger:state.trigger,events:state.events,began:state.began,ended:performance.now(),
          active:document.activeElement===element,connected:element.isConnected});
      });
    };
    window.addEventListener('keydown',begin,true);
  },{source:observeChartGuideControl.toString(),hash,key});
}
async function chartGuideProof(page, phase) {
  const value=await page.evaluate(()=>window.__chartGuideProof.promise);
  await test.info().attach('chart-guide-native-'+phase,{body:JSON.stringify(value),contentType:'application/json'});
  expect(value.proof.pass,JSON.stringify(value)).toBe(true);expect(value.ended-value.began).toBeLessThanOrEqual(1000);
  expect(value.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);
  expect(value.active&&value.connected&&value.trigger.trusted).toBe(true);expect(value.events.every(e=>e.original)).toBe(true);
}
async function chartGuideFixture(page,width) {
  const origin=new URL(test.info().project.use.baseURL).origin;
  const f={api:[],rpc:[],forbidden:[],errors:[],failed:[]};
  page.on('pageerror',e=>f.errors.push(e.message));page.on('requestfailed',q=>f.failed.push({url:q.url(),method:q.method(),error:q.failure()?.errorText}));
  await page.setViewportSize({width,height:width<700?844:900});
  await page.route('**/*',async route=>{
    const q=route.request(),u=new URL(q.url()),method=q.method();
    if(u.origin!==origin) {
      if(method==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return route.continue();
      f.forbidden.push({url:q.url(),method});return route.abort();
    }
    if(u.pathname==='/api/solana/rpc') {
      let payload;try{payload=q.postDataJSON();}catch{}
      const calls=Array.isArray(payload)?payload:[payload];
      if(method!=='POST'||!calls.length||!calls.every(x=>x&&['getSlot','getGenesisHash','getAccountInfo','getMultipleAccounts'].includes(x.method))) {
        f.forbidden.push({path:u.pathname,method,payload});return route.fulfill({status:403,json:{error:'Read-only chart guide fixture'}});
      }
      f.rpc.push(...calls);
      const rows=calls.map(x=>({jsonrpc:'2.0',id:x.id,result:x.method==='getSlot'?100:x.method==='getGenesisHash'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG':{context:{slot:100},value:x.method==='getMultipleAccounts'?(x.params?.[0]||[]).map(()=>null):null}}));
      return route.fulfill({json:Array.isArray(payload)?rows:rows[0]});
    }
    if(!['GET','HEAD','OPTIONS'].includes(method)){f.forbidden.push({path:u.pathname,method});return route.fulfill({status:403,json:{error:'No writes'}});}
    if(!u.pathname.startsWith('/api/'))return route.continue();
    f.api.push({url:q.url(),path:u.pathname,method});
    if(u.pathname==='/api/fee-policy')return route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}});
    if(u.pathname==='/api/rewards/automatic')return route.fulfill({json:{status:'unavailable',reason:'Offline chart guide fixture',schedules:[],serverTime:'2026-10-22T00:00:00.000Z'}});
    return route.fulfill({status:503,json:{error:'Offline chart guide supporting service'}});
  });
  return f;
}
async function chartGuideFont(page) {
  const font=await page.evaluate(async()=>{
    const request='700 14px "Manrope"',faces=await document.fonts.load(request,'Coin pages and charts');await document.fonts.ready;
    return{request,available:document.fonts.check(request,'Coin pages and charts'),faces:faces.map(f=>({family:f.family,weight:f.weight,status:f.status,style:f.style}))};
  });
  await test.info().attach('chart-guide-loaded-font',{body:JSON.stringify(font),contentType:'application/json'});
  expect(font.available&&font.faces.length>0).toBe(true);
  expect(font.faces.some(f=>{
    const w=f.weight==='bold'?[700]:f.weight.split(/\s+/).map(Number);
    return f.family.replaceAll('"','').replaceAll("'",'')==='Manrope'&&f.status==='loaded'&&f.style==='normal'&&(w.length===1?w[0]===700:w.length===2&&w[0]<=700&&w[1]>=700);
  })).toBe(true);
}
async function chartGuideRead(page,locator,label) {
  const read=()=>locator.evaluate(e=>{
    const r=e.getBoundingClientRect(),h=document.querySelector('.topbar'),n=document.querySelector('.mobile-workspace-nav');
    const top=h?.getClientRects().length?Math.max(0,h.getBoundingClientRect().bottom):0,bottom=n?.getClientRects().length?Math.min(innerHeight,n.getBoundingClientRect().top):innerHeight;
    return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,usableTop:top,usableBottom:bottom,text:e.textContent,
      full:r.top>=top&&r.bottom<=bottom&&r.left>=0&&r.right<=innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  for(let i=0;i<180;i++) {
    const r=await read();if(r.full){expect(r.overflow).toBe(false);return{label,arrows:i,...r};}
    await page.keyboard.press(r.top<r.usableTop?'ArrowUp':'ArrowDown');
    await page.evaluate(()=>new Promise(requestAnimationFrame)); // Observe native reading layout, no fixed delay or forced scroll.
  }
  throw Error('Native Arrow reading did not reveal '+label+': '+JSON.stringify(await read()));
}
for(const width of[360,390,1440])test(`Chart guide discovery reading and recovery at${width}px`,async({page},info)=>{
  test.setTimeout(30000);const f=await chartGuideFixture(page,width),reading=[],queries=[];
  try {
    await page.goto('/#docs');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await chartGuideFont(page);
    const c=controls(page),originalArticle=await c.article.elementHandle();expect(originalArticle).not.toBeNull();
    await expect(c.count).toHaveText('29 guides');const initialArticle=await c.article.innerHTML(),initialHash=new URL(page.url()).hash;
    const storage=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));
    await chartGuideTabTo(page,'.docs-back');await chartGuideArm(page,'#docs-guide-search','#docs','Tab');await page.keyboard.press('Tab');await chartGuideProof(page,'search-entry');
    expect((await c.input.boundingBox()).height).toBeGreaterThanOrEqual(44);
    for(const query of['chart','charts','  CHART  ','coin pages']) {
      await page.keyboard.press('Control+A');await page.keyboard.type(query);
      await expect(c.count).toHaveText('1 of 29 guides');expect(await visibleIds(c.results)).toEqual(['coin-pages']);await expect(c.input).toBeFocused();
      expect(await c.article.innerHTML()).toBe(initialArticle);expect(new URL(page.url()).hash).toBe(initialHash);
      queries.push({query,ids:await visibleIds(c.results),io:await page.evaluate(()=>window.__docsFilterIo)});
    }
    expect(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]))).toBe(storage);
    expect(await page.evaluate(()=>window.__docsFilterIo)).toEqual([]);
    await chartGuideArm(page,'.docs-guide-search-controls button','#docs','Tab');await page.keyboard.press('Tab');await chartGuideProof(page,'clear-before-open');
    expect((await c.clear.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await chartGuideArm(page,'[data-docs-topic="coin-pages"]','#docs','Tab');await page.keyboard.press('Tab');await chartGuideProof(page,'coin-topic');
    expect((await c.results.locator('[data-docs-topic="coin-pages"]').boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Enter');await expect(page).toHaveURL(/#docs\/coin-pages$/);await expect(c.article).toBeFocused();
    expect(await originalArticle.evaluate(e=>e.isConnected&&e===document.getElementById('docs-guide-article'))).toBe(true);
    await expect(c.article.locator('h1')).toHaveText(chartGuideCopy.title);await expect(page).toHaveTitle('Docs · funded.vip');
    const body=c.article.locator('.docs-guide-body'),paragraphs=body.locator(':scope > p'),states=body.locator(':scope > ul > li');
    await expect(paragraphs).toHaveText([...chartGuideOriginalParagraphs,...chartGuideCopy.paragraphs]);
    await expect(body.locator(':scope > h2')).toHaveText(chartGuideCopy.sectionHeading);await expect(states).toHaveCount(5);
    for(let i=0;i<5;i++)await expect(states.nth(i)).toHaveText(chartGuideCopy.states[i].term+' '+chartGuideCopy.states[i].meaning);
    reading.push(await chartGuideRead(page,c.article.locator('h1'),'title'));await page.screenshot({path:info.outputPath(`chart-guide-heading-${width}.png`)});
    reading.push(await chartGuideRead(page,body.locator(':scope > h2'),'section'));
    for(let i=0;i<3;i++)reading.push(await chartGuideRead(page,paragraphs.nth(i+2),'paragraph-'+i));
    for(let i=0;i<5;i++)reading.push(await chartGuideRead(page,states.nth(i),'state-'+chartGuideCopy.states[i].term));
    await page.screenshot({path:info.outputPath(`chart-guide-states-${width}.png`)});
    const selected=await c.article.innerHTML(),length=await page.evaluate(()=>history.length);
    await chartGuideArm(page,'[data-docs-topic="coin-pages"]','#docs/coin-pages','Tab');await page.keyboard.press('Shift+Tab');await chartGuideProof(page,'topic-return');
    await chartGuideArm(page,'.docs-guide-search-controls button','#docs/coin-pages','Tab');await page.keyboard.press('Shift+Tab');await chartGuideProof(page,'clear-return');
    await chartGuideArm(page,'#docs-guide-search','#docs/coin-pages','Enter');await page.keyboard.press('Enter');await chartGuideProof(page,'clear-activation');
    await expect(c.count).toHaveText('29 guides');await expect(c.input).toHaveValue('');expect(await c.article.innerHTML()).toBe(selected);
    expect(new URL(page.url()).hash).toBe('#docs/coin-pages');expect(await page.evaluate(()=>history.length)).toBe(length);
    expect(await page.evaluate(()=>window.__docsFilterIo)).toEqual([]);
    expect(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]))).toBe(storage);
    // Stable adjacent topics: promotions -> coin-pages -> trading. Native buttons, no invented history events.
    await chartGuideTabTo(page,'[data-docs-topic="tier-verification"]');await chartGuideArm(page,'[data-docs-topic="promotions"]','#docs/coin-pages','Tab');await page.keyboard.press('Tab');await chartGuideProof(page,'previous-topic');
    await page.keyboard.press('Enter');await expect(page).toHaveURL(/#docs\/promotions$/);await expect(c.article.locator('h1')).toHaveText('Packages, listings and SOL boosts');
    await chartGuideTabTo(page,'#docs-guide-article > .docs-guide-link');await chartGuideArm(page,'#docs-guide-article .docs-guide-next button','#docs/promotions','Tab');await page.keyboard.press('Tab');await chartGuideProof(page,'next-to-coin');
    await expect(c.article.locator('.docs-guide-next button')).toHaveText(chartGuideCopy.title);await page.keyboard.press('Enter');await expect(page).toHaveURL(/#docs\/coin-pages$/);
    await chartGuideTabTo(page,'#docs-guide-article > .docs-guide-link');await chartGuideArm(page,'#docs-guide-article .docs-guide-next button','#docs/coin-pages','Tab');await page.keyboard.press('Tab');await chartGuideProof(page,'next-to-trading');
    await expect(c.article.locator('.docs-guide-next button')).toHaveText('Buying and selling');await page.keyboard.press('Enter');await expect(page).toHaveURL(/#docs\/trading$/);
    const traversals=await page.evaluate(()=>history.length);await page.goBack();await expect(page).toHaveURL(/#docs\/coin-pages$/);await expect(c.article.locator('h1')).toHaveText(chartGuideCopy.title);
    await page.goForward();await expect(page).toHaveURL(/#docs\/trading$/);await page.goBack();await expect(page).toHaveURL(/#docs\/coin-pages$/);expect(await page.evaluate(()=>history.length)).toBe(traversals);
    const beforeReload=await page.evaluate(()=>performance.timeOrigin);await page.reload();await page.locator('body.workspace-ready.product-experience-ready').waitFor();
    expect(await page.evaluate(()=>performance.timeOrigin)).not.toBe(beforeReload);await expect(page).toHaveURL(/#docs\/coin-pages$/);await expect(c.article.locator('h1')).toHaveText(chartGuideCopy.title);await expect(c.count).toHaveText('29 guides');
    // New document nodes after reload are not labelled original. Capture before this final native Tab only.
    await chartGuideTabTo(page,'[data-docs-topic="faq"]');await chartGuideArm(page,'#docs-guide-article > .docs-guide-link','#docs/coin-pages','Tab');await page.keyboard.press('Tab');await chartGuideProof(page,'find-coin-link');
    await expect(c.article.locator(':scope > .docs-guide-link')).toHaveText('Find a coin →');await expect(c.article.locator(':scope > .docs-guide-link')).toHaveAttribute('href','#explore');await page.keyboard.press('Enter');await expect(page).toHaveURL(/#explore$/);
    await expect(page.locator('body')).toHaveClass(/page-route-explore/);await page.goBack();await expect(page).toHaveURL(/#docs\/coin-pages$/);await expect(c.article.locator('h1')).toHaveText(chartGuideCopy.title);await expect(page).toHaveTitle('Docs · funded.vip');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.evaluate(()=>window.__docsFilterIo)).toEqual([]);
    expect(f.errors).toEqual([]);expect(f.forbidden).toEqual([]);expect(f.failed).toEqual([]);
    await info.attach('chart-guide-complete-journey',{body:JSON.stringify({width,queries,reading,copy:chartGuideCopy,qualification:'Actual bootstrap/native queries/Tab/Enter/Clear/Arrow reading/buttons/BackForward/direct-hash reload/Find a coin recovery. Strict original-node proofs cover controls only; long article context focus/readability does not pretend its whole outline fits one viewport, and no heading identity is claimed across topic rerender/new document. Original six legacy I/O/IME/settled750ms cases separate; no wallet or financial operation.'}),contentType:'application/json'});
  } finally {await info.attach('chart-guide-reads',{body:JSON.stringify(f),contentType:'application/json'});}
});
