import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const mint = '9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
const creator = '9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w';

test('favorite tokens and followed creator wallets persist and can be removed', async ({ page }) => {
  const launch = { mint, cluster: 'devnet', onchainVerified: true, creatorWallet: creator, name: 'Favorite QA token', symbol: 'FAV' };
  await page.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"mocked offline API"}' }));
  await page.route('**/api/fee-policy', route => route.fulfill({ json: { split:PROTOCOL_FEE_SPLIT } }));
  await page.route('**/api/launches', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([launch]) }));
  await page.route('**/api/x/me', route => route.fulfill({ json: { authenticated: false, configured: true } }));

  await page.goto(`/wallet/${creator}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const follow = page.locator('#wallet-follow');
  await expect(follow).toBeVisible();
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');

  await page.goto(`/token/${mint}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('#coin-watch').click();
  await expect(page.locator('#coin-watch')).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/#community');
  await expect(page.locator('#followed-wallet-rows .followed-wallet-row')).toHaveCount(1);
  await expect(page.locator('#followed-wallet-rows')).toContainText('Creator');
  await expect(page.locator('#watchlist-items .saved-token-row')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#followed-wallet-rows .followed-wallet-row')).toHaveCount(1);
  await expect(page.locator('#watchlist-items .saved-token-row')).toHaveCount(1);

  await page.locator('#followed-wallet-rows [data-unfollow-wallet]').click();
  await expect(page.locator('#followed-wallet-rows .followed-wallet-row')).toHaveCount(0);
  await page.locator('#watchlist-items .watch-button').click();
  await expect(page.locator('#watchlist-items .saved-token-row')).toHaveCount(0);
});

