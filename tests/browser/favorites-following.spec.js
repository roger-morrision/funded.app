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

// FQA-054 reopened functional scope: deterministic local data, actual bootstrap/native input.
const favoriteMints = [mint, 'So11111111111111111111111111111111111111112', '9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w'];
const favoriteRows = '#watchlist-items > .saved-token-row';
const favoriteIdentity = '#watchlist-items .saved-token-identity > a';
const favoriteView = '#watchlist-items .saved-token-view';
const favoriteRefresh = '#watchlist-sync-retry';
function favoriteGate() {
  let start, release, done;
  return { started:new Promise(resolve => { start = resolve; }), promise:new Promise(resolve => { release = resolve; }),
    completed:new Promise(resolve => { done = resolve; }), start, release, done };
}
async function favoriteFixture(page, width, { account = false, market = false, oldLogo = false, registry = favoriteMints.slice(0,2) } = {}) {
  const f = { identity:account ? '123' : 'guest', lists:{ '123':favoriteMints.slice(0,2), '456':favoriteMints.slice(0,2) },
    registry:registry.map((mint,index) => ({ mint, cluster:'devnet', onchainVerified:true, creatorWallet:creator,
      name:'Controlled favorite ' + index, symbol:'F' + index, imageUri:oldLogo ? 'https://metadata.funded.vip/devnet-images/' + mint : null })),
    reads:[], forbidden:[], errors:[], reserveGates:[], logoGates:[], allGates:[], initialReleased:false, oldLogoReleased:false,
    market, marketVersion:0, quote:100 };
  const metadataOrigin = 'https://metadata.funded.vip';
  const mintBytes = Buffer.alloc(82); mintBytes.writeBigUInt64LE(1000000000000000n,36); mintBytes[44] = 6; mintBytes[45] = 1;
  const mintInfo = { data:[mintBytes.toString('base64'),'base64'], owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', lamports:1000000, executable:false, rentEpoch:0 };
  let curveKeys = [], curveData = [];
  if (market) {
    const [{ PublicKey },{ PUMP_SDK,bondingCurvePda },{ default:BN }] = await Promise.all([import('@solana/web3.js'),import('@pump-fun/pump-sdk'),import('bn.js')]);
    curveKeys = favoriteMints.map(value => bondingCurvePda(new PublicKey(value)).toBase58());
    for (const quote of ['30000000000','60000000000']) curveData.push({ data:[(await PUMP_SDK.offlinePumpProgram.coder.accounts.encode('bondingCurve',{
      virtualTokenReserves:new BN('1000000000000'),virtualQuoteReserves:new BN(quote),realTokenReserves:new BN('700000000000'),
      realQuoteReserves:new BN('1000000000'),tokenTotalSupply:new BN('1000000000000000'),complete:false,creator:PublicKey.default,
      isMayhemMode:false,isCashbackCoin:false,quoteMint:new PublicKey('So11111111111111111111111111111111111111112'),creatorFeeBps:new BN(0),canEditCreatorFee:false,isHolderReward:false })).toString('base64'),'base64'],
      owner:PUMP_SDK.offlinePumpProgram.programId.toBase58(),lamports:1000000,executable:false,rentEpoch:0 });
  }
  const safeRpc = new Set(['getAccountInfo','getMultipleAccounts','getBalance','getGenesisHash','getSlot','getLatestBlockhash','getBlockHeight',
    'getTokenSupply','getTokenAccountBalance','getMinimumBalanceForRentExemption','getTokenLargestAccounts','getTokenAccountsByOwner','getProgramAccounts']);
  await page.setViewportSize({ width, height:width < 700 ? 844 : 900 });
  page.on('pageerror', error => f.errors.push(error.message));
  await page.addInitScript(({ account, mints }) => {
    if (!sessionStorage.getItem('favorite-functional-seeded')) {
      localStorage.setItem('funded.app.watchlist.guest.v1',JSON.stringify({ mints:account ? [] : mints,importId:'00000000-0000-4000-8000-000000000054',targetAccount:null }));
      sessionStorage.setItem('favorite-functional-seeded','1');
    }
    sessionStorage.setItem('funded.app.wallet.manual-disconnect','1');
  }, { account, mints:favoriteMints.slice(0,2) });
  await page.route('**/*', async route => {
    const request=route.request(),url=new URL(request.url()),method=request.method(),local=url.origin===new URL(test.info().project.use.baseURL).origin;
    if (method==='GET' && (local || url.origin===metadataOrigin) && url.pathname.startsWith('/devnet-images/')) {
      const obsolete=oldLogo && url.origin===metadataOrigin;
      let gate;if (obsolete && !f.oldLogoReleased) { gate=favoriteGate();f.logoGates.push(gate);f.allGates.push(gate);gate.start();await gate.promise; }
      try {
        if (obsolete && f.oldLogoFailure) return await route.abort('failed');
        return await route.fulfill({ contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${obsolete ? '#a11' : '#1a4'}"/></svg>` });
      } finally { gate?.done(); }
    }
    if (!local) {
      if(method==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))return route.continue();
      f.forbidden.push({method,path:url.origin+url.pathname,reason:'external-blocked'});return route.abort();
    }
    if(url.pathname==='/api/solana/rpc') {
      let body;try{body=request.postDataJSON();}catch{}
      const calls=Array.isArray(body)?body:[body];
      if(method!=='POST'||!calls.length||!calls.every(call=>call&&safeRpc.has(call.method))) {
        f.forbidden.push({method,path:url.pathname,methods:calls.map(call=>call?.method),reason:'unknown-or-mutating-rpc'});return route.fulfill({status:403,json:{error:'No mutation allowed'}});
      }
      f.reads.push({path:url.pathname,method,methods:calls.map(call=>call.method),fixture:true});
      const accountFor=address=>market&&favoriteMints.includes(address)?mintInfo:market&&curveKeys.includes(address)?curveData[f.marketVersion]:null;
      const responses=calls.map(call=>{let result;
        if(call.method==='getMultipleAccounts')result={context:{slot:100},value:call.params[0].map(accountFor)};
        else if(call.method==='getAccountInfo')result={context:{slot:100},value:accountFor(call.params[0])};
        else if(call.method==='getGenesisHash')result='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
        else if(call.method==='getSlot')result=100;
        else return {jsonrpc:'2.0',id:call.id,error:{code:-32000,message:'Local read unavailable'}};
        return {jsonrpc:'2.0',id:call.id,result};});
      return route.fulfill({json:Array.isArray(body)?responses:responses[0]});
    }
    if(!['GET','HEAD','OPTIONS'].includes(method)) {f.forbidden.push({method,path:url.pathname,reason:'no-api-writes-admitted'});return route.fulfill({status:403,json:{error:'No API write allowed'}});}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    f.reads.push({path:url.pathname,method,at:Date.now(),account:url.searchParams.get('accountId')});
    if(url.pathname==='/api/fee-policy')return route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}});
    if(url.pathname==='/api/x/me'&&f.identity==='checking')return route.fulfill({status:503,json:{error:'Controlled identity unavailable'}});
    if(url.pathname==='/api/x/me')return route.fulfill({json:f.identity==='guest'?{authenticated:false,configured:true}:{authenticated:true,configured:true,user:{id:f.identity,username:'fixture-only'}}});
    if(url.pathname==='/api/market/sol-usd')return route.fulfill({json:{priceUsd:f.quote}});
    if(url.pathname==='/api/watchlist') {
      const gate=f.watchGate;f.watchGate=undefined;if(gate){gate.start();await gate.promise;}
      const accountId=url.searchParams.get('accountId');try{return await route.fulfill({json:{accountId,csrf:'local-fixture-only',mints:f.lists[accountId]||[]}});}finally{gate?.done();}
    }
    if(url.pathname==='/api/launches') {
      const gate=f.registryGate;f.registryGate=undefined;if(gate){gate.start();await gate.promise;}
      try{return await route.fulfill({json:f.registry});}finally{gate?.done();}
    }
    if(url.pathname==='/api/pump/explore') {
      const gate=f.feedGate;f.feedGate=undefined;if(gate){gate.start();await gate.promise;}
      try{return await route.fulfill({json:{cluster:'devnet',fetchedAt:new Date().toISOString(),items:f.market?favoriteMints.slice(0,2).map((mint,index)=>({mint,name:`Market ${f.marketVersion} token ${index}`,symbol:`M${f.marketVersion}${index}`,createdTimestamp:1,lastTradeTimestamp:1})):[]}});}finally{gate?.done();}
    }
    if(url.pathname==='/api/airdrops/reserves') {
      let gate;if(!f.initialReleased){gate=favoriteGate();f.reserveGates.push(gate);f.allGates.push(gate);gate.start();await gate.promise;}
      try{return await route.fulfill({json:{cluster:'devnet',reserves:[]}});}finally{gate?.done();}
    }
    return route.fulfill({status:503,json:{error:'Controlled unavailable read; no provider forwarded'}});
  });
  f.open=async()=>{
    await page.goto('/#community',{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await expect(page.locator(favoriteIdentity)).toHaveCount(2);await expect.poll(()=>f.reserveGates.length).toBeGreaterThan(0);
    const fonts=await page.evaluate(async()=>{await document.fonts.load('600 14px Manrope');await document.fonts.ready;return[...document.fonts].filter(font=>font.family.includes('Manrope')&&font.status==='loaded').map(font=>({family:font.family,weight:font.weight}));});
    expect(fonts.length).toBeGreaterThan(0);await test.info().attach('actual-fonts',{body:JSON.stringify(fonts),contentType:'application/json'});
  };
  f.releaseInitial=()=>{f.initialReleased=true;f.reserveGates.forEach(gate=>gate.release());};
  f.hold=key=>{expect(f[key]).toBeUndefined();const gate=favoriteGate();f[key]=gate;f.allGates.push(gate);return gate;};
  f.home=async()=>{if(width<700)await page.getByRole('navigation',{name:'Mobile workspace'}).getByRole('link',{name:'Home',exact:true}).click();else await page.locator('#sidebar a[href="#overview"]').first().click();await expect(page).toHaveURL(/#overview$/);};
  f.favorites=async()=>{if(width<700)await page.getByRole('navigation',{name:'Mobile workspace'}).getByRole('link',{name:'Portfolio',exact:true}).click();else await page.locator('#sidebar a[href="#my-launches"]').first().click();await expect(page).toHaveURL(/#my-launches$/);await page.getByRole('navigation',{name:'Portfolio sections'}).getByRole('link',{name:'Favorites',exact:true}).click();await expect(page).toHaveURL(/#community$/);};
  f.registryRefresh=async()=>{const gate=f.hold('registryGate');await f.home();await gate.started;await f.favorites();return gate;};
  f.finish=async info=>{f.initialReleased=true;f.oldLogoReleased=true;f.allGates.forEach(gate=>gate.release());await info.attach('requests-and-guards',{body:JSON.stringify({reads:f.reads,forbidden:f.forbidden,errors:f.errors},null,2),contentType:'application/json'});expect(f.forbidden).toEqual([]);expect(f.errors).toEqual([]);};
  return f;
}
function observeFavoriteFocus(original, readiness = {}) {
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
      const ready = (!readiness.text || element.closest('.saved-token-row')?.textContent.includes(readiness.text))
        && (readiness.count == null || document.querySelector('#watchlist-items').children.length === readiness.count)
        && (!readiness.avatar || window.__favoriteObservation.oldAvatar?.isConnected === false);
      const clear = Boolean(ready && element.isConnected && rect && cornersClear && element === document.activeElement && element.matches(':focus-visible')
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


async function armFavorite(original, readiness = {}) {
  await original.evaluate((element,{source,readiness})=>{
    const row=element.closest('.saved-token-row'),state=window.__favoriteObservation={original:element,row,oldAvatar:row?.querySelector('.portfolio-token-avatar'),began:performance.now(),removed:false,events:[]};
    const mutations=new MutationObserver(records=>{for(const record of records)for(const removed of record.removedNodes)if(removed===element||removed.contains?.(element))state.removed=true;});
    mutations.observe(document.querySelector('#watchlist-items'),{childList:true,subtree:true});
    const changed=event=>state.events.push({at:performance.now(),original:event.target===element,tag:event.target.tagName,id:event.target.id});document.addEventListener('focusin',changed,true);
    const key=event=>state.key={key:event.key,trusted:event.isTrusted,at:performance.now()};document.addEventListener('keydown',key,{capture:true,once:true});
    state.promise=(new Function('return ('+source+')')())(element,readiness).then(proof=>{mutations.disconnect();document.removeEventListener('focusin',changed,true);document.removeEventListener('keydown',key,true);return{proof,key:state.key,events:state.events,removed:state.removed,connected:element.isConnected,active:document.activeElement===element,began:state.began,ended:performance.now()};});
  },{source:observeFavoriteFocus.toString(),readiness});
}
async function favoriteProof(page,info,label,{native=false,retained=true}={}){
  const result=await page.evaluate(()=>window.__favoriteObservation.promise);await info.attach(label,{body:JSON.stringify(result,null,2),contentType:'application/json'});
  expect(result.proof.pass,JSON.stringify(result)).toBe(true);expect(result.ended-result.began).toBeLessThanOrEqual(1000);expect(result.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);expect(result.active&&result.connected).toBe(true);
  if(retained)expect(result.removed).toBe(false);if(native){expect(result.key?.trusted).toBe(true);expect(result.key.key).toBe('Tab');}return result;
}
async function nativeFavorite(page,selector,info,label){
  const original=await page.locator(selector).elementHandle();expect(original).not.toBeNull();await page.locator('#favorites-title').click();let next=false;
  for(let i=0;i<100;i++){
    next=await original.evaluate(element=>{const nodes=[...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')].filter(node=>node.tabIndex>=0&&!node.disabled&&!node.closest('[hidden],[inert]')&&node.getClientRects().length&&getComputedStyle(node).visibility==='visible'),at=nodes.indexOf(document.activeElement);return at>=0&&nodes[at+1]===element;});
    if(next)break;await page.keyboard.press('Tab');
  }
  expect(next).toBe(true);await armFavorite(original);await page.keyboard.press('Tab');await favoriteProof(page,info,label,{native:true});return original;
}
const favoriteCard = (mint=favoriteMints[0])=>`#watchlist-items .saved-token-row[data-mint="${mint}"]`;
async function retainedFavorite(page,original,info,label,release,readiness={}){await armFavorite(original,readiness);release();await favoriteProof(page,info,label);}
async function favoriteImage(page,info,label){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(label+'.png')});}
test.describe('FQA-054 preserved Favorites controls',()=>{
  test.describe.configure({timeout:60000});
  test.afterEach(async({page})=>{await page.close();}); // After all assertions and fixture finalization, before context tracing closure.
  for(const width of[390,1440]){
    for(const role of['identity','view'])test(`ordinary initial reserve completion retains original ${role} and native action at${width}`,async({page},info)=>{
      const f=await favoriteFixture(page,width);try{await f.open();const selector=favoriteCard()+(role==='identity'?' .saved-token-identity > a':' .saved-token-view'),original=await nativeFavorite(page,selector,info,'original-native-'+role);
        const nodes=await original.evaluateHandle(element=>{const row=element.closest('.saved-token-row');return{row,original:element,identity:row.querySelector('.saved-token-identity>a'),view:row.querySelector('.saved-token-view'),actions:[...row.querySelectorAll('.saved-token-actions>button')]};});
        await retainedFavorite(page,original,info,'ordinary-completion-original-'+role,()=>f.releaseInitial(),{avatar:true});
        expect(await nodes.evaluate(s=>s.row.isConnected&&s.original.isConnected&&s.row.querySelector('.saved-token-identity>a')===s.identity&&s.row.querySelector('.saved-token-view')===s.view&&s.actions.every(button=>button.isConnected&&button.closest('.saved-token-row')===s.row))).toBe(true);
        await expect(page.locator('#watch-count')).toHaveText('2 favorites');await favoriteImage(page,info,'ordinary-'+role+'-'+width);
        await page.keyboard.press('Enter');await expect(page).toHaveURL(new RegExp('/token/'+favoriteMints[0]+'$'));await page.goBack();await expect(page).toHaveURL(/#community$/);await expect(page.locator(favoriteIdentity)).toHaveCount(2);
      }finally{await f.finish(info);}
    });
    test(`same-account insertion reorder and removal preserve role identity and fallback at${width}`,async({page},info)=>{
      const f=await favoriteFixture(page,width,{account:true,registry:favoriteMints});try{await f.open();f.releaseInitial();const original=await nativeFavorite(page,favoriteCard()+' .saved-token-view',info,'account-view-entry');
        const row=await original.evaluateHandle(element=>element.closest('.saved-token-row'));const gate=f.hold('watchGate');await page.locator(favoriteRefresh).click();await gate.started;await nativeFavorite(page,favoriteCard()+' .saved-token-view',info,'account-reacquire-before-read');
        await original.evaluate(element=>{
          const measure=target=>{
            const r=target.getBoundingClientRect(),css=getComputedStyle(target),root=getComputedStyle(document.documentElement),edge=(parseFloat(css.outlineWidth)||0)+(parseFloat(css.outlineOffset)||0);
            const bounds={left:0,right:innerWidth,top:0,bottom:innerHeight},clips=[],chrome=[];
            for(const node of document.querySelectorAll('.topbar,.mobile-workspace-nav')){
              if(!node.getClientRects().length)continue;const box=node.getBoundingClientRect();chrome.push({className:node.className,top:box.top,bottom:box.bottom});
              if(node.matches('.topbar'))bounds.top=Math.max(bounds.top,box.bottom);else bounds.bottom=Math.min(bounds.bottom,box.top);
            }
            for(let ancestor=target.parentElement;ancestor;ancestor=ancestor.parentElement){
              const style=getComputedStyle(ancestor),box=ancestor.getBoundingClientRect(),clipX=/^(hidden|clip|auto|scroll)$/.test(style.overflowX),clipY=/^(hidden|clip|auto|scroll)$/.test(style.overflowY);
              if(!clipX&&!clipY)continue;
              const propagated=ancestor===document.documentElement||ancestor===document.body&&root.overflowX==='visible'&&root.overflowY==='visible'&&root.contain==='none'&&style.contain==='none';
              const clip={id:ancestor.id,tag:ancestor.tagName,clipX,clipY,propagated,overflowX:style.overflowX,overflowY:style.overflowY,left:propagated?0:box.left+ancestor.clientLeft,right:propagated?innerWidth:box.left+ancestor.clientLeft+ancestor.clientWidth,top:propagated?0:box.top+ancestor.clientTop,bottom:propagated?innerHeight:box.top+ancestor.clientTop+ancestor.clientHeight};clips.push(clip);
              if(!propagated){if(clipX){bounds.left=Math.max(bounds.left,clip.left);bounds.right=Math.min(bounds.right,clip.right);}if(clipY){bounds.top=Math.max(bounds.top,clip.top);bounds.bottom=Math.min(bounds.bottom,clip.bottom);}}
            }
            return{rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},outlineWidth:parseFloat(css.outlineWidth)||0,outlineOffset:parseFloat(css.outlineOffset)||0,edge,scrollX,scrollY,viewport:{width:innerWidth,height:innerHeight},bounds,clips,chrome,active:document.activeElement===target,connected:target.isConnected,fullOutlineWithinBounds:r.left-edge>=bounds.left&&r.right+edge<=bounds.right&&r.top-edge>=bounds.top&&r.bottom+edge<=bounds.bottom};
          };
          const state=window.__favoriteReorderMeasurement={measure,before:measure(element),nativeInputs:[]},events=['keydown','pointerdown','wheel','touchstart'];
          const note=event=>{if(event.isTrusted)state.nativeInputs.push({type:event.type,trusted:event.isTrusted});};for(const name of events)document.addEventListener(name,note,{capture:true,passive:true});state.stop=()=>{for(const name of events)document.removeEventListener(name,note,true);};
        });
        f.lists['123']=[favoriteMints[1],favoriteMints[2],favoriteMints[0]];await retainedFavorite(page,original,info,'account-order-and-insertion',()=>gate.release(),{count:3});
        const geometry=await original.evaluate(element=>{const state=window.__favoriteReorderMeasurement,after=state.measure(element);state.stop();return{before:state.before,after,nativeInputs:state.nativeInputs,documentDownwardDisplacement:after.rect.top+after.scrollY-state.before.rect.top-state.before.scrollY,scrollDeltaY:after.scrollY-state.before.scrollY,hypotheticalPaintedBottomAtPriorScroll:after.rect.bottom+after.edge+after.scrollY-state.before.scrollY};});
        await info.attach('account-reorder-visibility-recovery',{body:JSON.stringify(geometry,null,2),contentType:'application/json'});expect(geometry.before.active&&geometry.before.connected&&geometry.after.active&&geometry.after.connected).toBe(true);expect(geometry.before.fullOutlineWithinBounds&&geometry.after.fullOutlineWithinBounds).toBe(true);expect(geometry.nativeInputs).toEqual([]);
        if(width===390){expect(geometry.documentDownwardDisplacement).toBeGreaterThan(0);expect(geometry.scrollDeltaY).toBeGreaterThan(0);expect(geometry.hypotheticalPaintedBottomAtPriorScroll).toBeGreaterThan(geometry.after.bounds.bottom);}
        expect(await row.evaluate(element=>element.isConnected&&element===document.querySelector('#watchlist-items').children[2])).toBe(true);expect(await page.locator(favoriteRows).evaluateAll(rows=>rows.map(row=>row.dataset.mint))).toEqual(f.lists['123']);
        const remove=f.hold('watchGate');await page.locator(favoriteRefresh).click();await remove.started;await nativeFavorite(page,favoriteCard()+' .saved-token-view',info,'account-before-removal');f.lists['123']=[favoriteMints[1]];
        const fallback=await page.locator(favoriteRefresh).elementHandle();await armFavorite(fallback,{count:1});remove.release();const proof=await favoriteProof(page,info,'account-removed-to-refresh',{retained:false});expect(proof.events.filter(event=>event.original)).toHaveLength(1);expect(await original.evaluate(element=>element.isConnected)).toBe(false);
        await expect(page.locator('#watch-count')).toHaveText('1 favorite');await favoriteImage(page,info,'account-insert-remove-'+width);
      }finally{await f.finish(info);}
    });
    test(`changed verified market values labels and action data keep original controls at${width}`,async({page},info)=>{
      const f=await favoriteFixture(page,width,{market:true,account:true}),feedStarts=[];let held,eligibility,payload,trustedEnter,growth;
      const observed=request=>{if(new URL(request.url()).pathname==='/api/pump/explore')feedStarts.push({request,id:feedStarts.length+1,url:request.url(),method:request.method(),startedAt:Date.now()});};
      const responded=response=>{const item=feedStarts.find(item=>item.request===response.request());if(item)item.status=response.status();};
      const aborted=request=>{const item=feedStarts.find(item=>item.request===request);if(item)item.failure=request.failure()?.errorText;};page.on('request',observed);page.on('response',responded);page.on('requestfailed',aborted);
      try{await f.open();f.releaseInitial();await expect(page.locator(favoriteCard()+' .saved-token-metrics')).not.toContainText('MC unavailable');
        const before=await page.locator(favoriteCard()+' .saved-token-metrics strong').allTextContents();expect(before[0]).not.toBe('$—');
        const currentURL=page.url(),grow=f.hold('watchGate');
        const [growthRequest]=await Promise.all([page.waitForRequest(request=>request.method()==='GET'&&new URL(request.url()).pathname==='/api/watchlist'&&new URL(request.url()).searchParams.get('accountId')==='123',{timeout:15000}),page.locator(favoriteRefresh).click()]);
        await expect.poll(()=>f.watchGate).toBeUndefined();f.lists['123']=[...favoriteMints];grow.release();await expect(page.locator(favoriteRows)).toHaveCount(3);growth={url:growthRequest.url(),method:growthRequest.method(),mints:[...f.lists['123']]};
        const retrySelector=`#watchlist-items .watchlist-unavailable [data-watch-retry="${favoriteMints[2]}"]`;await expect(page.locator(retrySelector)).toBeEnabled();expect(await page.locator(favoriteCard()+' .saved-token-metrics strong').allTextContents()).toEqual(before);
        const retry=await nativeFavorite(page,retrySelector,info,'third-unavailable-native-retry'),gate=f.hold('feedGate'),priorCount=feedStarts.length;
        await retry.evaluate(element=>{window.__marketRetryEnter=undefined;element.addEventListener('keydown',event=>{window.__marketRetryEnter={key:event.key,trusted:event.isTrusted,exactTarget:event.target===element,mint:element.dataset.watchRetry,at:Date.now()};},{once:true,capture:true,passive:true});});
        const [marketRequest]=await Promise.all([page.waitForRequest(request=>request.method()==='GET'&&new URL(request.url()).pathname==='/api/pump/explore',{timeout:15000}),(async()=>{await page.keyboard.press('Enter');trustedEnter=await page.evaluate(()=>window.__marketRetryEnter);})()]);
        await expect.poll(()=>f.feedGate).toBeUndefined();expect(feedStarts).toHaveLength(priorCount+1);held=feedStarts.at(-1);expect(held.request).toBe(marketRequest);expect(trustedEnter).toMatchObject({key:'Enter',trusted:true,exactTarget:true,mint:favoriteMints[2]});expect(held.startedAt).toBeGreaterThanOrEqual(trustedEnter.at);expect(held.failure).toBeUndefined();expect(held.request.failure()).toBeNull();expect(page.url()).toBe(currentURL);
        const original=await nativeFavorite(page,favoriteCard()+' .saved-token-identity>a',info,'market-before-update');const controls=await page.locator(favoriteCard()).evaluateHandle(row=>({row,controls:[...row.querySelectorAll('a,button')]}));
        eligibility=await original.evaluate(element=>{const root=document.querySelector('#community');return{active:document.activeElement===element,connected:element.isConnected,focusVisible:element.matches(':focus-visible'),foreground:document.hasFocus()&&!document.hidden,favorites:location.hash==='#community'&&root?.isConnected&&!root.hidden&&root.getClientRects().length>0&&getComputedStyle(root).visibility==='visible'};});expect(Object.values(eligibility).every(Boolean)).toBe(true);
        f.marketVersion=1;const [response]=await Promise.all([page.waitForResponse(response=>response.request()===held.request,{timeout:15000}),retainedFavorite(page,original,info,'market-changed-current-content',()=>gate.release(),{text:'Market 1 token 0'})]);
        expect(response.status()).toBe(200);expect(held.request.failure()).toBeNull();payload=await response.json();expect(payload.items[0].name).toBe('Market 1 token 0');expect(payload.items[0].symbol).toBe('M10');
        const after=await page.locator(favoriteCard()+' .saved-token-metrics strong').allTextContents();expect(after[0]).not.toBe(before[0]);
        expect(await controls.evaluate(s=>s.row.isConnected&&s.controls.every(control=>control.isConnected&&control.closest('.saved-token-row')===s.row))).toBe(true);
        await expect(page.locator(favoriteCard()+' [data-share-mint]')).toHaveAttribute('data-share-name','Market 1 token 0');await expect(page.locator(favoriteCard()+' [data-share-mint]')).toHaveAttribute('data-share-symbol','M10');
        await expect(page.locator(favoriteCard()+' [data-trade-mint]')).toHaveAttribute('data-trade-mint',favoriteMints[0]);await favoriteImage(page,info,'market-data-current-'+width);
      }finally{page.off('request',observed);page.off('response',responded);page.off('requestfailed',aborted);await info.attach('explicit-market-retry-lineage',{body:JSON.stringify({trigger:'Existing native Retry check; explicit user read, not scheduled polling',growth,requests:feedStarts.map(({request,...record})=>record),heldId:held?.id,trustedEnter,eligibility,payload},null,2),contentType:'application/json'});await f.finish(info);}
    });
    test(`native guest remove and verified-unavailable-recovery do not freeze old controls at${width}`,async({page},info)=>{
      const f=await favoriteFixture(page,width);try{await f.open();f.releaseInitial();let gate=await f.registryRefresh();const original=await nativeFavorite(page,favoriteCard()+' .saved-token-identity>a',info,'before-kind-loss');
        f.registry=[];const fallback=await page.locator(favoriteRefresh).elementHandle();await armFavorite(fallback);gate.release();await favoriteProof(page,info,'verified-kind-loss-fallback',{retained:false});expect(await original.evaluate(element=>element.isConnected)).toBe(false);
        await expect(page.locator('#watchlist-items .watchlist-unavailable')).toHaveCount(2);await expect(page.locator('#watchlist-items')).not.toContainText('Controlled favorite');
        const retrySelector=`#watchlist-items [data-watch-retry="${favoriteMints[0]}"]`,retry=await nativeFavorite(page,retrySelector,info,'unavailable-retry-entry');
        const check=f.hold('registryGate');await page.keyboard.press('Enter');await check.started;await expect(page.locator(retrySelector)).toBeDisabled();f.registry=[];check.release();await expect(page.locator(retrySelector)).toBeEnabled();expect(await retry.evaluate(element=>element.isConnected)).toBe(true);
        gate=f.hold('registryGate');await page.locator(retrySelector).click();await gate.started;f.registry=favoriteMints.slice(0,2).map((mint,index)=>({mint,cluster:'devnet',onchainVerified:true,creatorWallet:creator,name:'Recovered '+index,symbol:'R'+index}));gate.release();
        await expect(page.locator(favoriteIdentity)).toHaveCount(2);const remove=await nativeFavorite(page,favoriteCard()+' .watch-button',info,'native-guest-remove');await armFavorite(fallback,{count:1});await page.keyboard.press('Enter');await favoriteProof(page,info,'guest-remove-recovery-control',{retained:false});expect(await remove.evaluate(element=>element.isConnected)).toBe(false);
        expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('funded.app.watchlist.guest.v1')).mints)).toEqual([favoriteMints[1]]);
        await nativeFavorite(page,favoriteCard(favoriteMints[1])+' .saved-token-view',info,'remaining-mint-native-entry');await page.keyboard.press('Enter');await expect(page).toHaveURL(new RegExp('/token/'+favoriteMints[1]+'$'));await page.goBack();await expect(page).toHaveURL(/#community$/);
      }finally{await f.finish(info);}
    });
    for(const outcome of['success','failure'])test(`obsolete logo ${outcome} cannot change retained current row or focus at${width}`,async({page},info)=>{
      const f=await favoriteFixture(page,width,{oldLogo:true});try{await f.open();f.releaseInitial();await expect.poll(()=>f.logoGates.length).toBeGreaterThan(0);
        const oldAvatar=await page.locator(favoriteCard()+' .portfolio-token-avatar').elementHandle();const gate=await f.registryRefresh();const original=await nativeFavorite(page,favoriteCard()+' .saved-token-view',info,'logo-original-entry');
        f.registry=f.registry.map(record=>({...record,imageUri:null,name:'Current artwork owner'}));await retainedFavorite(page,original,info,'fresh-avatar-current-owner',()=>gate.release(),{text:'Current artwork owner',avatar:true});
        expect(await oldAvatar.evaluate(element=>element.isConnected)).toBe(false);const image=page.locator(favoriteCard()+' .portfolio-token-avatar img');await expect(image).toHaveAttribute('src','/devnet-images/'+favoriteMints[0]);await expect.poll(()=>image.evaluate(element=>element.complete&&element.naturalWidth>0)).toBe(true);
        const currentAvatar=await image.evaluateHandle(element=>element.parentElement);await armFavorite(original);f.oldLogoFailure=outcome==='failure';f.oldLogoReleased=true;f.logoGates.forEach(held=>held.release());await Promise.all(f.logoGates.map(held=>held.completed));
        await favoriteProof(page,info,'obsolete-logo-completion-original-still-owned');expect(await currentAvatar.evaluate(element=>element.isConnected&&element===document.querySelector('#watchlist-items .portfolio-token-avatar'))).toBe(true);await expect(image).toHaveAttribute('src','/devnet-images/'+favoriteMints[0]);await favoriteImage(page,info,'obsolete-logo-'+outcome+'-'+width);
      }finally{await f.finish(info);}
    });
    test(`header or another row route and account leave prevent stale focus transfer at${width}`,async({page},info)=>{
      const f=await favoriteFixture(page,width,{account:true});try{await f.open();const original=await nativeFavorite(page,favoriteCard()+' .saved-token-identity>a',info,'before-user-leave');
        const other=await nativeFavorite(page,favoriteCard(favoriteMints[1])+' .saved-token-view',info,'other-row-current-owner');await retainedFavorite(page,other,info,'initial-completion-keeps-other-row',()=>f.releaseInitial(),{avatar:true});
        const held=f.hold('watchGate');await page.locator(favoriteRefresh).click();await held.started;const header=await page.locator(favoriteRefresh).elementHandle();f.lists['123']=[];held.release();await expect(page.locator(favoriteRows)).toHaveCount(0);expect(await header.evaluate(element=>element.isConnected&&document.activeElement===element)).toBe(true);
        let gate=f.hold('watchGate');await page.locator(favoriteRefresh).click();await gate.started;f.lists['123']=favoriteMints.slice(0,2);gate.release();await expect(page.locator(favoriteIdentity)).toHaveCount(2);
        const accountA=await nativeFavorite(page,favoriteCard()+' .saved-token-view',info,'accountA-before-swap');const old=f.hold('watchGate');await page.locator(favoriteRefresh).click();await old.started;f.identity='456';await page.locator(favoriteRefresh).click();await expect(page.locator(favoriteRows)).toHaveCount(0);
        const accountB=f.hold('watchGate');old.release();await old.completed;await accountB.started;accountB.release();await expect(page.locator(favoriteIdentity)).toHaveCount(2);expect(await accountA.evaluate(element=>element.isConnected)).toBe(false);expect(await header.evaluate(element=>document.activeElement===element)).toBe(true);
        const beforeChecking=await nativeFavorite(page,favoriteCard()+' .saved-token-view',info,'before-checking-owner');f.identity='checking';await page.locator(favoriteRefresh).click();await expect(page.locator(favoriteRows)).toHaveCount(0);expect(await beforeChecking.evaluate(element=>element.isConnected)).toBe(false);expect(await header.evaluate(element=>document.activeElement===element)).toBe(true);
        f.identity='guest';await page.locator(favoriteRefresh).click();await expect(page.locator('#community .section-state')).toHaveText('Sign in to sync');await expect(page.locator(favoriteRows)).toHaveCount(0);expect(await header.evaluate(element=>document.activeElement===element)).toBe(true);
        f.identity='456';const restored=f.hold('watchGate');await page.locator(favoriteRefresh).click();await restored.started;restored.release();await expect(page.locator(favoriteIdentity)).toHaveCount(2);expect(await beforeChecking.evaluate(element=>element.isConnected)).toBe(false);
        const leaving=await nativeFavorite(page,favoriteCard()+' .saved-token-view',info,'before-route-leave');gate=f.hold('watchGate');await page.locator(favoriteRefresh).click();await gate.started;await f.home();const outside=await page.evaluateHandle(()=>document.activeElement);f.lists['456']=[];gate.release();await expect(page.locator(favoriteRows)).toHaveCount(0);expect(await leaving.evaluate(element=>element.isConnected)).toBe(false);expect(await outside.evaluate(element=>element.isConnected&&document.activeElement===element)).toBe(true);
        expect(await original.evaluate(element=>element.isConnected)).toBe(false);await favoriteImage(page,info,'route-account-owner-leave-'+width);
      }finally{await f.finish(info);}
    });
  }
});

test.describe('FQA-054 deliberately offscreen retained owner',()=>{
  test.describe.configure({timeout:60000});
  test.afterEach(async({page})=>{await page.close();});
  for(const width of[390,1440])test(`native wheel away cancels retained visibility repair at${width}`,async({page},info)=>{
    const {PublicKey}=await import('@solana/web3.js');
    const mints=[...favoriteMints,...Array.from({length:9},(_,index)=>new PublicKey(new Uint8Array(32).fill(index+31)).toBase58())];
    const f=await favoriteFixture(page,width,{account:true,registry:mints});
    try{
      await f.open();f.releaseInitial();
      const grow=f.hold('watchGate');await page.locator(favoriteRefresh).click();await grow.started;f.lists['123']=mints;grow.release();await expect(page.locator(favoriteRows)).toHaveCount(mints.length);
      const held=f.hold('watchGate');await page.locator(favoriteRefresh).click();await held.started;
      const original=await nativeFavorite(page,favoriteCard(mints.at(-1))+' .saved-token-view',info,'last-row-native-before-wheel');
      expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(0);
      await page.evaluate(()=>{window.__favoriteNativeWheel=[];window.addEventListener('wheel',event=>window.__favoriteNativeWheel.push({trusted:event.isTrusted,deltaY:event.deltaY}),{capture:true,passive:true,once:true});});
      await page.mouse.move(width/2,200);await page.mouse.wheel(0,-20000);await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
      const before=await original.evaluate(element=>{const r=element.getBoundingClientRect();return{active:document.activeElement===element,connected:element.isConnected,focusVisible:element.matches(':focus-visible'),top:r.top,bottom:r.bottom,height:innerHeight,scrollX,scrollY,wheel:window.__favoriteNativeWheel};});
      expect(before.active&&before.connected&&before.focusVisible).toBe(true);expect(before.top).toBeGreaterThan(before.height);expect(before.wheel).toEqual([{trusted:true,deltaY:-20000}]);
      const expected=[mints[1],mints[0],...mints.slice(2)];
      await original.evaluate((element,{expected})=>{
        const row=element.closest('.saved-token-row'),avatar=row.querySelector('.portfolio-token-avatar'),start=performance.now(),x=scrollX,y=scrollY;
        const state=window.__favoriteWheelObservation={events:[],samples:[],removed:false};
        const focus=event=>state.events.push({original:event.target===element,tag:event.target.tagName,id:event.target.id});document.addEventListener('focusin',focus,true);
        const mutations=new MutationObserver(records=>{for(const record of records)for(const removed of record.removedNodes)if(removed===element||removed.contains?.(element))state.removed=true;});mutations.observe(document.querySelector('#watchlist-items'),{childList:true,subtree:true});
        state.promise=new Promise(resolve=>{
          let frame,timer,stationaryAt=null,allUnchanged=true;
          const finish=pass=>{clearTimeout(timer);cancelAnimationFrame(frame);mutations.disconnect();document.removeEventListener('focusin',focus,true);resolve({pass,elapsedMs:performance.now()-start,samples:state.samples,events:state.events,removed:state.removed,allUnchanged});};
          const tick=()=>{
            const r=element.getBoundingClientRect(),nodes=[...document.querySelector('#watchlist-items').children],order=nodes.map(node=>node.dataset.mint);
            const committed=!avatar.isConnected&&row.isConnected&&nodes.includes(row)&&order.length===expected.length&&order.every((mint,index)=>mint===expected[index]);
            const unchanged=scrollX===x&&scrollY===y&&element.isConnected&&element===document.activeElement&&r.top>innerHeight&&!state.removed&&state.events.length===0;
            allUnchanged=allUnchanged&&unchanged;
            const now=performance.now();if(committed&&unchanged&&allUnchanged){if(stationaryAt===null)stationaryAt=now;}else stationaryAt=null;
            state.samples.push({at:now-start,committed,unchanged,scrollX,scrollY,position:{top:r.top,bottom:r.bottom},stationaryMs:stationaryAt===null?0:now-stationaryAt});
            if(now-start>1000)return finish(false);if(stationaryAt!==null&&now-stationaryAt>=100)return finish(true);frame=requestAnimationFrame(tick);
          };timer=setTimeout(()=>finish(false),1000);frame=requestAnimationFrame(tick);
        });
      },{expected});
      f.lists['123']=expected;held.release();const result=await page.evaluate(()=>window.__favoriteWheelObservation.promise);
      await info.attach('native-wheel-no-reveal',{body:JSON.stringify({before,...result},null,2),contentType:'application/json'});
      expect(result.pass,JSON.stringify(result)).toBe(true);expect(result.elapsedMs).toBeLessThanOrEqual(1000);expect(result.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);expect(result.allUnchanged).toBe(true);expect(result.events).toEqual([]);expect(result.removed).toBe(false);
      await expect(page.locator('#watch-count')).toHaveText('12 favorites');expect(await page.locator(favoriteRows).evaluateAll(rows=>rows.map(row=>row.dataset.mint))).toEqual(expected);
      await favoriteImage(page,info,'deliberately-offscreen-no-reveal-'+width);
    }finally{await f.finish(info);}
  });
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
  const requests=[],pending=new Set();let closing,contextClosed=false;
  const failed=(row,reason,error)=>{
    row.state=closing?'cancelled':'failed';row.failureReason=reason;row.error=String(error);
    if(closing){row.phase=closing.phase;row.closeReason=closing.reason;}
  };
  page.on('request',request=>{
    const u=new URL(request.url());if(!u.pathname.startsWith('/api/'))return;
    const row={request,path:u.pathname,method:request.method(),state:'pending',
      phase:closing?'owned-context-close':'journey',startedDuringOwnedClose:Boolean(closing)};
    requests.push(row);
    if(contextClosed)failed(row,'request-observed-after-owned-close','Owned context is already closed; no response-body completion claimed');
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
  return {requests,pending,beginClose:reason=>{closing={phase:'owned-context-close',reason};},
    closed:()=>{
      contextClosed=true;
      for(const row of requests)if(row.state==='pending'&&row.startedDuringOwnedClose)
        failed(row,'owned-context-closed-without-response-event','Actual owned context close completed; no response-body completion claimed');
    },settle:async({allowCloseCancellation=false}={})=>{
    await expect.poll(()=>pending.size).toBe(0);
    await expect.poll(()=>requests.filter(r=>r.state==='pending').length).toBe(0);
    const unacceptable=requests.filter(row=>!(row.state==='complete'&&row.jsonComplete===true&&row.finishedError===null)
      && !(allowCloseCancellation&&row.state==='cancelled'&&row.phase==='owned-context-close'&&row.closeReason)
      && !(contextClosed&&row.startedDuringOwnedClose&&row.state==='cancelled'&&row.phase==='owned-context-close'&&row.closeReason));
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
      await attempt('owned-context-close',async()=>{await context.close();evidence.contextClose.complete=true;watch?.closed();});
    }finally{
      if(watch)await attempt('after-close-final-zero',async()=>{
        // Existing journey reads still require completed JSON. A new read initiated
        // during actual owned close is teardown cancellation, never completed-body proof.
        // Earlier journey failures remain the primary failure.
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
    await page.goto('/#community');await following082Ready(page);evidence.fonts=await following082Fonts(page);
    // The offline reward fixture schedules one real retry after 1500ms. Include
    // both startup reads before measuring requests caused by storage callbacks.
    await expect.poll(()=>watch.requests.filter(row=>row.path==='/api/rewards/automatic').length).toBe(2);
    await watch.settle();
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
