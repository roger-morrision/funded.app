import { test, expect } from '@playwright/test';
import { PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const launches = [66, 67].map((value, index) => ({
  mint: new PublicKey(new Uint8Array(32).fill(value)).toBase58(),
  name: `Tier focus QA ${index}`, symbol: `TF${index}`, cluster: 'devnet', onchainVerified: true,
  creatorWallet: '11111111111111111111111111111111',
}));
const savedMint = new PublicKey(new Uint8Array(32).fill(68)).toBase58();

async function prepare(page, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.addInitScript(mint => {
    localStorage.setItem('funded.app.community.watchlist', JSON.stringify([mint]));
    localStorage.setItem('funded.app.followed.wallets.v1', '[]');
  }, savedMint);
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Controlled unavailable fixture' } }));
  await page.route('**/api/x/me', route => route.fulfill({ json: { authenticated: false, configured: false } }));
  await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
  await page.route('**/api/launches', route => route.fulfill({ json: launches }));
  await page.route('**/api/pump/explore?*', route => route.fulfill({ json: { items: [], fetchedAt: new Date().toISOString() } }));
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
  await page.locator('button[data-explore-view="table"]').click();
  await expect(page.locator('#launch-list [data-tier-info-mint]')).toHaveCount(2);
}

async function open(page) {
  const trigger = page.locator('#launch-list [data-tier-info-mint]').first();
  await trigger.click();
  const dialog = page.locator('#explore-tier-dialog');
  await expect(dialog).toHaveJSProperty('open', true);
  expect(await dialog.evaluate(node => node.matches(':modal'))).toBe(true);
  await expect(page.locator('#explore-tier-close')).toBeFocused();
  return { trigger, dialog };
}

async function close(page, activation) {
  if (activation === 'pointer') await page.locator('#explore-tier-close').click();
  else await page.keyboard.press(activation);
  await expect(page.locator('#explore-tier-dialog')).toHaveJSProperty('open', false);
}

// Invoke the real Table renderer with deterministic launch records. This replaces
// the row in the same way as a completed background refresh, without touching DOM
// nodes directly or waiting for the timer/network in the regression test.
async function renderTableAgain(page, { dropFocused = false } = {}) {
  return page.evaluate(async ({ dropFocused }) => {
    const { renderRegistry } = await import('/src/features/explore/registry-view.js');
    const buttons = [...document.querySelectorAll('#launch-list [data-tier-info-mint]')];
    const before = buttons.map(button => ({ mint: button.dataset.tierInfoMint, node: button }));
    const focusedMint = document.activeElement.dataset.tierInfoMint;
    const rows = buttons.filter(button => !dropFocused || button.dataset.tierInfoMint !== focusedMint)
      .map((button, index) => ({
        address: button.dataset.tierInfoMint, symbol: `TF${index}`, name: `Tier focus QA ${index}`,
        icon: 'T', complete: false,
      }));
    const state = { registryLaunches: rows, registryPage: 1, registryCriteriaKey: '',
      exploreProviderStatus: 'Ready', exploreLastVerifiedAt: Date.now(),
      assets: rows, exploreFeedAvailable: true, verifiedBoosts: {}, EXPLORE_CLUSTER: 'devnet' };
    renderRegistry('', state, {
      getWatchlist: () => [], getFollowingTokenSources: () => new Map(),
      filterExploreTabRecords: records => records,
      exploreOutageCopy: () => ({ title: 'Unavailable', detail: '' }),
      exploreEmptyReason: () => null, exploreStageLabel: () => 'New', formatOnchainAge: () => 'Now',
      explorePaidListingBagMarkup: () => '', exploreBoostAmountMarkup: () => '',
      exploreSocialLinksMarkup: () => '',
      exploreTierBadgeMarkup: mint => before.find(row => row.mint === mint)?.node.outerHTML || '',
      exploreMarketCapUsd: () => '—', formatExploreTradeCount: () => '—',
      formatExploreUsd: () => '—', exploreAirdropMarkup: () => '',
      loadVerifiedTokenLogos: () => {}, renderWatchlist: () => {},
    });
    return before.every(row => !row.node.isConnected);
  }, { dropFocused });
}

for (const width of [390, 1440]) {
  test(`UX-010 restored tier focus survives a later real Table render at ${width}px (deterministic rows)`, async ({ page }) => {
    await prepare(page, width);
    const { trigger } = await open(page);
    await close(page, 'Escape');
    await expect(trigger).toBeFocused();
    // Place the focused trigger inside the usable viewport before asserting that
    // a same-row replacement leaves the page scroll unchanged.
    await trigger.evaluate(button => button.scrollIntoView({ behavior: 'instant', block: 'center' }));
    expect(await trigger.evaluate(button => {
      const rect = button.getBoundingClientRect();
      const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
      return rect.top >= top && rect.bottom <= innerHeight;
    })).toBe(true);
    const scrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    expect(await renderTableAgain(page)).toBe(true);
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(scrollBefore);
    await expect(page.locator('#explore-tier-dialog')).toHaveJSProperty('open', false);
    await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test(`UX-010 real Table render keeps superseding focus at ${width}px (deterministic rows)`, async ({ page }) => {
    await prepare(page, width);
    const { trigger } = await open(page);
    await close(page, 'Escape');
    await expect(trigger).toBeFocused();
    await page.locator('#explore-search').focus();
    expect(await renderTableAgain(page)).toBe(true);
    await expect(page.locator('#explore-search')).toBeFocused();
  });

  test(`UX-010 real Table render reveals fallback after focused mint disappears at ${width}px (deterministic rows)`, async ({ page }) => {
    await prepare(page, width);
    const { trigger } = await open(page);
    await close(page, 'Escape');
    await expect(trigger).toBeFocused();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await renderTableAgain(page, { dropFocused: true })).toBe(true);
    await expect(page.locator('#explore-search')).toBeFocused();
    const visible = await page.locator('#explore-search').evaluate(node => {
      const rect = node.getBoundingClientRect();
      const header = document.querySelector('.topbar');
      const top = header?.getClientRects().length && ['fixed', 'sticky'].includes(getComputedStyle(header).position)
        ? header.getBoundingClientRect().bottom : 0;
      const nav = document.querySelector('.mobile-workspace-nav');
      const bottom = nav?.getClientRects().length && getComputedStyle(nav).position === 'fixed'
        ? nav.getBoundingClientRect().top : innerHeight;
      return rect.top >= top && rect.bottom <= bottom;
    });
    expect(visible).toBe(true);
  });

  for (const activation of ['pointer', 'Enter', 'Space', 'Escape']) {
    for (const replaced of [false, true]) {
      test(`UX-010 ${replaced ? 'replaced' : 'current'} tier trigger returns focus after ${activation} at ${width}px (mocked APIs)`, async ({ page }) => {
        await prepare(page, width);
        await page.locator('#explore-search').fill('Tier focus');
        const saved = await page.evaluate(() => localStorage.getItem('funded.app.community.watchlist'));
        const { trigger } = await open(page);
        if (replaced) {
          const detached = await trigger.evaluate(node => {
            const replacement = node.cloneNode(true);
            node.replaceWith(replacement);
            return !node.isConnected && replacement.isConnected;
          });
          expect(detached).toBe(true);
        }
        await close(page, activation);
        await expect(trigger).toBeFocused();
        await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#explore-search')).toHaveValue('Tier focus');
        expect(await page.evaluate(() => localStorage.getItem('funded.app.community.watchlist'))).toBe(saved);
        const visibleFocus = await trigger.evaluate(node => {
          const rect = node.getBoundingClientRect();
          const scroll = node.closest('.scanner-scroll').getBoundingClientRect();
          const nav = document.querySelector('.mobile-workspace-nav');
          const bottom = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : innerHeight;
          return rect.left >= scroll.left && rect.right <= scroll.right && rect.top >= 0 && rect.bottom <= bottom;
        });
        expect(visibleFocus).toBe(true);
      });
    }
  }

  test(`UX-010 missing tier trigger returns to visible Search at ${width}px (mocked list rerender)`, async ({ page }) => {
    await prepare(page, width);
    const { trigger } = await open(page);
    await trigger.evaluate(node => node.remove());
    await close(page, 'Escape');
    await expect(page.locator('#explore-search')).toBeFocused();
    await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test(`UX-010 route change prevents late tier focus at ${width}px (mocked route)`, async ({ page }) => {
    await prepare(page, width);
    await open(page);
    await page.evaluate(() => { location.hash = '#overview'; });
    await expect(page.locator('body')).toHaveClass(/page-route-overview/);
    await close(page, 'Escape');
    await expect(page.locator('#explore-search')).not.toBeFocused();
    await expect(page).toHaveURL(/#overview$/);
  });

  test(`UX-010 superseding control keeps focus at ${width}px (mocked close timing)`, async ({ page }) => {
    await prepare(page, width);
    await open(page);
    await page.evaluate(() => {
      document.querySelector('#explore-tier-dialog').close();
      document.querySelector('#explore-search').focus();
    });
    await expect(page.locator('#explore-search')).toBeFocused();
  });

  test(`UX-010 queued close does not consume a newer tier dialog at ${width}px (mocked rapid reopen)`, async ({ page }) => {
    await prepare(page, width);
    await open(page);
    await page.evaluate(() => {
      document.querySelector('#explore-tier-dialog').close();
      const next = document.querySelectorAll('#launch-list [data-tier-info-mint]')[1];
      next.focus();
      next.click();
    });
    await expect(page.locator('#explore-tier-dialog')).toHaveJSProperty('open', true);
    await page.waitForTimeout(50);
    await page.locator('#launch-list [data-tier-info-mint]').nth(1).evaluate(node => node.replaceWith(node.cloneNode(true)));
    await close(page, 'Escape');
    await expect(page.locator('#launch-list [data-tier-info-mint]').nth(1)).toBeFocused();
  });
}


// FQA-078 additions: actual loader + ordinary route polling only. The original
// thirty tier cases above stay byte-exact with their narrower mocked qualifiers.
const tableExpect = expect.configure({timeout:15000});
const tableMints = [81, 82].map(value => new PublicKey(new Uint8Array(32).fill(value)).toBase58());
const tableTokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const tableReadRpcMethods = ['getGenesisHash', 'getSlot', 'getAccountInfo', 'getMultipleAccounts', 'getTokenLargestAccounts'];
const tablePrimary = `#launch-list [data-logo-mint="${tableMints[0]}"] .scanner-token-link`;
const tableQuery = 'FQA078';

function tableMintAccount(parsed = false) {
  const bytes = Buffer.alloc(82);
  bytes.writeBigUInt64LE(1_000_000_000n, 36); bytes[44] = 6; bytes[45] = 1;
  return { executable:false, lamports:1461600, owner:tableTokenProgram, rentEpoch:0,
    data:parsed ? { program:'spl-token', parsed:{ type:'mint', info:{ decimals:6, supply:'1000000000',
      isInitialized:true, mintAuthority:null, freezeAuthority:null } }, space:82 } : [bytes.toString('base64'), 'base64'] };
}
function tableRows(f, phase) {
  const changed = phase !== 'initial';
  const rows = tableMints.map((mint, index) => ({ mint, name:`FQA078 ${index ? 'Beta' : changed ? 'Alpha updated' : 'Alpha'}`,
    symbol:index ? 'FQA78B' : 'FQA78A', createdTimestamp:f.epoch - (index ? 7200 : changed ? 93600 : 3600),
    lastTradeTimestamp:f.epoch - (index ? 7200 : changed ? 93600 : 3600) }));
  return phase === 'removed' ? rows.slice(1) : rows;
}
function tableActivity(mint) {
  return { cluster:'devnet', mint, coverage:'complete', observedCoverage:'complete', observedAt:new Date().toISOString(),
    observedVolumeSol:0, volume24hSol:0, tradeCount24h:0, buyCount24h:0, sellCount24h:0, recentTrades:[],
    activityWindows:Object.fromEntries(['1h','6h','24h'].map(period => [period,
      { coverage:'complete', volumeSol:0, tradeCount:0, buyCount:0, sellCount:0, traderCount:0 }])) };
}
async function tableFixture(page, width) {
  const origin = new URL(test.info().project.use.baseURL).origin;
  const f = { epoch:Math.floor(Date.now()/1000), phase:'initial', next:null, gate:null, api:[], rpc:[], tasks:[], errors:[],
    forbidden:[], failures:[], completed:[], expectedAbortIds:[], pump:[], destination:false, bootRelease:null };
  let serial = 0; const requests = new WeakMap();
  page.on('pageerror', error => f.errors.push(error.message));
  page.on('requestfailed', request => {
    const record = requests.get(request), failure = {url:request.url(), method:request.method(), error:request.failure()?.errorText};
    if (record) { record.failed = failure; record.failedAt = new Date().toISOString(); }
    f.failures.push({id:record?.id, ...failure});
  });
  page.on('requestfinished', request => {
    const record = requests.get(request); if (!record) return;
    f.tasks.push((async () => {
      const response = await request.response();
      record.finishedError = await response.finished(); record.actualStatus = response.status();
      record.actualHeaders = await response.allHeaders(); record.actualBody = await response.text();
      record.finishedAt = new Date().toISOString(); f.completed.push(record);
    })().catch(error => f.errors.push('Actual response lifecycle: '+error.message)));
  });
  f.arm = (phase, hold = false) => {
    if (f.next || f.gate) throw Error('Only one ordinary read phase may be armed');
    f.next = {phase, hold, armedAt:new Date().toISOString()};
  };
  f.release = () => { const gate=f.gate; if(gate) {f.gate=null; gate.release();} };
  await page.setViewportSize({width, height:width < 700 ? 844 : 900});
  await page.route('**/*', async route => {
    const request=route.request(), url=new URL(request.url()), method=request.method();
    if (url.origin !== origin) {
      if (method === 'GET' && ['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname)) return route.continue();
      f.forbidden.push({url:request.url(), method}); return route.abort();
    }
    if (!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/devnet-metadata/')) {
      if (!['GET','HEAD','OPTIONS'].includes(method)) f.forbidden.push({url:request.url(), method});
      return route.continue();
    }
    const record={id:'fqa078-'+(++serial),url:request.url(),path:url.pathname,method,postData:request.postData(),
      startedAt:new Date().toISOString(),fulfilled:false,phase:f.phase};
    requests.set(request,record); f.api.push(record);
    const fulfill=async(status,json) => {
      record.expectedStatus=status; record.expectedBody=JSON.stringify(json);
      try {
        await route.fulfill({status, contentType:'application/json',headers:{'x-fqa078-read-id':record.id},body:record.expectedBody});
        record.fulfilled=true; record.fulfillCompleteAt=new Date().toISOString();
      } catch(error) {
        record.fulfillError=error.message;
        if (!f.expectedAbortIds.includes(record.id)) throw error;
      }
    };
    if(url.pathname==='/api/solana/rpc') {
      let payload; try {payload=request.postDataJSON();} catch {}
      const calls=Array.isArray(payload)?payload:[payload];
      if(method!=='POST'||!calls.length||!calls.every(call=>call&&tableReadRpcMethods.includes(call.method))) {
        f.forbidden.push(record); return fulfill(403,{error:'Only enumerated Devnet reads are permitted'});
      }
      f.rpc.push(...calls);
      const rows=calls.map(call=>{
        let result;
        if(call.method==='getSlot') result=100;
        else if(call.method==='getGenesisHash') result='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
        else if(call.method==='getTokenLargestAccounts') result={context:{slot:100},value:[]};
        else if(call.method==='getMultipleAccounts') result={context:{slot:100},value:(call.params?.[0]||[]).map(mint=>tableMints.includes(mint)?tableMintAccount():null)};
        else result={context:{slot:100},value:tableMints.includes(call.params?.[0])?tableMintAccount(call.params?.[1]?.encoding==='jsonParsed'):null};
        return {jsonrpc:'2.0',id:call.id,result};
      });
      return fulfill(200,Array.isArray(payload)?rows:rows[0]);
    }
    if(!['GET','HEAD','OPTIONS'].includes(method)) {f.forbidden.push(record);return fulfill(403,{error:'No writes'});}
    if(url.pathname==='/api/x/me') return fulfill(200,{authenticated:false,configured:false});
    if(url.pathname==='/api/fee-policy') return fulfill(200,{split:PROTOCOL_FEE_SPLIT});
    if(url.pathname==='/api/rewards/automatic') return fulfill(200,{status:'unavailable',reason:'Deterministic read-only Table fixture',schedules:[],serverTime:new Date().toISOString()});
    if(url.pathname==='/api/launches') return fulfill(200,f.destination?tableRows(f,f.phase).map(row=>({...row,cluster:'devnet',onchainVerified:true,policySignature:'FQA078_SYNTHETIC_TEST_ONLY_NOT_CHAIN_EVIDENCE',creatorWallet:'11111111111111111111111111111111'})):[]);
    if(url.pathname==='/api/pump/explore') {
      if(f.next) {
        const next=f.next; f.next=null; f.phase=next.phase; record.armedAt=next.armedAt; record.ordinaryPhase=true;
        record.phase=next.phase; record.hold=next.hold;
      }
      record.query=url.search; f.pump.push(record);
      const phase=record.phase;
      if(f.pump.length===1) await new Promise(release=>{f.bootRelease=release;});
      if(record.hold) await new Promise(release=>{f.gate={id:record.id,release};});
      try {return await fulfill(200,{items:tableRows(f,phase),fetchedAt:new Date().toISOString()});}
      finally {if(record.hold)record.releaseHandlerSettledAt=new Date().toISOString();}
    }
    const activity=url.pathname.match(/^\/api\/tokens\/([^/]+)\/market-activity$/);
    if(activity&&tableMints.includes(decodeURIComponent(activity[1]))) {
      return f.phase==='initial' ? fulfill(503,{error:'Controlled initial activity unavailable'}) : fulfill(200,tableActivity(decodeURIComponent(activity[1])));
    }
    return fulfill(503,{error:'Controlled unavailable supporting service'});
  });
  return f;
}
async function tableSettled(f) {
  await tableExpect.poll(()=>f.api.filter(record=>!record.finishedAt&&!record.failedAt).length,{timeout:15000}).toBe(0);
  await Promise.all(f.tasks);
}
async function tableFinish(f, info) {
  if(f.bootRelease){f.bootRelease();f.bootRelease=null;}
  f.release(); await tableSettled(f);
  await info.attach('table-actual-read-lifecycle',{body:JSON.stringify({...f,next:undefined,gate:undefined,release:undefined,arm:undefined,tasks:undefined,
    qualification:'Synthetic public Devnet read fixtures only. Unique exact response markers/body/status, completed Request/Response and expected original route cancellation remain distinct. No wallet, real chain or financial outcome.'},null,2),contentType:'application/json'});
  tableExpect(f.errors).toEqual([]); tableExpect(f.forbidden).toEqual([]);
  tableExpect(f.failures.filter(record=>!f.expectedAbortIds.includes(record.id))).toEqual([]);
  for(const record of f.completed) {
    tableExpect(record.finishedError).toBeNull(); tableExpect(record.fulfilled).toBe(true);
    tableExpect(record.actualStatus).toBe(record.expectedStatus);tableExpect(record.actualBody).toBe(record.expectedBody);
    tableExpect(record.actualHeaders['x-fqa078-read-id']).toBe(record.id);
  }
  for(const id of f.expectedAbortIds) {
    const record=f.api.find(row=>row.id===id);tableExpect(Boolean(record?.failedAt)).toBe(true);tableExpect(Boolean(record?.finishedAt)).toBe(false);
  }
  tableExpect(f.completed.length+f.expectedAbortIds.length).toBe(f.api.length);
}
async function tableRead(locator, callback, arg) {
  const handle=await locator.elementHandle(); if(!handle) throw Error('Required original Table node missing');
  try {return await handle.evaluate(callback,arg);} finally {await handle.dispose();}
}
async function tableFonts(page, info) {
  const result=await tableRead(page.locator('#launch-list .scanner-token-link').first(),async anchor=>{
    const nodes=[anchor,anchor.querySelector('strong'),anchor.closest('.scanner-row').querySelector('.scanner-age')];
    const styles=nodes.map(node=>{const s=getComputedStyle(node);return{family:s.fontFamily,weight:s.fontWeight,size:s.fontSize};});
    const loaded=[];
    for(const s of styles) {
      const family=s.family.split(',')[0].trim().replace(/^['"]|['"]$/g,'');
      const request=`${s.weight} ${s.size} "${family}"`;const faces=await document.fonts.load(request);
      loaded.push({request,family,faces:faces.map(face=>({family:face.family,weight:face.weight,style:face.style,status:face.status}))});
    }
    return {styles,loaded};
  });
  await info.attach('table-loaded-fonts',{body:JSON.stringify(result),contentType:'application/json'});
  tableExpect(result.loaded.every(item=>item.faces.length>0&&item.faces.every(face=>face.status==='loaded'))).toBe(true);
}
async function tableNativeTo(page, locator, direction='Tab') {
  const handle=await locator.elementHandle();if(!handle) throw Error('Native navigation target missing');
  try {
    for(let index=0;index<180;index++) {
      if(await handle.evaluate(node=>node===document.activeElement)) return;
      await page.keyboard.press(direction);
    }
    throw Error('Native Tab traversal exceeded bounded180 actions');
  } finally {await handle.dispose();}
}
async function tableOutline(page, handle, info, phase, key) {
  const pending=handle.evaluate(observeTablePrimaryControl,{hash:'#explore'});
  if(key) await page.keyboard.press(key);
  const proof=await pending;
  await info.attach('table-native-outline-'+phase,{body:JSON.stringify({phase,key,proof}),contentType:'application/json'});
  tableExpect(proof.pass,JSON.stringify(proof)).toBe(true);
  return proof;
}
async function tableReleaseOutline(page, handle, f, info, phase, condition) {
  const pending=handle.evaluate(observeTablePrimaryControl,{hash:'#explore',condition});
  f.release();const proof=await pending;
  await info.attach('table-update-outline-'+phase,{body:JSON.stringify({phase,condition,proof}),contentType:'application/json'});
  tableExpect(proof.pass,JSON.stringify(proof)).toBe(true);return proof;
}
async function tableSnapshot(handle, info, phase) {
  const value=await handle.evaluate(anchor=>{
    const row=anchor.closest('.scanner-row'),spine=[];
    for(let node=anchor;node;node=node.parentElement){spine.push({tag:node.tagName,class:node.className,connected:node.isConnected});if(node===row)break;}
    return {active:document.activeElement===anchor,connected:anchor.isConnected,href:anchor.getAttribute('href'),mint:row?.dataset.logoMint,
      text:anchor.textContent,rank:row?.querySelector('.scanner-rank')?.textContent,age:row?.querySelector('.scanner-age')?.textContent,
      rows:[...document.querySelectorAll('#launch-list .scanner-row')].map(node=>({mint:node.dataset.logoMint,rank:node.querySelector('.scanner-rank')?.textContent,
        age:node.querySelector('.scanner-age')?.textContent,name:node.querySelector('.scanner-token-link')?.textContent})),
      hash:location.hash,path:location.pathname,query:document.querySelector('#explore-search')?.value,view:document.querySelector('#explore')?.dataset.exploreView,spine};
  });
  await info.attach('table-primary-state-'+phase,{body:JSON.stringify(value),contentType:'application/json'});return value;
}
async function tableObserve(handle) {
  return handle.evaluate(anchor=>{
    if(window.__tablePrimaryObservation) throw Error('Only one primary observation allowed');
    const spine=[];for(let node=anchor;node;node=node.parentElement){spine.push(node);if(node.matches('.scanner-row'))break;}
    const events=[],removed=[];
    const listener=event=>events.push({type:event.type,original:event.target===anchor,id:event.target.id,tag:event.target.tagName});
    document.addEventListener('focusin',listener,true);document.addEventListener('focusout',listener,true);
    const observer=new MutationObserver(records=>{
      for(const record of records) for(const node of record.removedNodes) if(spine.includes(node)) removed.push({tag:node.tagName,class:node.className});
    });
    observer.observe(document.querySelector('#launch-list'),{childList:true,subtree:true});
    window.__tablePrimaryObservation={anchor,spine,events,removed,observer,listener};
    return {active:document.activeElement===anchor,connected:anchor.isConnected,spine:spine.map(node=>({tag:node.tagName,class:node.className}))};
  });
}
async function tableObserved(handle, info, phase, retained=true) {
  const result=await handle.evaluate(anchor=>{
    const observation=window.__tablePrimaryObservation;if(!observation||observation.anchor!==anchor)throw Error('Original primary observation mismatch');
    return {active:document.activeElement===anchor,connected:anchor.isConnected,href:anchor.getAttribute('href'),events:observation.events,removed:observation.removed,
      sameSpine:observation.spine.every((node,index)=>node.isConnected&&(index===0?node===anchor:observation.spine[index-1].parentElement===node)),
      currentAnchor:document.querySelector(`#launch-list [data-logo-mint="${anchor.closest('.scanner-row')?.dataset.logoMint}"] .scanner-token-link`)===anchor};
  });
  await info.attach('table-original-identity-'+phase,{body:JSON.stringify(result),contentType:'application/json'});
  if(retained){tableExpect(result.active).toBe(true);tableExpect(result.connected).toBe(true);tableExpect(result.sameSpine).toBe(true);tableExpect(result.currentAnchor).toBe(true);tableExpect(result.events).toEqual([]);tableExpect(result.removed).toEqual([]);}
  return result;
}
async function tableStopObservation(handle) {
  await handle.evaluate(()=>{const observation=window.__tablePrimaryObservation;if(!observation)return;observation.observer.disconnect();
    document.removeEventListener('focusin',observation.listener,true);document.removeEventListener('focusout',observation.listener,true);delete window.__tablePrimaryObservation;});
}
async function tableDestinationStart(handle, info) {
  const before=await handle.evaluate(node=>{
    if(window.__tableDestinationObservation)throw Error('Only one destination observation allowed');
    const describe=()=>({tag:node.tagName,id:node.id,type:node.type,name:node.name,value:node.value,
      active:document.activeElement===node,connected:node.isConnected,visible:node.getClientRects().length>0,
      activeIsBodyOrHtml:[document.body,document.documentElement].includes(document.activeElement),
      launchControl:Boolean(node.closest('#launch-dialog')),oldExploreControl:Boolean(document.querySelector('#launch-list')?.contains(node)),
      label:[...(node.labels||[])].map(label=>label.textContent.trim()).join(' '),hash:location.hash,
      launchRoute:document.body.classList.contains('page-route-launch')});
    const before=describe(),spine=[];for(let parent=node;parent;parent=parent.parentElement)spine.push(parent);
    const state={node,spine,before,events:[],removed:[],violations:[],samples:[],frame:null,observer:null,listener:null};
    const current=()=>({active:document.activeElement===node,connected:node.isConnected,hash:location.hash,
      activeTag:document.activeElement?.tagName,activeId:document.activeElement?.id});
    state.listener=event=>{state.events.push({type:event.type,targetTag:event.target.tagName,targetId:event.target.id,original:event.target===node,...current()});};
    document.addEventListener('focusin',state.listener,true);document.addEventListener('focusout',state.listener,true);
    state.observer=new MutationObserver(records=>{
      for(const record of records)for(const removed of record.removedNodes)if(spine.includes(removed))state.removed.push({tag:removed.tagName,id:removed.id});
      const sample=current();if(!sample.active||!sample.connected||sample.hash!=='#launch')state.violations.push({kind:'mutation',...sample});
    });
    state.observer.observe(document.documentElement,{childList:true,subtree:true});
    const tick=()=>{const sample=current();state.samples.push(sample);
      if(!sample.active||!sample.connected||sample.hash!=='#launch')state.violations.push({kind:'frame',...sample});
      state.frame=requestAnimationFrame(tick);};
    state.frame=requestAnimationFrame(tick);window.__tableDestinationObservation=state;return before;
  });
  await info.attach('table-destination-focus-before',{body:JSON.stringify(before),contentType:'application/json'});
  tableExpect(before.tag).toBe('INPUT');tableExpect(before.id).toBe('token-name');tableExpect(before.type).toBe('text');
  tableExpect(before.name).toBe('tokenName');tableExpect(before.value).toBe('');tableExpect(before.label).toContain('Token name');
  tableExpect(before.active).toBe(true);tableExpect(before.connected).toBe(true);tableExpect(before.visible).toBe(true);
  tableExpect(before.activeIsBodyOrHtml).toBe(false);tableExpect(before.oldExploreControl).toBe(false);
  tableExpect(before.launchControl).toBe(true);tableExpect(before.launchRoute).toBe(true);tableExpect(before.hash).toBe('#launch');
  return before;
}
async function tableDestinationEnd(handle, info, requestId) {
  // Native animation frames observe completion without a fixed sleep or app clock change.
  const after=await handle.evaluate(async node=>{
    await new Promise(resolve=>requestAnimationFrame(resolve));
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const state=window.__tableDestinationObservation;if(!state||state.node!==node)throw Error('Original destination identity mismatch');
    const value={sameOriginal:state.node===node,active:document.activeElement===node,connected:node.isConnected,
      visible:node.getClientRects().length>0,tag:node.tagName,id:node.id,type:node.type,name:node.name,value:node.value,
      hash:location.hash,launchRoute:document.body.classList.contains('page-route-launch'),
      launchControl:Boolean(node.closest('#launch-dialog')),oldExploreControl:Boolean(document.querySelector('#launch-list')?.contains(node)),
      activeIsBodyOrHtml:[document.body,document.documentElement].includes(document.activeElement),
      sameSpine:state.spine.every((parent,index)=>parent.isConnected&&(index===0?parent===node:state.spine[index-1].parentElement===parent)),
      events:state.events,removed:state.removed,violations:state.violations,samples:state.samples};
    return value;
  });
  await info.attach('table-destination-focus-after',{body:JSON.stringify({requestId,...after}),contentType:'application/json'});
  tableExpect(after.sameOriginal).toBe(true);tableExpect(after.sameSpine).toBe(true);tableExpect(after.active).toBe(true);
  tableExpect(after.connected).toBe(true);tableExpect(after.visible).toBe(true);tableExpect(after.id).toBe('token-name');
  tableExpect(after.tag).toBe('INPUT');tableExpect(after.type).toBe('text');tableExpect(after.name).toBe('tokenName');tableExpect(after.value).toBe('');
  tableExpect(after.hash).toBe('#launch');tableExpect(after.launchRoute).toBe(true);tableExpect(after.launchControl).toBe(true);
  tableExpect(after.oldExploreControl).toBe(false);tableExpect(after.activeIsBodyOrHtml).toBe(false);
  tableExpect(after.events).toEqual([]);tableExpect(after.removed).toEqual([]);tableExpect(after.violations).toEqual([]);
  tableExpect(after.samples.length).toBeGreaterThanOrEqual(2);return after;
}
async function tableDestinationStop(handle) {
  await handle.evaluate(node=>{
    const state=window.__tableDestinationObservation;if(!state)return;
    if(state.node!==node)throw Error('Destination observer cleanup identity mismatch');
    cancelAnimationFrame(state.frame);state.observer.disconnect();document.removeEventListener('focusin',state.listener,true);
    document.removeEventListener('focusout',state.listener,true);delete window.__tableDestinationObservation;
  });
}
async function tablePumpPhase(f, phase, hold=false) {
  await tableExpect.poll(()=>f.pump.filter(record=>record.phase===phase&&record.ordinaryPhase).length,{timeout:70000}).toBe(1);
  const record=f.pump.find(row=>row.phase===phase&&row.ordinaryPhase);
  if(hold) {tableExpect(record.hold).toBe(true);await tableExpect.poll(()=>f.gate?.id,{timeout:15000}).toBe(record.id);}
  else {await tableExpect.poll(()=>Boolean(record.finishedAt),{timeout:15000}).toBe(true);tableExpect(record.actualStatus).toBe(200);}
  return record;
}
async function tableBoot(page, f, info, width) {
  await page.goto('/#explore');await page.locator('body.workspace-ready.product-experience-ready').waitFor();
  await page.locator('button[data-explore-view="table"]').click();
  await page.locator('button[data-explore-tab="new"]').click();
  // The superseded initial-sort load reaches the real existing requestedSort guard
  // before activity sampling. One initial two-mint activity attempt uses2of5 budget.
  await tableExpect.poll(()=>Boolean(f.bootRelease)).toBe(true);f.bootRelease();f.bootRelease=null;
  await tableExpect(page.locator('#explore-sort')).toHaveValue('newest',{timeout:15000});
  await page.locator('#explore-search').fill(tableQuery);
  await tableExpect(page.locator('#launch-list .scanner-token-link')).toHaveCount(2,{timeout:15000});
  await tableExpect.poll(()=>f.completed.filter(record=>record.path==='/api/pump/explore'&&record.query?.includes('created_timestamp')).length,{timeout:15000}).toBeGreaterThan(0);
  await tableSettled(f);await tableFonts(page,info);
  tableExpect(f.completed.filter(record=>record.path.endsWith('/market-activity')&&record.phase==='initial')).toHaveLength(2);
  const locator=page.locator(tablePrimary),original=await locator.elementHandle();if(!original)throw Error('Original primary link missing');
  await tableNativeTo(page,locator);await page.keyboard.press('Shift+Tab');await tableOutline(page,original,info,'entry','Tab');
  const before=await tableSnapshot(original,info,'entry');tableExpect(before.active).toBe(true);tableExpect(before.rank).toBe('1');tableExpect(before.href).toBe('/token/'+tableMints[0]);
  tableExpect(before.query).toBe(tableQuery);tableExpect(before.view).toBe('table');tableExpect(before.rows.map(row=>row.mint)).toEqual(tableMints);
  tableExpect((await tableObserve(original)).active).toBe(true);
  return {original,before};
}

function observeTablePrimaryControl(original, readiness = {}) {
  const waitingAt = performance.now();
  const conditional = Boolean(readiness.condition); let began = conditional ? null : waitingAt;
  return new Promise(resolve => {
    const samples = []; let stationaryAt = null, previous = null, frame;
    const finish = pass => { cancelAnimationFrame(frame); clearTimeout(timer); resolve({ pass, samples, waitedMs:began===null?performance.now()-waitingAt:began-waitingAt,condition:readiness.condition||null }); };
    const tick = () => {
      if (began === null) {
        const condition = readiness.condition, node = document.querySelector(condition.selector);
        const ready = condition.absent ? !node : Boolean(node && (condition.text == null || node.textContent.includes(condition.text))
          && (condition.attribute == null || node.getAttribute(condition.attribute) === condition.value));
        if (!ready) { frame=requestAnimationFrame(tick); return; }
        began=performance.now();clearTimeout(timer);timer=setTimeout(()=>finish(false),1000);
      }
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
    let timer = setTimeout(() => finish(false), conditional ? 70000 : 1000);
    frame = requestAnimationFrame(tick);
  });
}

// Native methods are forwarded unchanged; only invocations during the marked
// held-response window are recorded. Native browser focus scrolling is not mocked.
async function tableBeginRevealAudit(handle) {
  await handle.evaluate(anchor=>{
    if(window.__tableRevealAudit)throw Error('One reveal audit only');
    const records=[],restore=[];
    const geometry=()=>{
      const rect=anchor.getBoundingClientRect(),css=getComputedStyle(anchor),nav=document.querySelector('.mobile-workspace-nav'),header=document.querySelector('.topbar');
      const edge=(parseFloat(css.outlineWidth)||0)+Math.max(0,parseFloat(css.outlineOffset)||0);
      return {top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,edge,
        safeTop:header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0,
        safeBottom:nav?.getClientRects().length?Math.min(innerHeight,nav.getBoundingClientRect().top):innerHeight,
        scrollX,scrollY,active:document.activeElement===anchor,connected:anchor.isConnected};
    };
    for(const [owner,name] of [[HTMLElement.prototype,'focus'],[Element.prototype,'scrollIntoView'],[Element.prototype,'scrollBy'],[Element.prototype,'scrollTo'],[window,'scrollBy'],[window,'scrollTo']]) {
      const original=owner[name],descriptor=Object.getOwnPropertyDescriptor(owner,name);
      if(typeof original!=='function')throw Error('Native audit method missing '+name);
      Object.defineProperty(owner,name,{configurable:true,writable:true,value:function(...args){
        const before=geometry(),record={method:name,windowTarget:this===window,targetTag:this.tagName||null,targetId:this.id||null,args,before};records.push(record);
        const result=Reflect.apply(original,this,args);record.after=geometry();return result;
      }});
      restore.push(()=>descriptor?Object.defineProperty(owner,name,descriptor):delete owner[name]);
    }
    window.__tableRevealAudit={anchor,records,restore,geometry,before:geometry()};
  });
}
async function tableEndRevealAudit(handle, info, phase, expectation='covered-only') {
  const value=await handle.evaluate(anchor=>{
    const state=window.__tableRevealAudit;if(!state||state.anchor!==anchor)throw Error('Original reveal audit missing');
    const value={before:state.before,after:state.geometry(),records:state.records};
    for(const restore of state.restore.reverse())restore();delete window.__tableRevealAudit;return value;
  });
  await info.attach('table-reveal-audit-'+phase,{body:JSON.stringify(value),contentType:'application/json'});
  tableExpect(value.records.filter(row=>row.method==='focus')).toEqual([]);
  const scrolls=value.records.filter(row=>row.method!=='focus');
  if(expectation==='none')tableExpect(scrolls).toEqual([]);
  if(expectation==='covered')tableExpect(scrolls.length).toBeGreaterThan(0);
  for(const row of scrolls) {
    tableExpect(row.method).toBe('scrollBy');tableExpect(row.args).toHaveLength(1);
    tableExpect(row.args[0].behavior).toBe('instant');tableExpect(row.args[0].left).toBe(0);
    const hidden=row.before.top-row.before.edge<row.before.safeTop?row.before.top-row.before.edge-row.before.safeTop
      :row.before.bottom+row.before.edge>row.before.safeBottom?row.before.bottom+row.before.edge-row.before.safeBottom:0;
    tableExpect(hidden).not.toBe(0);tableExpect(row.args[0].top).toBe(hidden>0?Math.ceil(hidden):Math.floor(hidden));
    tableExpect(row.before.active&&row.before.connected).toBe(true);
  }
  return value;
}
async function tableCancelRevealAudit(handle) {
  await handle.evaluate(()=>{const state=window.__tableRevealAudit;if(!state)return;for(const restore of state.restore.reverse())restore();delete window.__tableRevealAudit;});
}

for (const width of [360,390,1440]) {
  test(`FQA-078 native primary token identity survives ordinary updated Table read then Enter and Back at ${width}px`,async({page},info)=>{
    test.setTimeout(90000);const f=await tableFixture(page,width);let original;
    try {
      const entry=await tableBoot(page,f,info,width);original=entry.original;
      await page.screenshot({path:info.outputPath(`primary-entry-${width}.png`)});
      await tableBeginRevealAudit(original);
      f.arm('updated',true);const response=await tablePumpPhase(f,'updated',true);
      await tableReleaseOutline(page,original,f,info,'retained',{selector:tablePrimary,text:'Alpha updated'});
      await tablePumpPhase(f,'updated');
      // Native scroll clearance can leave the reordered link fully visible.
      // Any actual reveal must still move only its measured clipped amount.
      await tableEndRevealAudit(original,info,'retained',width===1440?'none':'covered-only');
      await tableExpect(page.locator(tablePrimary)).toContainText('Alpha updated',{timeout:15000});
      const after=await tableSnapshot(original,info,'retained');await tableObserved(original,info,'retained');
      tableExpect(after.href).toBe(entry.before.href);tableExpect(after.mint).toBe(tableMints[0]);tableExpect(after.rank).toBe('2');
      tableExpect(after.age).not.toBe(entry.before.age);tableExpect(after.rows.map(row=>row.mint)).toEqual([tableMints[1],tableMints[0]]);
      await info.attach('table-retained-ordinary-read',{body:JSON.stringify({id:response.id,phase:response.phase,query:response.query,qualification:'Actual completed ordinary pump read plus source-awaited RPC/activity publication; raw protocol and resources independently required.'}),contentType:'application/json'});
      await tableOutline(page,original,info,'retained');await page.screenshot({path:info.outputPath(`primary-retained-${width}.png`)});
      await tableStopObservation(original);
      // Finish initial/queued reads before navigation destroys their CDP bodies.
      // tableSettled still requires every exact response and original cancellation.
      await page.waitForLoadState('networkidle');await tableSettled(f);f.destination=true;
      await page.keyboard.press('Enter');await tableExpect(page).toHaveURL(new RegExp('/token/'+tableMints[0]+'$'),{timeout:15000});
      await tableExpect(page.locator('#coin-page-title')).toHaveText('FQA078 Alpha updated',{timeout:15000});
      await tableExpect(page.locator('#coin-pulse-trades')).toHaveText('Unavailable',{timeout:15000});
      await page.waitForLoadState('networkidle');await tableSettled(f);await page.goBack();await page.locator('body.page-route-explore.workspace-ready').waitFor();
      await tableExpect(page.locator('#explore-search')).toHaveValue(tableQuery,{timeout:15000});
      await tableExpect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed','true',{timeout:15000});
      await tableExpect(page.locator(tablePrimary)).toHaveAttribute('href','/token/'+tableMints[0],{timeout:15000});
      await page.waitForLoadState('networkidle');
    } finally {if(original){await tableCancelRevealAudit(original).catch(()=>{});await tableStopObservation(original).catch(()=>{});await original.dispose();}await tableFinish(f,info);}
  });
  test(`FQA-078 partial activity recovers then focused mint removal returns guarded Search at ${width}px`,async({page},info)=>{
    test.setTimeout(90000);const f=await tableFixture(page,width);let original;
    try {
      const entry=await tableBoot(page,f,info,width);original=entry.original;
      await tableExpect(page.locator('#explore-activity-coverage')).toHaveAttribute('data-state','partial',{timeout:15000});
      const row=page.locator(`#launch-list [data-logo-mint="${tableMints[0]}"]`);
      await tableExpect(row.locator('.scanner-metric').nth(1)).toHaveText('—',{timeout:15000});
      await tableBeginRevealAudit(original);
      f.arm('recovered',true);const recovered=await tablePumpPhase(f,'recovered',true);
      await tableReleaseOutline(page,original,f,info,'recovered',{selector:'#explore-activity-coverage',attribute:'data-state',value:'available'});
      await tablePumpPhase(f,'recovered');
      await tableEndRevealAudit(original,info,'recovered',width===1440?'none':'covered-only');
      await tableExpect(page.locator('#explore-activity-coverage')).toHaveAttribute('data-state','available',{timeout:15000});
      await tableExpect(row.locator('.scanner-metric').nth(1)).toHaveText('0',{timeout:15000});
      await tableObserved(original,info,'recovered');await tableSnapshot(original,info,'recovered');
      await tableOutline(page,original,info,'recovered');await page.screenshot({path:info.outputPath(`primary-recovered-${width}.png`)});
      const activity=f.completed.filter(record=>record.path.endsWith('/market-activity')&&record.phase==='recovered');
      tableExpect(activity.length).toBe(2);tableExpect(activity.every(record=>record.actualStatus===200)).toBe(true);
      f.arm('removed',true);const removed=await tablePumpPhase(f,'removed',true);
      const fallback=await page.locator('#explore-search').elementHandle();if(!fallback)throw Error('Original stable Search missing');
      try {await tableReleaseOutline(page,fallback,f,info,'removed-search',{selector:tablePrimary,absent:true});} finally {await fallback.dispose();}
      await tablePumpPhase(f,'removed');
      await tableExpect(page.locator(tablePrimary)).toHaveCount(0,{timeout:15000});await tableExpect(page.locator('#explore-search')).toBeFocused({timeout:15000});
      const removal=await tableObserved(original,info,'removed',false);tableExpect(removal.connected).toBe(false);tableExpect(removal.removed.length).toBeGreaterThan(0);
      await tableStopObservation(original);
      const search=await page.locator('#explore-search').elementHandle();if(!search)throw Error('Stable fallback Search missing');
      try {await tableOutline(page,search,info,'removed-search');} finally {await search.dispose();}
      await page.screenshot({path:info.outputPath(`removal-search-${width}.png`)});
      await tableExpect(page.locator('#explore-search')).toHaveValue(tableQuery);await tableExpect(page.locator('#launch-list .scanner-token-link')).toHaveCount(1);
      // Genuine no-match and correction through the user's existing Search; no manual render/state event.
      await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('FQA078 no matching token');
      await tableExpect(page.locator('#launch-list .scanner-token-link')).toHaveCount(0,{timeout:15000});await tableExpect(page.locator('#launch-list')).toContainText('No token matches your search.');
      await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type(tableQuery);
      await tableExpect(page.locator('#launch-list .scanner-token-link')).toHaveCount(1,{timeout:15000});
      await tableExpect(page.locator('#launch-list .scanner-token-link')).toHaveAttribute('href','/token/'+tableMints[1]);
      tableExpect(f.completed.filter(record=>record.path.endsWith('/market-activity')&&record.phase==='removed')).toHaveLength(0);
      await info.attach('table-recovery-removal-ordinary-reads',{body:JSON.stringify({recovered:recovered.id,removed:removed.id,recoveryActivityIds:activity.map(record=>record.id),cacheQualification:'503 initial activity was not cached; coherent recovery cached for5min. Removal poll reuses valid remaining-mint activity; no fresh activity response invented.'}),contentType:'application/json'});
    } finally {if(original){await tableCancelRevealAudit(original).catch(()=>{});await tableStopObservation(original).catch(()=>{});await original.dispose();}await tableFinish(f,info);}
  });
  test(`FQA-078 ordinary read preserves superseding focus and later route change at ${width}px`,async({page},info)=>{
    test.setTimeout(90000);const f=await tableFixture(page,width);let original;
    try {
      const entry=await tableBoot(page,f,info,width);original=entry.original;
      f.arm('superseded',true);const superseded=await tablePumpPhase(f,'superseded',true);
      await tableNativeTo(page,page.locator('#explore-search'),'Shift+Tab');await tableExpect(page.locator('#explore-search')).toBeFocused();
      await tableStopObservation(original);
      await tableBeginRevealAudit(original);
      const superseding=await page.locator('#explore-search').elementHandle();if(!superseding)throw Error('Superseding Search missing');
      try {await tableReleaseOutline(page,superseding,f,info,'superseding-search',{selector:tablePrimary,text:'Alpha updated'});} finally {await superseding.dispose();}
      await tableExpect.poll(()=>Boolean(superseded.finishedAt),{timeout:15000}).toBe(true);
      await tableEndRevealAudit(original,info,'superseding-search','none');
      await tableExpect(page.locator(tablePrimary)).toContainText('Alpha updated',{timeout:15000});await tableExpect(page.locator('#explore-search')).toBeFocused();
      const search=await page.locator('#explore-search').elementHandle();if(!search)throw Error('Superseding Search missing');
      try {await tableOutline(page,search,info,'superseding-search');} finally {await search.dispose();}
      await page.screenshot({path:info.outputPath(`superseding-search-${width}.png`)});
      // Reach the current token normally, then leave Explore during a different actual ordinary read.
      await tableNativeTo(page,page.locator(tablePrimary));await page.keyboard.press('Shift+Tab');
      const current=await page.locator(tablePrimary).elementHandle();if(!current)throw Error('Current token missing');
      try {await tableOutline(page,current,info,'before-route','Tab');} finally {await current.dispose();}
      await tableSettled(f);f.arm('route-away',true);const away=await tablePumpPhase(f,'route-away',true);
      f.expectedAbortIds.push(away.id);
      await page.locator('a[href="#launch"]:visible').first().click();
      await tableExpect(page).toHaveURL(/#launch$/,{timeout:15000});await page.locator('body.page-route-launch').waitFor();
      await tableExpect.poll(()=>Boolean(away.failedAt),{timeout:15000}).toBe(true);
      // Establish the intended destination control with ordinary native Tab only.
      // BODY, a clicked old navigation link, or an arbitrary off-list node cannot pass.
      await tableExpect(page.locator('#token-name')).toBeVisible();
      await tableNativeTo(page,page.locator('#token-name'));
      const destination=await page.locator('#token-name').elementHandle();if(!destination)throw Error('Original destination input missing');
      try {
        const before=await tableDestinationStart(destination,info);await tableBeginRevealAudit(destination);f.release();
        await tableExpect.poll(()=>Boolean(away.releaseHandlerSettledAt),{timeout:15000}).toBe(true);
        await tableSettled(f);tableExpect(Boolean(away.finishedAt)).toBe(false);
        const after=await tableDestinationEnd(destination,info,away.id);
        await tableEndRevealAudit(destination,info,'superseding-destination','none');
        tableExpect({id:after.id,tag:after.tag,type:after.type,name:after.name,value:after.value,hash:after.hash})
          .toEqual({id:before.id,tag:before.tag,type:before.type,name:before.name,value:before.value,hash:before.hash});
        await info.attach('table-route-cancellation',{body:JSON.stringify({id:away.id,failed:away.failed,
          finishedAt:away.finishedAt||null,releaseHandlerSettledAt:away.releaseHandlerSettledAt,
          destinationBefore:before,destinationAfter:after,
          qualification:'Original request cancellation remains abort, never completed response/body proof. Original native destination INPUT stays connected/active with no focus, spine-removal or native-frame violation across held-route release and actual lifecycle settlement.'}),contentType:'application/json'});
      } finally {await tableDestinationStop(destination);await destination.dispose();}
      await page.goBack();await page.locator('body.page-route-explore.workspace-ready').waitFor();
      await tableExpect(page.locator('#explore-search')).toHaveValue(tableQuery,{timeout:15000});
      await tableExpect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed','true',{timeout:15000});
      await tableExpect(page.locator(tablePrimary)).toHaveAttribute('href','/token/'+tableMints[0],{timeout:15000});
    } finally {if(original){await tableCancelRevealAudit(original).catch(()=>{});await tableStopObservation(original).catch(()=>{});await original.dispose();}await tableFinish(f,info);}
  });
}

test('FQA-078 ordinary read does not reveal a primary link obscured by native user scrolling at 360px',async({page},info)=>{
  test.setTimeout(90000);const f=await tableFixture(page,360);let original;
  try {
    const entry=await tableBoot(page,f,info,360);original=entry.original;
    f.arm('updated',true);const response=await tablePumpPhase(f,'updated',true);
    // This separate negative case intentionally honors the user's native scroll
    // away from focus. Positive outline cases above receive no pre-scroll aid.
    await page.mouse.move(5,400);await page.mouse.wheel(0,900);
    const before=await original.evaluate(anchor=>new Promise(resolve=>{
      const began=performance.now();let stable=null,last=null,frame,timer;
      const finish=value=>{cancelAnimationFrame(frame);clearTimeout(timer);resolve(value);};
      const tick=()=>{const rect=anchor.getBoundingClientRect(),header=document.querySelector('.topbar');
        const top=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0;
        const now=performance.now(),position=JSON.stringify([scrollX,scrollY,rect.top,rect.bottom]);
        const obscured=rect.bottom<top&&document.activeElement===anchor&&anchor.isConnected;
        if(obscured){if(last!==position||stable===null)stable=now;}else stable=null;last=position;
        if(stable!==null&&now-stable>=100)return finish({pass:true,scrollX,scrollY,rect:{top:rect.top,bottom:rect.bottom},top,
          documentHeight:document.documentElement.scrollHeight,tableHeight:document.querySelector('.scanner-scroll').scrollHeight,
          documentTop:rect.top+scrollY});
        if(now-began>1000)return finish({pass:false});frame=requestAnimationFrame(tick);};
      timer=setTimeout(()=>finish({pass:false}),1000);frame=requestAnimationFrame(tick);
    }));
    tableExpect(before.pass).toBe(true);await tableBeginRevealAudit(original);f.release();
    await tablePumpPhase(f,'updated');await tableExpect(page.locator(tablePrimary)).toContainText('Alpha updated');
    const audit=await tableEndRevealAudit(original,info,'pre-obscured','none');
    tableExpect(audit.after.scrollX).toBe(before.scrollX);
    const nativeGeometry=await original.evaluate(anchor=>({documentHeight:document.documentElement.scrollHeight,
      tableHeight:document.querySelector('.scanner-scroll').scrollHeight,documentTop:anchor.getBoundingClientRect().top+scrollY,
      scrollY,maxScroll:document.documentElement.scrollHeight-innerHeight}));
    // Native scroll anchoring can track a growing/reordered table without an
    // application scroll call. Exact window Y is meaningful for stable geometry.
    if(nativeGeometry.documentHeight===before.documentHeight&&nativeGeometry.tableHeight===before.tableHeight
      &&nativeGeometry.documentTop===before.documentTop) {
      tableExpect(audit.after.scrollY).toBe(before.scrollY);
    } else {
      tableExpect(nativeGeometry.scrollY).toBeGreaterThanOrEqual(0);
      tableExpect(nativeGeometry.scrollY).toBeLessThanOrEqual(nativeGeometry.maxScroll);
    }
    await info.attach('table-native-anchor-geometry',{body:JSON.stringify({before,after:nativeGeometry,
      appRevealCalls:audit.records.length,qualification:'Native geometry shift is recorded separately; zero application reveal, same original focus and remaining obscuration are still mandatory.'}),contentType:'application/json'});
    tableExpect(audit.after.bottom).toBeLessThan(audit.after.safeTop);
    await tableObserved(original,info,'pre-obscured');const after=await tableSnapshot(original,info,'pre-obscured');
    tableExpect(after.rank).toBe('2');tableExpect(after.rows.map(row=>row.mint)).toEqual([tableMints[1],tableMints[0]]);
    await info.attach('table-pre-obscured-ordinary-read',{body:JSON.stringify({id:response.id,before,audit}),contentType:'application/json'});
  } finally {if(original){await tableCancelRevealAudit(original).catch(()=>{});await tableStopObservation(original).catch(()=>{});await original.dispose();}await tableFinish(f,info);}
});
