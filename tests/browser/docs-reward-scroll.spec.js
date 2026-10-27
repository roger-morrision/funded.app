import{test,expect}from'@playwright/test';import{createHash}from'node:crypto';import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';
const titles={'reward-actions':'Automatic payouts or claims?',claims:'Claiming rewards'};
// Frozen text hash from actual public8d280d7 six-row baseline, not fabricated receipts.
const baselineRows='d826ea3ec96555cd5bc305e3874a489743f471ee5cdc581a79ab64719c406a4b';
for(const width of[360,390,1440])test(`FQA-028 Docs comparison native keyboard and touch at ${width}px (offline API)`,async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:width===1440?900:844});const errors=[],writes=[],observations=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.abort());await page.route('**/api/**',r=>{const q=r.request();if(!['GET','HEAD','OPTIONS'].includes(q.method())){if(!(new URL(q.url()).pathname==='/api/solana/rpc'&&['getSlot','getAccountInfo','getMultipleAccounts'].includes(q.postDataJSON()?.method)))writes.push(q.url());return r.abort()}return new URL(q.url()).pathname==='/api/fee-policy'?r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}):r.fulfill({status:503,json:{error:'Offline Docs fixture'}})});
 const article=page.locator('#docs-guide-article'),wrap=article.locator('.reward-actions-scroll'),help=article.locator('#reward-actions-scroll-help');
 const geometry=()=>wrap.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),o=parseFloat(s.outlineWidth)+Math.max(0,parseFloat(s.outlineOffset)),h=document.querySelector('.topbar').getBoundingClientRect(),n=document.querySelector('.mobile-workspace-nav');return{client:e.clientWidth,scroll:e.scrollWidth,left:e.scrollLeft,top:e.scrollTop,height:r.height,article:e.closest('article').getBoundingClientRect().width,layout:document.querySelector('.docs-guide-layout').getBoundingClientRect().width,fullFocus:r.top-o>=Math.max(0,h.bottom)&&r.bottom+o<=(n?.getClientRects().length?n.getBoundingClientRect().top:innerHeight)&&r.left-o>=0&&r.right+o<=innerWidth,outline:s.outlineStyle,focusVisible:e.matches(':focus-visible'),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}});
 for(const topic of['reward-actions','claims']){
  await page.goto('/#docs/'+topic);await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.evaluate(()=>document.fonts.ready);await expect(article.locator('h1')).toHaveText(titles[topic]);await expect(wrap).toHaveRole('region');await expect(wrap).toHaveAccessibleName('Reward actions comparison');await expect(wrap.getByRole('columnheader')).toHaveText(['Program','Asset','What you do','What must be ready']);await expect(wrap.locator('tbody tr')).toHaveCount(6);
  const rows=await wrap.locator('tbody tr').allTextContents();expect(createHash('sha256').update(JSON.stringify(rows)).digest('hex')).toBe(baselineRows);expect(await wrap.locator('tbody a').evaluateAll(a=>a.map(x=>({name:x.textContent,href:x.getAttribute('href')})))).toEqual([{name:'Creator wallet',href:'#payments'},{name:'Coin holders',href:'#payments/holders'},{name:'X account',href:'#payments'},{name:'Referral network',href:'#referrals'},{name:'Daily bonus',href:'#bonuses'},{name:'Community airdrop',href:'#airdrops'}]);
  let before=await geometry();expect(before.article).toBeLessThanOrEqual(before.layout+1);expect(before.overflow).toBe(false);
  if(width<700){
   await expect(wrap).toHaveAttribute('tabindex','0');await expect(help).toBeVisible();await expect(wrap).toHaveAccessibleDescription(/Left\/Right and Up\/Down arrow keys/);
   // Production topic navigation focuses article; enter scroll region with native Tab.
   await page.locator('.docs-guide-nav').getByRole('button',{name:titles[topic],exact:true}).click();await expect(article).toBeFocused();await page.keyboard.press('Tab');await expect(wrap).toBeFocused();await expect.poll(async()=>(await geometry()).fullFocus).toBe(true);expect((await geometry()).focusVisible).toBe(true);expect((await geometry()).outline).not.toBe('none');observations.push({topic,phase:'native region focus',geometry:await geometry()});await page.screenshot({path:info.outputPath(topic+'-focused.png')});
   await page.keyboard.down('ArrowRight');await expect.poll(async()=>(await geometry()).left).toBeGreaterThan(0);await page.keyboard.up('ArrowRight');for(let i=0;i<25;i++)await page.keyboard.press('ArrowRight',{delay:20});await expect.poll(()=>wrap.evaluate(e=>e.scrollWidth-e.clientWidth-e.scrollLeft)).toBeLessThan(2);expect(await wrap.evaluate(e=>e.querySelector('th:last-child').getBoundingClientRect().right<=e.getBoundingClientRect().right+1)).toBe(true);const right=(await geometry()).left;await page.keyboard.press('ArrowLeft',{delay:100});await expect.poll(async()=>(await geometry()).left).toBeLessThan(right);
   await page.keyboard.press('Tab');await expect(wrap.locator('a').first()).toBeFocused();for(let i=1;i<6;i++)await page.keyboard.press('Tab');await expect(wrap.locator('a').last()).toBeFocused();expect(await wrap.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);await page.keyboard.press('Tab');await expect(article.locator(':scope > .docs-guide-link')).toBeFocused();await page.keyboard.press('Tab');await expect(article.locator('.docs-guide-next button')).toBeFocused();
   await expect.poll(()=>article.locator('.docs-guide-next button').evaluate(e=>{const r=e.getBoundingClientRect(),n=document.querySelector('.mobile-workspace-nav');return r.left>=0&&r.right<=innerWidth&&r.bottom<=n.getBoundingClientRect().top})).toBe(true);
   // Chromium native touch synthesis; no custom pan handler or forced scroll result.
   await wrap.evaluate(e=>{e.scrollLeft=0;e.scrollTop=0});await wrap.scrollIntoViewIfNeeded();const box=await wrap.boundingBox(),session=await page.context().newCDPSession(page);await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});const y=box.y+Math.min(100,box.height/2),start=box.x+box.width-35,end=box.x+35;await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});for(let i=1;i<=6;i++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start+(end-start)*i/6,y}]});await page.waitForTimeout(25)}await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(()=>wrap.evaluate(e=>e.scrollLeft)).toBeGreaterThan(50);await session.detach();
  }else{await expect(wrap).not.toHaveAttribute('tabindex');await expect(help).toBeHidden();await expect(wrap).not.toHaveAttribute('aria-describedby');expect(before.scroll).toBe(before.client);await article.focus();await page.keyboard.press('Tab');await expect(wrap.locator('a').first()).toBeFocused();}
  observations.push({topic,rowsHash:baselineRows,geometry:await geometry(),tree:await wrap.ariaSnapshot()});await page.screenshot({path:info.outputPath(topic+'.png')});
  // Topic-to-topic replacement uses the same shared comparison, with fresh sizing.
  const other=topic==='claims'?'reward-actions':'claims';await page.locator('.docs-guide-nav').getByRole('button',{name:titles[other],exact:true}).click();await expect(article.locator('h1')).toHaveText(titles[other]);await expect(article).toBeFocused();await expect(wrap.locator('tbody tr')).toHaveCount(6);if(width<700)await expect(wrap).toHaveAttribute('tabindex','0');else await expect(wrap).not.toHaveAttribute('tabindex');
 }
 if(width===390){const owner=article.locator('.docs-guide-next button');await owner.focus();await page.setViewportSize({width:1440,height:900});await expect(wrap).not.toHaveAttribute('tabindex');await expect(help).toBeHidden();await expect(owner).toBeFocused();await page.setViewportSize({width:390,height:844});await expect(wrap).toHaveAttribute('tabindex','0');await expect(help).toBeVisible();await expect(page.locator('#open-menu')).toBeFocused();} // Existing8d shell restoresmobile-menu focus at this breakpoint.
 expect(errors).toEqual([]);expect(writes).toEqual([]);await info.attach('docs-comparison',{body:JSON.stringify({width,label:'Actual app/docs and nativekeyboard plus syntheticChromiumtouch; offlineAPI, no wallet/financial operation orphysicaldevice claim',observations,errors,writes},null,2),contentType:'application/json'});
});


