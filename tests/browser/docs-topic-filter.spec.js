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

// FQA-075 / UX-056: contextual existing-token listing entry; no financial action.
const listingGuideOriginalParagraphs=["Launch packages: Standard is the free package option; optional Boost, Pro and Premier packages burn the $FUNDED amount displayed in the launch form. Network/account costs still apply.", "Paid listings: adding an existing Devnet mint has a separate quoted $FUNDED burn and mint-verification requirement. A listing receipt is not a creator-fee payment.", "Directory SOL boosts: when enabled, a verified token can buy sponsored placement through a separate Devnet SOL quote. Review the package, duration, exact lamports, destination and unique quote memo. Placement activates only after the matching payment is finalized; signing or submitting alone is insufficient. The current card/checkout shows available packages and prices.", "Sponsored placement, launch tiers and paid listings are different products with different receipts. None changes the coin\u2019s saved fee split, creates referral or Daily bonus revenue by itself, or guarantees trading activity."];
async function listingGuideArm(page,selector,hash) {
  const original=await page.locator(selector).elementHandle();expect(original).not.toBeNull();
  await original.evaluate((element,{source,hash})=>{
    let resolve;const state=window.__listingGuideProof={promise:new Promise(r=>resolve=r),events:[]};
    const focus=e=>state.events.push({original:e.target===element,id:e.target.id,tag:e.target.tagName});
    document.addEventListener('focusin',focus,true);
    const begin=e=>{
      if(!e.isTrusted||e.key!=='Tab')return;
      window.removeEventListener('keydown',begin,true);state.began=performance.now();state.trigger={type:e.type,key:e.key,trusted:e.isTrusted};
      (new Function('return ('+source+')')())(element,{hash}).then(proof=>{
        document.removeEventListener('focusin',focus,true);
        resolve({proof,trigger:state.trigger,events:state.events,began:state.began,ended:performance.now(),active:document.activeElement===element,connected:element.isConnected});
      });
    };window.addEventListener('keydown',begin,true);
  },{source:observeChartGuideControl.toString(),hash});
}
async function listingGuideFocus(page,selector,hash,phase) {
  await chartGuideTabTo(page,selector);await page.keyboard.press('Shift+Tab');
  await listingGuideArm(page,selector,hash);await page.keyboard.press('Tab');
  const v=await page.evaluate(()=>window.__listingGuideProof.promise);
  await test.info().attach('listing-guide-native-'+phase,{body:JSON.stringify(v),contentType:'application/json'});
  expect(v.proof.pass,JSON.stringify(v)).toBe(true);expect(v.ended-v.began).toBeLessThanOrEqual(1000);
  expect(v.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);
  expect(v.active&&v.connected&&v.trigger.trusted).toBe(true);expect(v.events.length).toBeGreaterThan(0);expect(v.events.every(e=>e.original)).toBe(true);
  const box=await page.locator(selector).boundingBox();expect(box).not.toBeNull();expect(box.height).toBeGreaterThanOrEqual(44);
  return {phase,width:box.width,height:box.height};
}
async function listingGuideFixture(page,width) {
  const origin=new URL(test.info().project.use.baseURL).origin;
  const f={phase:'bootstrap',api:[],rpc:[],forbidden:[],errors:[],failed:[],qualification:'Synthetic read-only Devnet transport; listing price/config and public index unavailable. No wallet, mint input, quote, burn, receipt, signing or chain outcome.'};
  page.on('pageerror',e=>f.errors.push(e.message));page.on('requestfailed',q=>f.failed.push({url:q.url(),method:q.method(),error:q.failure()?.errorText}));
  const fixtureReadMarkers=new Map(),fixtureMarkerPrefix='fqa075-'+test.info().testId+'-read-';let nextFixtureRead=0;
  f.explore={phase:'preserved-explore',armedAt:null,beforeBackAt:null,requests:[],instrumentation:{header:'x-fqa075-read-id',prefix:fixtureMarkerPrefix,qualification:'Locally instrumented synthetic503 supporting-read fixture only; no production request identity claim.'}};
  const exploreRequests=new Map(),stamp=()=>({epochMs:performance.timeOrigin+performance.now(),monotonicMs:performance.now()});
  page.on('request',q=>{
    const u=new URL(q.url());
    if(f.phase!=='preserved-explore'||!f.explore.armedAt||f.explore.beforeBackAt||u.origin!==origin||!['/api/pump/explore','/api/launches'].includes(u.pathname))return;
    const row={identity:'075-Explore-'+(f.explore.requests.length+1),phase:f.phase,url:q.url(),path:u.pathname,method:q.method(),requestObservedAt:stamp(),initialTiming:{...q.timing()},responseObservedAt:null,requestfinishedAt:null,bodyCompletedAt:null,status:null,bodyText:null,bodyBytes:null,completionError:null,requestIdentityMatches:null,expectedReadMarker:null,observedReadMarker:null,fixtureMarkerMatches:false,completed:false};
    exploreRequests.set(q,row);f.explore.requests.push(row);
  });
  page.on('response',response=>{
    const q=response.request(),row=exploreRequests.get(q);if(!row)return;
    row.responseObservedAt=stamp();row.status=response.status();row.requestIdentityMatches=response.request()===q&&exploreRequests.get(response.request())===row;
    row.expectedReadMarker=fixtureReadMarkers.get(q)||null;row.observedReadMarker=response.headers()['x-fqa075-read-id']||null;
    row.fixtureMarkerMatches=typeof row.expectedReadMarker==='string'&&row.expectedReadMarker.startsWith(fixtureMarkerPrefix)&&/^[1-9]\d*$/.test(row.expectedReadMarker.slice(fixtureMarkerPrefix.length))&&row.observedReadMarker===row.expectedReadMarker;
  });
  page.on('requestfinished',async q=>{
    const row=exploreRequests.get(q);if(!row)return;row.requestfinishedAt=stamp();
    try{
      const response=await q.response();if(!response)throw new Error('Original completed Request has no Response');
      const error=await response.finished();if(error)throw error;
      const body=await response.body();row.bodyText=body.toString('utf8');row.bodyBytes=body.length;row.finalTiming={...q.timing()};row.bodyCompletedAt=stamp();
      row.requestIdentityMatches=row.requestIdentityMatches===true&&response.request()===q&&exploreRequests.get(q)===row;
      row.completed=row.requestIdentityMatches&&row.fixtureMarkerMatches&&row.finalTiming.responseEnd>=0;
    }catch(error){row.completionError=String(error?.message||error);}
  });
  page.on('requestfailed',q=>{const row=exploreRequests.get(q);if(row){row.failedAt=stamp();row.completionError=q.failure()?.errorText||'Original request failed';}});
  await page.setViewportSize({width,height:width<700?844:900});
  await page.route('**/*',async route=>{
    const q=route.request(),u=new URL(q.url()),method=q.method();
    if(u.origin!==origin){if(method==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return route.continue();f.forbidden.push({url:q.url(),method});return route.abort();}
    if(u.pathname==='/api/solana/rpc'){
      let payload;try{payload=q.postDataJSON();}catch{}const calls=Array.isArray(payload)?payload:[payload];
      if(method!=='POST'||!calls.length||!calls.every(x=>x&&['getSlot','getGenesisHash','getAccountInfo','getMultipleAccounts'].includes(x.method))){f.forbidden.push({url:q.url(),method,payload});return route.fulfill({status:403,json:{error:'Read-only listing guide RPC'}});}
      f.rpc.push(...calls);const rows=calls.map(x=>({jsonrpc:'2.0',id:x.id,result:x.method==='getSlot'?100:x.method==='getGenesisHash'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG':{context:{slot:100},value:x.method==='getMultipleAccounts'?(x.params?.[0]||[]).map(()=>null):null}}));
      return route.fulfill({json:Array.isArray(payload)?rows:rows[0]});
    }
    if(!['GET','HEAD','OPTIONS'].includes(method)||/^\/api\/listings\/(?:mint|quote|prepare|verify|submit|receipt|burn|payment)(?:\/|$)/.test(u.pathname)){
      f.forbidden.push({url:q.url(),method});return route.fulfill({status:403,json:{error:'No listing lookup or financial action'}});
    }
    if(!u.pathname.startsWith('/api/'))return route.continue();
    const status=u.pathname==='/api/fee-policy'||u.pathname==='/api/rewards/automatic'?200:503;
    const body=u.pathname==='/api/fee-policy'?{split:PROTOCOL_FEE_SPLIT}:u.pathname==='/api/rewards/automatic'?{status:'unavailable',reason:'Offline listing guide fixture',schedules:[],serverTime:'2026-10-23T00:00:00.000Z'}:{error:'Offline listing guide supporting service'};
    f.api.push({url:q.url(),path:u.pathname,method,status,body,phase:f.phase});
    if(method==='GET'&&status===503&&['/api/pump/explore','/api/launches'].includes(u.pathname)){
      if(!fixtureReadMarkers.has(q))fixtureReadMarkers.set(q,fixtureMarkerPrefix+(++nextFixtureRead));
      return route.fulfill({status,json:body,headers:{'x-fqa075-read-id':fixtureReadMarkers.get(q),'content-type':'application/json','content-length':'52'}});
    }
    return route.fulfill({status,json:body});
  });return f;
}
async function listingGuideFont(page) {
  const f=await page.evaluate(async()=>{const request='700 14px "Manrope"',faces=await document.fonts.load(request,'List an existing token');await document.fonts.ready;return{request,available:document.fonts.check(request,'List an existing token'),faces:faces.map(f=>({family:f.family,weight:f.weight,status:f.status,style:f.style}))};});
  await test.info().attach('listing-guide-loaded-font',{body:JSON.stringify(f),contentType:'application/json'});
  expect(f.available&&f.faces.length>0).toBe(true);expect(f.faces.some(f=>{const w=f.weight==='bold'?[700]:f.weight.split(/\s+/).map(Number);return f.family.replaceAll('"','').replaceAll("'",'')==='Manrope'&&f.status==='loaded'&&f.style==='normal'&&(w.length===1?w[0]===700:w.length===2&&w[0]<=700&&w[1]>=700);})).toBe(true);
}
async function listingGuideBack(page,c,phase,returns) {
  await page.goBack();await expect(page).toHaveURL(/#docs\/promotions$/);await expect(c.article.locator('h1')).toHaveText('Packages, listings and SOL boosts');
  await expect(c.input).toHaveValue('listings');await expect(c.count).toHaveText('1 of 29 guides');await expect(c.results.locator('[data-docs-topic="promotions"]')).toHaveAttribute('aria-current','page');
  const owner=await page.evaluate(()=>{const e=document.activeElement,docs=document.querySelector('#docs');return{tag:e.tagName,id:e.id,connected:e.isConnected,visible:Boolean(e.getClientRects().length),withinDocs:docs.contains(e),body:e===document.body};});
  returns.push({phase,owner});expect(owner.connected&&owner.visible&&owner.withinDocs&&!owner.body).toBe(true);
}
async function listingGuideDestination(page,info,width,phase,originalMint,reading,f) {
  await expect(page).toHaveURL(/#list$/);await expect(page.locator('body')).toHaveClass(/page-route-list/);
  await expect(page.locator('#list-title')).toHaveText('Get your token listed');await expect(page.locator('#list-mint')).toHaveValue('');
  expect(await originalMint.evaluate(e=>e.isConnected&&e===document.getElementById('list-mint'))).toBe(true);
  await expect(page.locator('#list-mint-help')).toHaveText('Enter a Solana token address to check its format.');
  await expect(page.locator('#list-availability')).toHaveText('$FUNDED price unavailable');await expect(page.locator('#list-live-items')).toHaveText('The verified listing index is unavailable.');
  await expect(page.locator('#list-pay')).toBeHidden();await expect(page.locator('#list-pay')).toBeDisabled();await expect(page.locator('#list-review')).toBeHidden();await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect.poll(()=>f.api.filter(x=>x.path==='/api/listings'&&x.phase===phase).length).toBeGreaterThan(0);
  for(const [selector,label] of [['#list-title','listing-title'],['#list-availability','listing-availability'],['#list-mint-help','empty-mint-help'],['#list-live-items','listing-index-unavailable']])reading.push(await chartGuideRead(page,page.locator(selector),phase+'-'+label));
  await page.screenshot({path:info.outputPath(`listing-guide-${phase}-${width}.png`)});
}
for(const width of[360,390,1440])test.describe(`listing guide viewport${width}`,()=>{
  test.use({hasTouch:width<700});
  test(`Listing guide native entry and Back at${width}px`,async({page},info)=>{
    test.setTimeout(30000);const f=await listingGuideFixture(page,width),reading=[],returns=[],targets=[];
    try{
      await page.goto('/#docs');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await listingGuideFont(page);
      const c=controls(page),originalMint=await page.locator('#list-mint').elementHandle();expect(originalMint).not.toBeNull();
      await expect(c.count).toHaveText('29 guides');const storage=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));
      targets.push(await listingGuideFocus(page,'#docs-guide-search','#docs','search-entry'));await page.keyboard.type('listings');
      await expect(c.count).toHaveText('1 of 29 guides');expect(await visibleIds(c.results)).toEqual(['promotions']);
      targets.push(await listingGuideFocus(page,'[data-docs-topic="promotions"]','#docs','promotions-topic'));await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#docs\/promotions$/);await expect(c.article).toBeFocused();await expect(c.article.locator('h1')).toHaveText('Packages, listings and SOL boosts');
      const body=c.article.locator('.docs-guide-body'),anchor='#docs-guide-article .docs-guide-body a[href="#list"]';
      await expect(body.locator(':scope > p')).toHaveText([...listingGuideOriginalParagraphs.slice(0,2),'List an existing token →',...listingGuideOriginalParagraphs.slice(2)]);
      await expect(page.locator(anchor)).toHaveCount(1);await expect(page.locator(anchor)).toHaveText('List an existing token →');await expect(page.locator(anchor)).toHaveClass('secondary-button');
      expect(await page.locator(anchor).evaluate(e=>e.parentElement.previousElementSibling.querySelector('strong')?.textContent)).toBe('Paid listings:');
      for(const [locator,label] of [[c.article.locator('h1'),'guide-title'],[body.locator(':scope > p').nth(1),'paid-listings'],[page.locator(anchor),'contextual-listing-link'],[body.locator(':scope > p').nth(3),'directory-distinction']])reading.push(await chartGuideRead(page,locator,label));
      targets.push(await listingGuideFocus(page,anchor,'#docs/promotions','listing-link-keyboard'));
      const geometry=await page.locator(anchor).evaluate(e=>{const r=e.getBoundingClientRect(),a=e.closest('article').getBoundingClientRect();return{left:r.left,right:r.right,articleLeft:a.left,articleRight:a.right};});expect(geometry.left>=geometry.articleLeft&&geometry.right<=geometry.articleRight).toBe(true);
      await page.screenshot({path:info.outputPath(`listing-guide-anchor-${width}.png`)});
      expect(await page.evaluate(()=>window.__docsFilterIo)).toEqual([]);f.phase='keyboard-listing';await page.keyboard.press('Enter');
      await listingGuideDestination(page,info,width,f.phase,originalMint,reading,f);await listingGuideBack(page,c,'keyboard-Back',returns);
      targets.push(await listingGuideFocus(page,anchor,'#docs/promotions','listing-link-pointer'));
      const originalLink=await page.locator(anchor).elementHandle();await originalLink.evaluate(e=>{window.__listingGuidePointer=[];for(const type of['pointerdown','click'])e.addEventListener(type,event=>window.__listingGuidePointer.push({type:event.type,trusted:event.isTrusted,original:event.target===e,pointerType:event.pointerType??null}),{once:true});});
      const box=await page.locator(anchor).boundingBox();expect(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=(width<700?844:900)).toBe(true);
      f.phase='pointer-listing';if(width<700)await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);else await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
      await listingGuideDestination(page,info,width,f.phase,originalMint,reading,f);
      const pointer=await page.evaluate(()=>window.__listingGuidePointer);expect(pointer.map(x=>x.type)).toEqual(['pointerdown','click']);expect(pointer.every(x=>x.trusted&&x.original)).toBe(true);expect(pointer[0].pointerType).toBe(width<700?'touch':'mouse');
      await listingGuideBack(page,c,'pointer-Back',returns);
      const explore='#docs-guide-article > .docs-guide-link';targets.push(await listingGuideFocus(page,explore,'#docs/promotions','preserved-explore'));
      await expect(page.locator(explore)).toHaveText('Review verified token promotions →');await expect(page.locator(explore)).toHaveAttribute('href','#explore');
      f.phase='preserved-explore';f.explore.armedAt={epochMs:performance.timeOrigin+performance.now(),monotonicMs:performance.now()};
      await info.attach('listing-guide-Explore-armed',{body:JSON.stringify({phase:f.phase,armedAt:f.explore.armedAt,sourceInventory:{pumpMinimum:1,distinctLaunchesMinimum:2}}),contentType:'application/json'});
      await page.keyboard.press('Enter');await expect(page).toHaveURL(/#explore$/);await expect(page.locator('body')).toHaveClass(/page-route-explore/);await expect(page.locator('#explore')).toBeVisible();
      await expect(page.locator('#asset-grid .onchain-empty > strong')).toBeVisible();await expect(page.locator('#asset-grid .onchain-empty > strong')).toHaveText('Tokens are temporarily unavailable.');
      await expect(page.locator('#asset-grid .onchain-empty > span')).toBeVisible();await expect(page.locator('#asset-grid .onchain-empty > span')).toHaveText('We couldn’t load tokens right now. Please try again.');
      await expect.poll(()=>{
        const rows=f.explore.requests,pump=rows.filter(r=>r.method==='GET'&&r.path==='/api/pump/explore'),launches=rows.filter(r=>r.method==='GET'&&r.path==='/api/launches');
        return pump.length>=1&&launches.length>=2&&new Set(launches.map(r=>r.identity)).size===launches.length&&new Set(rows.map(r=>r.observedReadMarker)).size===rows.length&&rows.every(r=>r.method==='GET'&&r.completed&&r.finalTiming.startTime>=f.explore.armedAt.epochMs&&r.requestfinishedAt&&r.bodyCompletedAt&&r.requestIdentityMatches&&r.status===503&&r.completionError===null&&r.bodyText==='{"error":"Offline listing guide supporting service"}'&&r.bodyBytes===52);
      },{message:'Positive current Explore pump plus two distinct registry reads must finish with original503 bodies before Back'}).toBe(true);
      const exploreOutcome=await page.evaluate(()=>({hash:location.hash,route:document.body.className,title:document.querySelector('#asset-grid .onchain-empty > strong')?.textContent,detail:document.querySelector('#asset-grid .onchain-empty > span')?.textContent}));
      f.explore.beforeBackAt={epochMs:performance.timeOrigin+performance.now(),monotonicMs:performance.now()};
      await info.attach('listing-guide-Explore-completion',{body:JSON.stringify({outcome:exploreOutcome,...f.explore,qualification:'Locally instrumented synthetic503 response-marker fixture; original Request identity map, actual requestfinished AND Response.finished/body completion; original503 bytes. Positive currentphase inventory, no attempted/fulfill/quiet-time substitute. Actual visible unavailable state precedes native Back.'}),contentType:'application/json'});
      f.phase='Explore-Back';await listingGuideBack(page,c,'Explore-Back',returns);
      targets.push(await listingGuideFocus(page,'#docs-guide-article .docs-guide-next button','#docs/promotions','preserved-next-topic'));
      await expect(c.article.locator('.docs-guide-next button')).toHaveText('Coin pages and charts');await page.keyboard.press('Enter');await expect(page).toHaveURL(/#docs\/coin-pages$/);await expect(c.article.locator('h1')).toHaveText('Coin pages and charts');await listingGuideBack(page,c,'next-topic-Back',returns);
      expect(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]))).toBe(storage);expect(await page.evaluate(()=>window.__docsFilterIo)).toEqual([]);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(f.forbidden).toEqual([]);expect(f.errors).toEqual([]);expect(f.failed).toEqual([]);
      await info.attach('listing-guide-complete-journey',{body:JSON.stringify({width,query:'listings',reading,returns,targets,pointer,geometry,qualification:'Actualbootstrap/nativeTab/Enter, firstpointer or browser-emulatedmobiletouch to existinglisting, realBack/Explore/nexttopic. Originalcontrol strict1000ms100ms/wholeoutline proofs; longarticle/listing readableblocks separate. CurrentconnectedBackfocusowner recorded without oldheading identity claim. Original9tests preserved including6legacy qualifications and3acceptedchartguide nativecases. AllAPI/RPC syntheticreadonly/unavailable; no wallet/minttyping/quote/burn/sign/submit/financial/public outcome.'}),contentType:'application/json'});
    }finally{await info.attach('listing-guide-reads',{body:JSON.stringify(f),contentType:'application/json'});}
  });
});

// FQA-075 R2: native guard attempts are classified only from actual passive chronology.
async function listingGuideGuardObserver(page) {
  await page.addInitScript(() => {
    const nodes=new WeakMap(),refs=new Map(),events=[],marks=[];let next=0,latest=Promise.resolve();
    const id=e=>{if(!nodes.has(e)){nodes.set(e,++next);refs.set(next,e);}return nodes.get(e);};
    const owner=e=>({node:id(e),tag:e.tagName,id:e.id,connected:e.isConnected,visible:Boolean(e.getClientRects().length),
      body:e===document.body,article:e===document.querySelector('#docs-guide-article'),withinDocs:Boolean(document.querySelector('#docs')?.contains(e))});
    const record=(type,extra={})=>{const row={type,at:performance.now(),href:location.href,owner:owner(document.activeElement),...extra};events.push(row);return row;};
    document.addEventListener('focusin',e=>record('focusin',{trusted:e.isTrusted,target:owner(e.target)}),true);
    for(const type of['keydown','keyup'])window.addEventListener(type,e=>record(type,{trusted:e.isTrusted,key:e.key,alt:e.altKey}),true);
    window.addEventListener('hashchange',e=>{
      const old=new URL(e.oldURL),url=new URL(e.newURL),row=record('hashchange',{trusted:e.isTrusted,oldURL:e.oldURL,newURL:e.newURL});
      row.qualifyingReturn=e.isTrusted&&old.origin===url.origin&&old.pathname===url.pathname&&old.search===url.search
        &&!/^#docs(?:\/|$)/.test(old.hash)&&url.hash==='#docs/promotions'&&location.href===url.href;
      marks.push(row);
      latest=new Promise(resolve=>requestAnimationFrame(()=>{
        row.firstFrame=performance.now();record('first-natural-frame',{returnAt:row.at});
        requestAnimationFrame(()=>{row.secondFrame=performance.now();record('second-natural-frame',{returnAt:row.at});resolve();});
      }));
    },true);
    window.__listingGuideGuard={
      events,marks,begin:()=>events.length,snapshot:()=>({owner:owner(document.activeElement),events:events.slice()}),
      settled:async()=>{const pending=latest;await pending;if(latest!==pending)await latest;},
      finish(kind,start){
        const rows=events.slice(start),mark=rows.find(e=>e.type==='hashchange'&&e.qualifyingReturn)||null,end=owner(document.activeElement);
        let classification='UNEXERCISED',candidate=null,superseding=null,checks={};
        if(mark){
          if(kind==='nonsteal'){
            if(!mark.owner.body&&mark.owner.connected&&mark.owner.visible)classification='NONBODY-AT-ENTRY';
            else if(mark.owner.body){
              candidate=rows.find(e=>e.type==='focusin'&&e.trusted&&e.at>mark.at&&e.at<mark.firstFrame
                &&e.target.connected&&e.target.visible&&!e.target.body&&!e.target.article
                &&rows.some(k=>k.type==='keydown'&&k.trusted&&k.key==='Tab'&&k.at<=e.at
                  &&rows.some(u=>u.type==='keyup'&&u.trusted&&u.key==='Tab'&&u.at>=e.at&&u.at>=k.at)))||null;
              if(candidate){classification='PENDING-CANCEL-EXERCISED';checks={
                sameOriginalOwner:document.activeElement===refs.get(candidate.target.node)&&candidate.target.node===end.node&&end.connected&&end.visible,
                noLaterArticleFocus:!rows.some(e=>e.type==='focusin'&&e.at>=candidate.at&&e.target.article)};}
            }
          }else if(mark.owner.body){
            superseding=rows.find(e=>e.type==='hashchange'&&e.trusted&&e.at>mark.at&&e.at<mark.firstFrame&&e.href===e.newURL&&e.newURL!==mark.newURL
              &&!/^#docs(?:\/|$)/.test(new URL(e.newURL).hash))||null;
            if(superseding){classification='SUPERSEDED-RETURN-EXERCISED';checks={
              noLaterDocsFocus:!rows.some(e=>e.type==='focusin'&&e.at>=superseding.at&&e.target.withinDocs),
              noHiddenDocsFocus:!rows.some(e=>e.type==='focusin'&&e.at>=superseding.at&&e.target.withinDocs&&!e.target.visible),
              noHiddenDocsOwner:!(end.withinDocs&&!end.visible)};}
          }
        }
        return{kind,classification,mark,candidate,superseding,end,checks,events:rows,
          qualification:classification==='UNEXERCISED'?'Timing branch not observed; static source review only, no runtime branch PASS.':classification==='NONBODY-AT-ENTRY'?'Connected owner at entry avoids scheduling; this does not prove pending cancellation.':'Positive original-node chronology required; one attempt, no timing retry.'};
      }
    };
  });
}
for(const width of[360,390,1440])test.describe(`listing guide guard viewport${width}`,()=>{
  test.use({hasTouch:width<700});
  test(`Docs return guard chronology at${width}px`,async({page},info)=>{
    test.setTimeout(30000);const f=await listingGuideFixture(page,width),observations={width,attempts:[]};
    await listingGuideGuardObserver(page);
    try{
      await page.goto('/#docs/promotions');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await listingGuideFont(page);
      observations.initial=await page.evaluate(()=>window.__listingGuideGuard.snapshot());
      expect(observations.initial.events.filter(e=>e.type==='focusin'&&e.target.article)).toEqual([]);
      await page.reload();await page.locator('body.workspace-ready.product-experience-ready').waitFor();
      observations.reload=await page.evaluate(()=>window.__listingGuideGuard.snapshot());
      expect(observations.reload.events.filter(e=>e.type==='focusin'&&e.target.article)).toEqual([]);
      const c=controls(page),originalArticle=await c.article.elementHandle(),originalInput=await c.input.elementHandle();
      const originalBody=await c.article.innerHTML(),originalHash=new URL(page.url()).hash;
      const storage=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));
      await chartGuideTabTo(page,'#docs-guide-search');await page.keyboard.type('listings');
      await expect(c.input).toHaveValue('listings');await expect(c.input).toBeFocused();await expect(c.count).toHaveText('1 of 29 guides');
      expect(await originalInput.evaluate(e=>e.isConnected&&e===document.activeElement&&e===document.querySelector('#docs-guide-search'))).toBe(true);
      expect(await originalArticle.evaluate(e=>e.isConnected&&e===document.querySelector('#docs-guide-article'))).toBe(true);
      expect(await c.article.innerHTML()).toBe(originalBody);expect(new URL(page.url()).hash).toBe(originalHash);
      const enterListing=async phase=>{
        await chartGuideTabTo(page,'#docs-guide-article .docs-guide-body a[href="#list"]');f.phase=phase;
        await page.keyboard.press('Enter');await expect(page).toHaveURL(/#list$/);await expect(page.locator('#list-mint')).toHaveValue('');
        await expect(page.locator('#list-pay')).toBeHidden();await expect(page.locator('#list-pay')).toBeDisabled();
      };
      await enterListing('guard-nonsteal');let start=await page.evaluate(()=>window.__listingGuideGuard.begin());
      await Promise.all([page.goBack(),page.keyboard.press('Tab')]);await expect(page).toHaveURL(/#docs\/promotions$/);
      await page.evaluate(()=>window.__listingGuideGuard.settled());
      const nonsteal=await page.evaluate(start=>window.__listingGuideGuard.finish('nonsteal',start),start);observations.attempts.push(nonsteal);
      for(const [name,pass]of Object.entries(nonsteal.checks))expect(pass,name+': '+JSON.stringify(nonsteal)).toBe(true);
      await expect(c.input).toHaveValue('listings');await expect(c.count).toHaveText('1 of 29 guides');
      await enterListing('guard-supersession');start=await page.evaluate(()=>window.__listingGuideGuard.begin());
      await Promise.all([page.goBack(),page.keyboard.press('Alt+ArrowRight')]);
      await page.evaluate(()=>window.__listingGuideGuard.settled());
      const supersession=await page.evaluate(start=>window.__listingGuideGuard.finish('supersession',start),start);observations.attempts.push(supersession);
      for(const [name,pass]of Object.entries(supersession.checks))expect(pass,name+': '+JSON.stringify(supersession)).toBe(true);
      expect(['#list','#docs/promotions']).toContain(new URL(page.url()).hash);
      if(new URL(page.url()).hash==='#list')await page.goBack();
      await expect(page).toHaveURL(/#docs\/promotions$/);await expect(c.input).toHaveValue('listings');await expect(c.count).toHaveText('1 of 29 guides');
      expect(await originalArticle.evaluate(e=>e.isConnected&&e===document.querySelector('#docs-guide-article'))).toBe(true);
      expect(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]))).toBe(storage);
      expect(await page.evaluate(()=>window.__docsFilterIo)).toEqual([]);expect(f.forbidden).toEqual([]);expect(f.errors).toEqual([]);expect(f.failed).toEqual([]);
      observations.final=await page.evaluate(()=>window.__listingGuideGuard.snapshot());
      observations.qualification='Native initial/directhash/reload/search and two single concurrent native guard attempts. Branch evidence only when actual qualifying BODY return precedes genuine userfocus/newroute before first natural frame. Timing misses UNEXERCISED/static-only; NONBODY-at-entry distinct. No focus/history/scheduling injection, no claim realdevice/financial/public acceptance.';
      await info.attach('listing-guide-guard-chronology',{body:JSON.stringify(observations),contentType:'application/json'});
    }finally{
      await info.attach('listing-guide-guard-partial',{body:JSON.stringify(observations),contentType:'application/json'});
      await info.attach('listing-guide-guard-reads',{body:JSON.stringify(f),contentType:'application/json'});
    }
  });
});