function observeFollowing082Control(original, readiness = {}) {
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
function following082Observe(page) {
  const requests=[],pending=new Set();let closing;
  const failed=(row,reason,error)=>{
    row.state=closing?'cancelled':'failed';row.failureReason=reason;row.error=String(error);
    if(closing){row.phase=closing.phase;row.closeReason=closing.reason;}
  };
  page.on('request',request=>{
    const u=new URL(request.url());if(!u.pathname.startsWith('/api/'))return;
    requests.push({request,path:u.pathname,method:request.method(),state:'pending',phase:'journey'});
  });
  page.on('requestfailed',request=>{
    const row=requests.find(r=>r.request===request);if(row)failed(row,'requestfailed',request.failure()?.errorText||'Request failed');
  });
  page.on('response',response=>{
    const row=requests.find(r=>r.request===response.request());if(!row)return;
    row.status=response.status();
    const work=(async()=>{try{
      row.finishedError=await response.finished();
      if(row.finishedError!==null){failed(row,'response-finished-error',row.finishedError);return;}
      row.body=await response.json();row.jsonComplete=true;row.state='complete';
    }catch(error){failed(row,'response-body-error',error);}})();
    pending.add(work);void work.finally(()=>pending.delete(work));
  });
  return {requests,pending,beginClose:reason=>{closing={phase:'owned-context-close',reason};},settle:async({allowCloseCancellation=false}={})=>{
    await expect.poll(()=>pending.size).toBe(0);
    await expect.poll(()=>requests.filter(r=>r.state==='pending').length).toBe(0);
    const unacceptable=requests.filter(row=>!(row.state==='complete'&&row.jsonComplete===true&&row.finishedError===null)
      && !(allowCloseCancellation&&row.state==='cancelled'&&row.phase==='owned-context-close'&&row.closeReason));
    expect(unacceptable.map(({request,...row})=>row),'Expected API reads must have complete JSON and no finished/request failure; JSON503 fixtures are allowed').toEqual([]);
  },snapshot:()=>requests.map(({request,...row})=>row)};
}
async function following082Finish({context,watch,release,info,evidence,name,primary,hasPrimary}) {
  const errors=[];
  const attempt=async(phase,action)=>{try{await action();}catch(error){errors.push({phase,error});}};
  evidence.primaryFailure=hasPrimary?{name:primary?.name,message:String(primary),stack:primary?.stack}:null;
  try{
    if(release)await attempt('release-held-route',release);
    if(watch)await attempt('before-close-complete-responses',()=>watch.settle());
  }finally{
    try{
      await attempt('mark-close-phase',()=>watch?.beginClose(hasPrimary||errors.length?'Cleanup after original journey or verification failure':'Normal cleanup after complete response checks'));
      evidence.contextClose={attempted:true,complete:false};
      await attempt('owned-context-close',async()=>{await context.close();evidence.contextClose.complete=true;});
    }finally{
      if(watch)await attempt('after-close-final-zero',async()=>{
        // Only a journey that already failed may classify close cancellation separately.
        // Such rows never count as completed-body proof or rescue the original failure.
        await watch.settle({allowCloseCancellation:hasPrimary});expect(watch.pending.size).toBe(0);
      });
      evidence.responses=watch?.snapshot();
      evidence.cleanupErrors=errors.map(({phase,error})=>({phase,message:String(error),stack:error.stack}));
      await attempt('evidence-attachment',()=>info.attach(name,{body:JSON.stringify(evidence),contentType:'application/json'}));
    }
  }
  if(hasPrimary){
    if(errors.length){
      const causes=[...(primary?.cause?[primary.cause]:[]),...errors.map(({error})=>error)];
      try{Object.defineProperty(primary,'cause',{value:new AggregateError(causes,'Cleanup diagnostics; original journey failure retained'),configurable:true});}catch{/* Preserve the exact original thrown value even if it cannot hold metadata. */}
    }
    throw primary;
  }
  if(errors.length)throw new AggregateError(errors.map(({error})=>error),'Following verification cleanup or completed-response check failed');
}
async function following082TabTo(page,target) {
  for(let n=0;n<100;n++){
    if(await target.evaluate(e=>document.activeElement===e))return;
    await page.keyboard.press('Tab');
  }
  throw Error('Native Tab did not reach original Followed wallets link');
}
async function following082Focus(page,target,evidence) {
  await following082TabTo(page,target);await page.keyboard.press('Shift+Tab');
  const hash=new URL(page.url()).hash;
  await target.evaluate((element,{source,hash})=>{
    let resolve;window.__following082Proof=new Promise(r=>resolve=r);
    const from=document.activeElement;
    const begin=event=>{
      if(!event.isTrusted||event.key!=='Tab'||event.shiftKey)return;
      from.removeEventListener('keydown',begin,true);const began=performance.now();
      (new Function('return ('+source+')')())(element,{hash}).then(proof=>resolve({proof,began,ended:performance.now(),
        trusted:event.isTrusted,active:element===document.activeElement,connected:element.isConnected}));
    };
    from.addEventListener('keydown',begin,true);
  },{source:observeFollowing082Control.toString(),hash});
  await page.keyboard.press('Tab');const value=await page.evaluate(()=>window.__following082Proof);evidence.push(value);
  expect(value.proof.pass,JSON.stringify(value)).toBe(true);expect(value.ended-value.began).toBeLessThanOrEqual(1000);
  expect(value.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);
  expect(value.trusted&&value.active&&value.connected).toBe(true);
}

// FQA-082 / UX-066: actual bootstrap with controlled same-origin storage and read fixtures.
const following082Key='funded.app.followed.wallets.v1';
const following082Empty='No followed wallets yet. Open a wallet from the Burners, Creators, or Traders tabs in Leaderboard, or from a token page, then choose Follow wallet.';
async function following082Fixture(context,page) {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(key=>{
    sessionStorage.setItem('funded.app.wallet.manual-disconnect','1');
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
    window.__following082={denied:false,writes:[],storageEvents:0};
    Storage.prototype.getItem=function(k){if(k===key&&window.__following082.denied)throw Error('Controlled storage-read failure');return get.call(this,k);};
    Storage.prototype.setItem=function(k,v){if(k===key)window.__following082.writes.push({key:k,value:v});return set.call(this,k,v);};
    window.addEventListener('storage',event=>{if(event.key===key)window.__following082.storageEvents++;});
  },following082Key);
  await context.route('https://**/*',route=>['fonts.googleapis.com','fonts.gstatic.com'].includes(new URL(route.request().url()).hostname)&&route.request().method()==='GET'?route.continue():route.abort());
  await context.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline following fixture'}}));
  await context.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await context.route('**/api/launches',route=>route.fulfill({json:[{mint,cluster:'devnet',onchainVerified:true,creatorWallet:creator,name:'Following fixture',symbol:'FQA'}]}));
  await context.route('**/api/leaderboard/burners',route=>route.fulfill({json:{cluster:'devnet',wallets:[{wallet:creator,burnedTokens:1,receiptCount:1,latestSignature:'3'.repeat(88)}]}}));
  await context.route('**/api/x/me',route=>route.fulfill({json:{authenticated:false,configured:false}}));
  await context.route('**/__fqa082_storage_driver',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Controlled storage fixture</title>'}));
  return {errors};
}
async function following082Ready(page) {
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
}
async function following082Fonts(page) {
  const fonts=await page.evaluate(async()=>{await document.fonts.ready;const f=await document.fonts.load('600 16px "Manrope"','Browse leaderboard');return f.map(x=>({family:x.family,status:x.status}));});
  expect(fonts.length).toBeGreaterThan(0);expect(fonts.every(x=>x.family==='Manrope'&&x.status==='loaded')).toBe(true);return fonts;
}
async function following082Anchor(page,original) {
  const link=page.locator('#followed-wallets [data-followed-wallet-browse]');
  await expect(link).toHaveCount(1);await expect(link).toHaveText('Browse leaderboard');await expect(link).toHaveAttribute('href','#leaderboard');
  expect(await link.evaluate(e=>e.previousElementSibling?.id==='followed-wallet-rows'&&e.nextElementSibling?.id==='followed-wallet-status')).toBe(true);
  if(original)expect(await original.evaluate(e=>e.isConnected&&e===document.querySelector('[data-followed-wallet-browse]'))).toBe(true);
  return link;
}
for(const width of[360,390,1440])test(`FQA-082 stable discovery survives following states at ${width}px`,async({browser},info)=>{
  test.setTimeout(60_000);
  const context=await browser.newContext({viewport:{width,height:width<700?844:900},hasTouch:width<700,isMobile:width<700,locale:'en-US'});
  let watch,primary,hasPrimary=false;const evidence={width,proofs:[],states:[],qualification:'Controlled native cross-page storage events and storage-read-error setup; no live producer, account connection or Follow action.'};
  try {
    const page=await context.newPage(),fixture=await following082Fixture(context,page);watch=following082Observe(page);
    await page.goto('/#community');await following082Ready(page);evidence.fonts=await following082Fonts(page);await watch.settle();
    const link=await following082Anchor(page),original=await link.elementHandle();
    await expect(page.locator('.followed-wallet-empty')).toHaveText(following082Empty);
    await expect(page.locator('#followed-wallet-count')).toHaveText('0 followed');
    await following082Focus(page,original,evidence.proofs);
    const before=watch.requests.length,writes=await page.evaluate(()=>window.__following082.writes);
    const driver=await context.newPage();await driver.goto('/__fqa082_storage_driver');
    const change=rows=>driver.evaluate(({key,rows})=>localStorage.setItem(key,JSON.stringify(rows)),{key:following082Key,rows});
    await change([{address:creator,roles:['creator']}]);
    await expect(page.locator('#followed-wallet-count')).toHaveText('1 followed');await expect(page.locator('#followed-wallet-rows [data-unfollow-wallet]')).toHaveCount(1);
    await following082Anchor(page,original);await expect(link).toBeFocused();evidence.states.push('populated actual storage callback');
    await change([]);await expect(page.locator('#followed-wallet-count')).toHaveText('0 followed');
    await expect(page.locator('.followed-wallet-empty')).toHaveText(following082Empty);await following082Anchor(page,original);await expect(link).toBeFocused();evidence.states.push('empty actual storage callback');
    await change([{address:creator,roles:['trader']}]);await expect(page.locator('#followed-wallet-count')).toHaveText('1 followed');
    await page.evaluate(()=>{window.__following082.denied=true;});
    await change([{address:creator,roles:['creator']}]);await expect(page.locator('#followed-wallet-status')).toHaveText('Saved wallets could not be read. Check browser storage before changing this list.');
    await expect(page.locator('#followed-wallet-count')).toHaveText('1 followed');await expect(page.locator('#followed-wallet-rows [data-unfollow-wallet]')).toHaveCount(1);
    await following082Anchor(page,original);await expect(link).toBeFocused();evidence.states.push('read error retains last-known populated list');
    await page.evaluate(()=>{window.__following082.denied=false;});await change([]);
    await expect(page.locator('#followed-wallet-status')).toHaveText('');await expect(page.locator('#followed-wallet-count')).toHaveText('0 followed');
    await following082Anchor(page,original);await expect(link).toBeFocused();
    expect(await page.evaluate(()=>window.__following082.storageEvents)).toBe(5);
    expect(await page.evaluate(()=>window.__following082.writes)).toEqual(writes);
    expect(watch.requests.length).toBe(before);await watch.settle();
    evidence.geometry=await link.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),rows=e.previousElementSibling.getBoundingClientRect();return {width:r.width,height:r.height,fontSize:parseFloat(s.fontSize),separation:r.top-rows.bottom,overflow:document.documentElement.scrollWidth>innerWidth};});
    expect(evidence.geometry.width).toBeGreaterThanOrEqual(44);expect(evidence.geometry.height).toBeGreaterThanOrEqual(44);expect(evidence.geometry.fontSize).toBeGreaterThanOrEqual(14);expect(evidence.geometry.separation).toBeGreaterThanOrEqual(8);expect(evidence.geometry.overflow).toBe(false);
    evidence.noAddedCallbackRequests=true;evidence.mainPageFollowedStorageWrites=0;evidence.originalNativeAnchorRetained=true;
    expect(fixture.errors).toEqual([]);await page.screenshot({path:info.outputPath('following-states-'+width+'.png')});
  }catch(error){primary=error;hasPrimary=true;}finally{
    await following082Finish({context,watch,info,evidence,name:'following-states-'+width,primary,hasPrimary});
  }
});
for(const width of[390,1440])test(`FQA-082 one activation preserves leaderboard and public wallet Back at ${width}px`,async({browser},info)=>{
  test.setTimeout(60_000);
  const context=await browser.newContext({viewport:{width,height:width<700?844:900},hasTouch:width<700,isMobile:width<700,locale:'en-US'});
  let watch,primary,hasPrimary=false;const evidence={width,proofs:[],qualification:'Mocked read-only Devnet responses and public fixture address; mobile touch emulated. No wallet connection, Follow, Unfollow, signing or payment.'};
  try {
    const page=await context.newPage(),fixture=await following082Fixture(context,page);watch=following082Observe(page);evidence.documents={};
    await page.goto('/#community');await following082Ready(page);evidence.fonts=await following082Fonts(page);await watch.settle();
    await expect(page.locator('#open-menu')).toHaveAttribute('aria-expanded','false');const link=await following082Anchor(page),original=await link.elementHandle();evidence.documents.beforeWallet=await page.evaluate(()=>({timeOrigin:performance.timeOrigin,url:location.href,navigationType:performance.getEntriesByType('navigation')[0]?.type||null}));
    await following082Focus(page,original,evidence.proofs);await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#leaderboard$/);await expect(page.locator('[data-leaderboard-view="burners"]')).toHaveAttribute('aria-selected','true');
    const profile=page.locator('#leaderboard-table a[href="/wallet/'+creator+'"]');await expect(profile).toHaveCount(1);await watch.settle();
    if(width<700)await profile.tap();else await profile.click();await expect(page).toHaveURL(new RegExp('/wallet/'+creator+'$'));await expect(page.locator('#wallet-page')).toBeVisible();await expect(page.locator('#wallet-page-address')).toHaveText(creator);evidence.documents.wallet=await page.evaluate(()=>({timeOrigin:performance.timeOrigin,url:location.href,navigationType:performance.getEntriesByType('navigation')[0]?.type||null}));
    await watch.settle();await page.goBack();await expect(page).toHaveURL(/#leaderboard$/);await expect(page.locator('#leaderboard-table')).toBeVisible();evidence.documents.leaderboardAfterWalletBack=await page.evaluate(()=>({timeOrigin:performance.timeOrigin,url:location.href,navigationType:performance.getEntriesByType('navigation')[0]?.type||null}));
    await page.locator('[data-leaderboard-view="traders"]').click();await expect(page.locator('[data-leaderboard-view="traders"]')).toHaveAttribute('aria-selected','true');await watch.settle();
    await page.goBack();await expect(page).toHaveURL(/#community$/);await following082Ready(page);const returnedLink=await following082Anchor(page),returnedAnchor=await returnedLink.elementHandle();expect(returnedAnchor).toBeTruthy();evidence.documents.returnedCommunity=await page.evaluate(()=>({timeOrigin:performance.timeOrigin,url:location.href,navigationType:performance.getEntriesByType('navigation')[0]?.type||null}));await expect(page.locator('#open-menu')).toHaveAttribute('aria-expanded','false');
    if(width<700)await returnedLink.tap();else await returnedLink.click();await expect(page).toHaveURL(/#leaderboard$/);await expect(page.locator('[data-leaderboard-view="traders"]')).toHaveAttribute('aria-selected','true');await watch.settle();
    await page.goBack();await expect(page).toHaveURL(/#community$/);await following082Anchor(page,returnedAnchor);evidence.documents.afterHashBack=await page.evaluate(()=>({timeOrigin:performance.timeOrigin,url:location.href,navigationType:performance.getEntriesByType('navigation')[0]?.type||null}));expect(evidence.documents.afterHashBack.timeOrigin).toBe(evidence.documents.returnedCommunity.timeOrigin);
    expect(await page.evaluate(()=>window.__following082.writes)).toEqual([]);
    expect(await page.locator('#followed-wallet-count').innerText()).toBe('0 followed');expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    evidence.defaultView='burners';evidence.previousSelection='traders';evidence.samePublicAddress=creator;evidence.nativeKeyboardActivation=true;evidence.pointerActivation=width<700?'emulated touch':'native pointer';evidence.noFollowAction=true;evidence.sameReturnedDocumentAnchorAfterHashBack=true;evidence.fullDocumentRoundtripQualification='Observed document/timeOrigin retained; no assumption that Back always changes timeOrigin or restores old driver handles.';
    expect(fixture.errors).toEqual([]);await page.screenshot({path:info.outputPath('following-back-'+width+'.png')});
  }catch(error){primary=error;hasPrimary=true;}finally{
    await following082Finish({context,watch,info,evidence,name:'following-navigation-'+width,primary,hasPrimary});
  }
});