// FQA-074 / UX-055: actual bootstrap and native anchor/history journeys, never a wallet action.
function observeHolderRoute(original, readiness = {}) {
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
      const payments = document.querySelector('#payments');
      const ready = location.hash === readiness.hash && element?.isConnected
        && (readiness.holder ? payments?.getClientRects().length && !payments.hidden
          && element.getAttribute('aria-selected') === 'true'
          && !document.querySelector('#rewards-holder')?.hidden : true);
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

async function armHolderRoute(page, selector, hash, trigger) {
  const original = await page.locator(selector).elementHandle(); expect(original).not.toBeNull();
  await original.evaluate((element, { source, hash, trigger }) => {
    let resolve;
    const state = window.__holderRouteProof = { promise: new Promise(r => { resolve = r; }), events: [] };
    const changed = event => state.events.push({ original: event.target === element, id: event.target.id });
    document.addEventListener('focusin', changed, true);
    const begin = event => {
      if (!event.isTrusted || trigger === 'Enter' && event.key !== 'Enter') return;
      for (const name of trigger === 'Enter' ? ['keydown'] : ['popstate', 'hashchange']) window.removeEventListener(name, begin, true);
      state.began = performance.now(); state.trigger = { type: event.type, key: event.key || null, trusted: event.isTrusted };
      (new Function('return (' + source + ')')())(element, { hash, holder: element.id === 'rewards-holder-tab' }).then(proof => {
        document.removeEventListener('focusin', changed, true);
        resolve({ proof, trigger: state.trigger, events: state.events, began: state.began, ended: performance.now(), active: document.activeElement === element, connected: element.isConnected });
      });
    };
    for (const name of trigger === 'Enter' ? ['keydown'] : ['popstate', 'hashchange']) window.addEventListener(name, begin, true);
  }, { source: observeHolderRoute.toString(), hash, trigger });
}
async function holderRouteProof(page, phase) {
  const r = await page.evaluate(() => window.__holderRouteProof.promise);
  await test.info().attach('holder-route-native-' + phase, { body: JSON.stringify(r), contentType: 'application/json' });
  expect(r.proof.pass, JSON.stringify(r)).toBe(true); expect(r.ended - r.began).toBeLessThanOrEqual(1000);
  expect(r.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100); expect(r.active && r.connected).toBe(true);
  expect(r.events.every(e => e.original)).toBe(true); expect(r.trigger.trusted).toBe(true);
}
async function nativeTabToHolderLink(page, selector) {
  const target = page.locator(selector); const original = await target.elementHandle(); expect(original).not.toBeNull();
  for (let n = 0; n < 160; n++) {
    if (await original.evaluate(e => e === document.activeElement)) return original;
    await page.keyboard.press('Tab');
  }
  throw new Error('Native Tab did not reach original ' + selector);
}
async function holderGuideFixture(page, width) {
  const origin = new URL(test.info().project.use.baseURL).origin;
  const mint = 'So11111111111111111111111111111111111111112';
  let state = 'unavailable', gates = [];
  const f = { api: [], rpc: [], forbidden: [], errors: [], failed: [], historyCompleted: 0, schedules: [] };
  page.on('pageerror', error => f.errors.push(error.message));
  page.on('requestfailed', request => f.failed.push({ url: request.url(), method: request.method(), error: request.failure()?.errorText }));
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
  const reads = new Set(['getSlot', 'getAccountInfo', 'getMultipleAccounts', 'getGenesisHash']);
  await page.route('**/*', async route => {
    const q = route.request(), url = new URL(q.url()), method = q.method();
    if (url.origin !== origin) {
      if (method === 'GET' && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
      f.forbidden.push({ origin: url.origin, path: url.pathname, method }); return route.abort();
    }
    if (url.pathname === '/api/solana/rpc') {
      let raw; try { raw = q.postDataJSON(); } catch {}
      const calls = Array.isArray(raw) ? raw : [raw];
      if (method !== 'POST' || !calls.length || !calls.every(x => x && reads.has(x.method))) {
        f.forbidden.push({ path: url.pathname, method, calls }); return route.fulfill({ status: 403, json: { error: 'No unapproved RPC' } });
      }
      f.rpc.push(...calls);
      const results = calls.map(x => ({ jsonrpc: '2.0', id: x.id, result: x.method === 'getSlot' ? 100 : x.method === 'getGenesisHash'
        ? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' : { context: { slot: 100 }, value: x.method === 'getMultipleAccounts' ? (x.params?.[0] || []).map(() => null) : null } }));
      return route.fulfill({ json: Array.isArray(raw) ? results : results[0] });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) { f.forbidden.push({ path: url.pathname, method }); return route.fulfill({ status: 403, json: { error: 'Read-only guide fixture' } }); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    f.api.push({ path: url.pathname, method });
    if (url.pathname === '/api/fee-policy') return route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } });
    if (url.pathname === '/api/launches') return route.fulfill({ json: [{ mint, cluster: 'devnet', symbol: 'GUIDEQA', name: 'Controlled guide identity', onchainVerified: true }] });
    if (url.pathname === '/api/rewards/automatic') {
      if (state === 'loading') await new Promise(resolve => gates.push(resolve));
      // Synthetic transport identity/schedule only. Never a ready, paid or funded outcome.
      const populated = state === 'populated-deferred';
      const schedules = populated ? [{ kind: 'holder', asset: 'SOL', mint, status: 'deferred', periodStart: 1,
        cutoffAt: '2026-10-22T00:00:00.000Z', payoutAt: '2026-10-22T00:01:00.000Z' }] : [];
      const body = { status: state === 'unavailable' ? 'unavailable' : 'degraded', reason: 'Controlled unavailable/deferred guide fixture',
        serverTime: '2026-10-22T00:00:00.000Z', schedules };
      f.schedules.push({ state, body }); return route.fulfill({ json: body });
    }
    if (url.pathname === '/api/evidence/payment-history') {
      await route.fulfill({ status: 503, json: { error: 'History evidence unavailable fixture; no synthetic receipts' } }); f.historyCompleted++; return;
    }
    return route.fulfill({ status: 503, json: { error: 'Offline guide supporting service' } });
  });
  return { f, set: value => { state = value; }, release: value => { state = value; const pending = gates; gates = []; pending.forEach(resolve => resolve()); } };
}
async function loadedGuideFont(page) {
  const font = await page.evaluate(async () => {
    const request = '700 14px "Manrope"', faces = await document.fonts.load(request, 'Coin holders'); await document.fonts.ready;
    return { request, available: document.fonts.check(request, 'Coin holders'), faces: faces.map(f => ({ family: f.family, weight: f.weight, status: f.status })) };
  });
  await test.info().attach('holder-route-font', { body: JSON.stringify(font), contentType: 'application/json' });
  expect(font.available && font.faces.length > 0).toBe(true);
  expect(font.faces.some(f => {
    const weights = f.weight === 'bold' ? [700] : f.weight.split(/\s+/).map(Number);
    const covers700 = weights.length === 1 ? weights[0] === 700 : weights.length === 2 && weights[0] <= 700 && weights[1] >= 700;
    return f.family.replaceAll('"', '').replaceAll("'", '') === 'Manrope' && f.status === 'loaded' && covers700;
  })).toBe(true);
}
async function openGuideNatively(page, topic) {
  const priorHash = new URL(page.url()).hash;
  const aliasEntry = priorHash === '#payments/holders' || priorHash === '#payments/history';
  const originalArticle = aliasEntry ? await page.locator('#docs-guide-article').elementHandle() : null;
  if (aliasEntry) expect(originalArticle).not.toBeNull();
  const inspectEntry = () => originalArticle.evaluate(article => {
    const active = document.activeElement, heading = article.querySelector(':scope > h1');
    const visible = node => Boolean(node?.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
    const rect = article.getBoundingClientRect();
    return { href: location.href, topic: document.querySelector('.docs-guide-nav [aria-current="page"]')?.dataset.docsTopic || null,
      paymentsView: document.getElementById('payments')?.dataset.activeView || null,
      originalArticle: { connected: article.isConnected, same: article === document.getElementById('docs-guide-article'), visible: visible(article),
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } },
      heading: { text: heading?.textContent, connected: Boolean(heading?.isConnected), visible: visible(heading) },
      active: { tag: active?.tagName, id: active?.id, class: typeof active?.className === 'string' ? active.className : null,
        text: active?.textContent?.trim(), connected: Boolean(active?.isConnected), visible: visible(active),
        isOriginalArticle: active === article, isCurrentHeading: active === heading } };
  });
  const beforeEntry = aliasEntry ? await inspectEntry() : null;
  const opener = page.locator('#open-menu');
  if (await opener.isVisible()) {
    await opener.click();
    await expect(opener).toHaveAttribute('aria-expanded', 'true');
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toBeVisible(); await expect(sidebar).toHaveJSProperty('inert', false);
    const more = sidebar.locator('.nav-more');
    if (!(await more.evaluate(element => element.open))) await more.locator('summary').click();
    await more.getByRole('link', { name: 'Docs and help', exact: true }).click();
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
  } else {
    await page.getByRole('button', { name: 'Open help topics', exact: true }).click();
    await page.locator('#help-topics-panel').getByRole('link', { name: 'Open the help guide →', exact: true }).click();
  }
  await expect(page).toHaveURL(/#docs$/);
  if (aliasEntry) {
    try {
      await expect(page.locator('.docs-guide-nav [data-docs-topic="overview"]')).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#docs-guide-article h1')).toHaveText('What is funded.vip?');
      await expect(page.locator('#docs-guide-article')).toBeVisible();
      await expect.poll(async () => {
        const state = await inspectEntry();
        return new URL(state.href).hash === '#docs' && state.topic === 'overview' && state.heading.text === 'What is funded.vip?'
          && state.originalArticle.same && state.originalArticle.connected && state.originalArticle.visible
          && state.active.connected && state.active.visible && (state.active.isOriginalArticle || state.active.isCurrentHeading);
      }).toBe(true);
    } finally {
      const afterEntry = await inspectEntry();
      await test.info().attach(`holder-docs-entry-owner-${topic}-${beforeEntry.paymentsView}`, {
        body: JSON.stringify({ before: beforeEntry, after: afterEntry,
          qualification: 'Read-only intermediate alias-to-default-Docs ownership check. Same stable article or its current heading after default-topic rerender; no original heading claim here. Separate native Back prearms and proves the actual original same-topic h1.' }), contentType: 'application/json' });
    }
  }
  await page.locator(`.docs-guide-nav [data-docs-topic="${topic}"]`).click();
  await expect(page.locator('#docs-guide-article h1')).toHaveText(titles[topic]);
  await expect(page.locator('#docs-guide-article')).toBeFocused();
}
async function assertPublicHolder(page, original = null) {
  await expect(page).toHaveURL(/#payments\/holders$/); await expect(page.locator('#payments')).toBeVisible();
  await expect(page.locator('#payments')).toHaveAttribute('data-active-view', 'holder');
  await expect(page.locator('#rewards-holder-tab')).toHaveAttribute('aria-selected', 'true'); await expect(page.locator('#rewards-holder')).toBeVisible();
  if (original) expect(await original.evaluate(e => e === document.getElementById('rewards-holder-tab') && e.isConnected)).toBe(true);
  await expect(page).toHaveTitle('Rewards · funded.vip');
  if (await page.locator('.mobile-workspace-nav').isVisible()) await expect(page.locator('.mobile-workspace-nav a[href="#payments"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#route-guide')).toBeHidden();
  expect(await page.locator('html').getAttribute('data-connected-wallet') || '').toBe('');
}
for (const width of [360, 390, 1440]) for (const topic of ['reward-actions', 'claims'])
test(`Holder guide native cold warm and traversal ${topic} ${width}`, async ({ page }, info) => {
  test.setTimeout(90000); const fixture = await holderGuideFixture(page, width), f = fixture.f;
  try {
    await page.goto('/#payments'); await page.locator('body.workspace-ready.product-experience-ready').waitFor(); await loadedGuideFont(page);
    await expect(page.locator('#rewards-overview-tab')).toHaveAttribute('aria-selected', 'true');
    const originalHolder = await page.locator('#rewards-holder-tab').elementHandle(), historyBaseline = await page.evaluate(() => history.length), phases = [];
    for (const prior of ['overview', 'creator', 'history']) {
      if (prior !== 'overview') await page.locator(`#rewards-${prior}-tab`).click();
      await expect(page.locator('#payments')).toHaveAttribute('data-active-view', prior);
      await openGuideNatively(page, topic);
      const article = page.locator('#docs-guide-article'), rows = await article.locator('.reward-actions-scroll tbody tr').allTextContents();
      expect(createHash('sha256').update(JSON.stringify(rows)).digest('hex')).toBe(baselineRows);
      await expect(article.locator('.docs-guide-link')).toHaveAttribute('href', '#payments');
      // A generic Open Rewards link must retain the current ordinary tab state.
      if (prior !== 'overview') {
        await nativeTabToHolderLink(page, '#docs-guide-article > .docs-guide-link'); await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#payments$/); await expect(page.locator('#payments')).toHaveAttribute('data-active-view', prior);
        await openGuideNatively(page, topic);
      }
      await nativeTabToHolderLink(page, '#docs-guide-article .reward-actions-scroll a[href="#payments/holders"]');
      await armHolderRoute(page, '#rewards-holder-tab', '#payments/holders', 'Enter'); await page.keyboard.press('Enter');
      await holderRouteProof(page, `${topic}-${prior}-entry`); await assertPublicHolder(page, originalHolder);
      const enteredHistory = await page.evaluate(() => history.length);
      await armHolderRoute(page, '#docs-guide-article h1', '#docs/' + topic, 'traversal'); await page.goBack();
      await holderRouteProof(page, `${topic}-${prior}-back`); await expect(article.locator('h1')).toHaveText(titles[topic]);
      await armHolderRoute(page, '#rewards-holder-tab', '#payments/holders', 'traversal'); await page.goForward();
      await holderRouteProof(page, `${topic}-${prior}-forward`); await assertPublicHolder(page, originalHolder);
      expect(await page.evaluate(() => history.length)).toBe(enteredHistory);
      phases.push({ prior, topic, historyLength: enteredHistory, rowsHash: baselineRows });
    }
    expect(await page.evaluate(() => history.length)).toBeGreaterThan(historyBaseline);
    expect(f.forbidden).toEqual([]); expect(f.errors).toEqual([]); expect(f.failed).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await info.attach('holder-guide-native-phases', { body: JSON.stringify({ phases, qualification: 'Actual bootstrap/native help/topic/Tab/Enter and browser Back/Forward. All program responses controlled unavailable; no wallet or financial action.' }), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath(`holder-guide-${topic}-${width}.png`) });
  } finally { fixture.release('unavailable'); await info.attach('holder-guide-reads', { body: JSON.stringify(f), contentType: 'application/json' }); }
});

for (const width of [360, 390, 1440]) test(`Holder direct reload program states and same-location ownership ${width}`, async ({ page }, info) => {
  test.setTimeout(90000); const fixture = await holderGuideFixture(page, width), f = fixture.f, states = [];
  try {
    const loadingBegan = Date.now();
    fixture.set('loading'); await page.goto('/#payments/holders'); await page.locator('body.workspace-ready.product-experience-ready').waitFor();
    try {
      await assertPublicHolder(page);
      await expect.poll(() => f.api.some(x => x.path === '/api/rewards/automatic')).toBe(true);
      expect(f.schedules).toEqual([]); expect(f.failed).toEqual([]);
      await expect(page.locator('#rewards-holder .preview-chip')).toBeVisible();
      await expect(page.locator('#rewards-holder .preview-chip')).toHaveText('Checking service…');
      await expect(page.locator('#rewards-holder [data-auto-status]')).toBeVisible();
      await expect(page.locator('#rewards-holder [data-auto-status]')).toHaveText('Checking distribution availability…');
      await expect(page.locator('#rewards-holder [data-clock]')).toBeHidden();
      await expect(page.locator('#rewards-holder')).not.toContainText('Schedule active');
      expect(Date.now() - loadingBegan).toBeLessThan(15000);
    } finally {
      const panel = await page.locator('#rewards-holder').evaluate(holder => {
        const read = node => ({ text: node?.textContent?.trim() || '', hiddenAttribute: Boolean(node?.hidden),
          visible: Boolean(node?.getClientRects().length && getComputedStyle(node).visibility !== 'hidden') });
        return { holder: read(holder), service: read(holder.querySelector('.preview-chip')),
          status: read(holder.querySelector('[data-auto-status]')), clockLabel: read(holder.querySelector('[data-clock-label]')),
          countdown: read(holder.querySelector('[data-clock]')), hash: location.hash };
      });
      await info.attach('holder-direct-pending-readiness', { body: JSON.stringify({ panel,
        elapsedSinceNavigationMs: Date.now() - loadingBegan,
        automaticRequests: f.api.filter(x => x.path === '/api/rewards/automatic'), preparedAutomaticResponses: f.schedules.slice(), failed: f.failed.slice(),
        qualification: 'Actual GET held by the fixture before any automatic response; visible service/status are loading evidence. Clock label is a baseline DOM observation, not verified empty-schedule, payment or chain evidence. No timer or AbortSignal changed.' }), contentType: 'application/json' });
    }
    fixture.release('unavailable');
    await expect.poll(() => f.schedules.some(x => x.state === 'unavailable')).toBe(true);
    await expect(page.locator('#rewards-holder [data-auto-status]')).toBeVisible();
    await expect(page.locator('#rewards-holder [data-auto-status]')).toHaveText('Controlled unavailable/deferred guide fixture');
    await expect(page.locator('#rewards-holder .preview-chip')).toHaveText('Schedule unavailable');
    await expect(page.locator('#rewards-holder [data-clock-label]')).toHaveText('Not scheduled');
    for (const state of ['unavailable', 'empty', 'populated-deferred']) {
      fixture.set(state); const length = await page.evaluate(() => history.length); await page.reload(); await page.locator('body.workspace-ready.product-experience-ready').waitFor();
      await assertPublicHolder(page); expect(await page.evaluate(() => history.length)).toBe(length);
      await expect(page.locator('#rewards-holder [data-clock-label]')).toHaveText(state === 'populated-deferred' ? 'Reward funding carries forward' : 'Not scheduled');
      await expect(page.locator('#rewards-holder .preview-chip')).toHaveText(state === 'unavailable' ? 'Schedule unavailable' : 'Schedule needs attention');
      await expect(page.locator('#rewards-holder [data-clock]')).toBeHidden();
      await expect(page.locator('#rewards-holder')).not.toContainText('Schedule active');
      if (state === 'populated-deferred') await expect(page.locator('#rewards-holder [data-clock-coin]')).toContainText('GUIDEQA');
      states.push({ state, text: await page.locator('#rewards-holder').innerText() });
    }
    await page.locator('#rewards-history-tab').click(); await expect(page.locator('#payments')).toHaveAttribute('data-active-view', 'history');
    await nativeTabToHolderLink(page, '#payment-history-search'); await page.keyboard.type('RetainedAbC'); await page.keyboard.press('ArrowLeft');
    const search = await page.locator('#payment-history-search').elementHandle();
    const before = await search.evaluate(e => ({ value: e.value, start: e.selectionStart, end: e.selectionEnd, active: document.activeElement === e, hash: location.hash, length: history.length }));
    const completed = f.historyCompleted;
    // Controlled production notification only: no appState/renderer/location/history event is injected.
    await page.evaluate(() => window.dispatchEvent(new Event('funded:route-change')));
    await expect.poll(() => f.historyCompleted).toBeGreaterThan(completed);
    expect(await search.evaluate(e => ({ value: e.value, start: e.selectionStart, end: e.selectionEnd, active: document.activeElement === e, hash: location.hash, length: history.length }))).toEqual(before);
    expect(await search.evaluate(e => e === document.getElementById('payment-history-search') && e.isConnected)).toBe(true);
    await expect(page.locator('#payments')).toHaveAttribute('data-active-view', 'history');
    await page.goto('/#payments/history'); await page.locator('body.workspace-ready.product-experience-ready').waitFor();
    await expect(page.locator('#rewards-history')).toBeVisible(); await expect(page.locator('#rewards-history-tab')).toHaveAttribute('aria-selected', 'true');
    const originalGenericHistory = await page.locator('#rewards-history-tab').elementHandle(); expect(originalGenericHistory).not.toBeNull();
    const inspectGenericHistory = () => originalGenericHistory.evaluate(tab => ({ hash: location.hash, length: history.length, timeOrigin: performance.timeOrigin,
      tab: tab.id, selected: tab.getAttribute('aria-selected'), connected: tab.isConnected, same: tab === document.getElementById('rewards-history-tab') }));
    const genericBefore = await inspectGenericHistory();
    await page.goto('/#payments'); await page.locator('body.workspace-ready.product-experience-ready').waitFor();
    await expect(page).toHaveURL(/#payments$/);
    await expect(page.locator('#rewards-history-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#rewards-history')).toBeVisible();
    const genericHash = await inspectGenericHistory();
    expect(genericHash.timeOrigin).toBe(genericBefore.timeOrigin); expect(genericHash.connected && genericHash.same).toBe(true);
    await page.reload(); await page.locator('body.workspace-ready.product-experience-ready').waitFor();
    await expect(page).toHaveURL(/#payments$/);
    await expect(page.locator('#rewards-overview-tab')).toHaveAttribute('aria-selected', 'true');
    const genericFresh = await page.locator('#rewards-overview-tab').evaluate(tab => ({ hash: location.hash, length: history.length, timeOrigin: performance.timeOrigin,
      tab: tab.id, selected: tab.getAttribute('aria-selected'), connected: tab.isConnected }));
    expect(genericFresh.timeOrigin).not.toBe(genericBefore.timeOrigin); expect(genericFresh.length).toBe(genericHash.length);
    await info.attach('holder-generic-document-lineage', { body: JSON.stringify({ before: genericBefore, afterHash: genericHash, afterReload: genericFresh,
      qualification: 'Actual hash-only History-to-generic navigation retains the same connected original History tab and document. Actual page reload creates a new document and defaults to My rewards; no original node identity is claimed across reload.' }), contentType: 'application/json' });
    await page.goto('/#payments/not-an-implemented-alias'); await page.locator('body.workspace-ready.product-experience-ready').waitFor();
    await expect(page.locator('body')).toHaveClass(/page-route-overview/); await expect(page.locator('#payments')).toBeHidden();
    expect(f.forbidden).toEqual([]); expect(f.errors).toEqual([]); expect(f.failed).toEqual([]);
    await info.attach('holder-direct-states-and-owner', { body: JSON.stringify({ states, before, qualification: 'Native direct/reload routes and supported inputs; same-location refresh is explicitly a controlled funded:route-change handler check, not native history traversal. Deferred synthetic schedule/identity only; no ready or payment receipts.' }), contentType: 'application/json' });
  } finally { fixture.release('unavailable'); await info.attach('holder-direct-reads', { body: JSON.stringify(f), contentType: 'application/json' }); }
});
