import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
const wallet = '2'.repeat(44), tx = '3'.repeat(64);
function fixture({ category = 'all', page = 1 } = {}) {
  const received = { wallet, receivedLamports:'500000000', payments:2 };
  return { cluster:'devnet', scope:'all-recorded-snapshots', serverTime:'2026-10-18T23:58:58Z',
    nextCutoffAt:'2026-10-19T00:00:00Z', poolCheckedAt:'2026-10-18T23:58:58Z', snapshotEnabled:true, payoutEnabled:true,
    pool:{ status:'verified-indexed-settlements', day:'2026-10-18', collections:3,
      categoryLamports:{ creators:'1000000000', referrals:'999999999', traders:'999999998' } },
    snapshots:45, totalPayments:25, unavailableReceipts:1, unavailableSnapshots:0, worker:{ status:'active' },
    leaders:{ creators:[received], referrals:[], traders:[received] },
    history:{ page, pages:2, total:25, category, rows:[{ wallet, day:page === 1 ? '2026-10-17' : '2026-09-01',
      receivedLamports:'149', categoryLamports:{ creators:'50', referrals:'50', traders:'49' }, signature:tx,
      href:`https://explorer.solana.com/tx/${tx}?cluster=devnet` }] } };
}
async function setup(page, response = () => null) {
  await page.route('**/api/**', route => route.fulfill({ status:503, json:{ error:'Offline fixture' } }));
  await page.route('**/api/fee-policy', route => route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/daily-bonus/dashboard?*', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json:response() || fixture({ category:url.searchParams.get('category'), page:Number(url.searchParams.get('page')) }) });
  });
  await page.route('https://**/*', route => route.abort());
}
test('Home bonus amounts animate to recorded totals; countdown ticks down; category links open full history', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await setup(page); await page.goto('/#overview');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const home = page.locator('#home-daily-bonuses'); await expect(home).toBeVisible();
  await expect(home).toContainText('each receive one third');
  await expect(home.locator('.bonus-pool-grid article small')).toHaveText(Array(3).fill('1st 50% · 2nd 30% · 3rd 20% of the category budget'));
  await expect(home.locator('[data-bonus-pool="creators"]')).toHaveText('1 SOL');
  await expect(home.locator('[data-bonus-pool="referrals"]')).toHaveText('0.999999999 SOL');
  const clock = home.locator('[data-bonus-countdown]'); const initial = await clock.textContent();
  await expect.poll(() => clock.textContent()).not.toBe(initial);
  await home.locator('[data-bonus-category-link="traders"]').click();
  await expect(page.locator('#bonuses')).toBeVisible(); await expect(home).toBeHidden();
  await expect(page.locator('[data-bonus-delivery]')).toContainText('of the category budget');
  await expect(page.locator('[data-bonus-history-category]')).toHaveValue('traders');
  await expect(page.locator('[data-bonus-leaders]')).toContainText('0.5 SOL');
  await expect(page.locator('[data-bonus-history-rows]')).toContainText('0.000000149 SOL');
  await expect(page.locator('[data-bonus-history-rows] a[target="_blank"]')).toHaveAttribute('href', /cluster=devnet/);
  await page.locator('[data-bonus-next]').click();
  await expect(page.locator('[data-bonus-history-rows]')).toContainText('2026-09-01');
  await expect(page.locator('[data-bonus-next]')).toBeDisabled();
  await expect(page.locator('[data-bonus-history-status]')).toContainText('excluded from rankings');
  expect(errors).toEqual([]);
});
test('reduced motion, narrow layout, direct page routing and invalid-network stale clearing', async ({ page }) => {
  let response; await page.emulateMedia({ reducedMotion:'reduce' }); await setup(page, () => response);
  await page.setViewportSize({ width:390, height:844 }); await page.goto('/#bonuses');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#bonuses')).toBeVisible();
  await expect(page.locator('[data-bonus-history-rows]')).toContainText('2026-10-17');
  await page.locator('#open-menu').click();
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  if (await page.locator('.nav-more').getAttribute('open') === null) await page.locator('.nav-more summary').click();
  await expect(page.locator('.nav-more a[href="#bonuses"]')).toBeVisible();
  await expect(page.locator('.nav-more a[href="#bonuses"]')).toHaveAttribute('aria-current', 'page');
  await page.locator('.nav-more a[href="#bonuses"]').click();
  await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-bonus-history-category]').selectOption('referrals');
  await expect(page.locator('[data-bonus-page]')).toContainText('Page 1');
  response = { ...fixture(), cluster:'mainnet-beta' }; await page.locator('[data-bonus-history-refresh]').click();
  await expect(page.locator('[data-bonus-history-status]')).toContainText('unavailable');
  await expect(page.locator('[data-bonus-leaders]')).toBeEmpty();
  await expect(page.locator('[data-bonus-history-rows]')).toBeEmpty();
  await expect(page.locator('[data-bonus-next]')).toBeDisabled();
  await page.screenshot({ path:test.info().outputPath('bonus-unavailable-mobile.png'), fullPage:true });
});
test('empty history shows no synthetic recipients and Home does not invent rewards', async ({ page }) => {
  const empty = fixture(); empty.leaders = { creators:[], referrals:[], traders:[] };
  empty.totalPayments = 0; empty.unavailableReceipts = 0; empty.history = { page:1, pages:1, rows:[], total:0, category:'all' };
  empty.pool = { status:'unavailable', categoryLamports:null };
  await setup(page, () => empty); await page.goto('/#bonuses');
  await expect(page.locator('[data-bonus-leaders]')).toContainText('No finalized bonus payout yet');
  await expect(page.locator('[data-bonus-history-rows]')).toContainText('No finalized bonus payouts');
  await page.goto('/#overview');
  await expect(page.locator('[data-bonus-pool="creators"]')).toHaveText('Unavailable');
});

test('Devnet QA schedule shows five-minute cutoffs consistently on Home, history and Capital flow',async({page})=>{
  const qa={...fixture(),schedule:{mode:'devnet-qa-5m',periodSeconds:300,mints:['qa'],cohort:'abcdef012345'},serverTime:'2026-10-18T10:15:20Z',nextCutoffAt:'2026-10-18T10:20:00Z'};
  await setup(page,()=>qa);
  await page.route('**/api/daily-bonus',route=>route.fulfill({json:{cluster:'devnet',schedule:qa.schedule,nextCutoffAt:qa.nextCutoffAt,snapshots:[],payoutEnabled:true,snapshotEnabled:true,indexing:[{day:'qa5m:2026-10-18T10:00:00Z',reason:'Old test fixture.'}]}}));
  await page.goto('/#overview');
  await expect(page.locator('[data-bonus-schedule]')).toContainText('every 5 minutes');
  await expect(page.locator('[data-bonus-cutoff-label]')).toHaveText('Next QA snapshot · every 5 minutes');
  await expect(page.locator('#home-daily-bonuses')).toContainText('After the snapshot and source funding are verified');
  await expect(page.locator('#home-daily-bonuses')).not.toContainText('After the daily snapshot');
  await expect(page.locator('[data-bonus-countdown]')).toContainText('00:04:');
  await page.goto('/#bonuses');await expect(page.locator('[data-bonus-delivery]')).toContainText('Devnet QA snapshots close every 5 minutes');
  await page.goto('/#capital-flow');await expect(page.locator('#daily-bonus-title')).toHaveText('Top 3. Every 5 minutes · Devnet QA.');
  await expect(page.locator('[data-bonus-status]')).not.toContainText('Processing');
});

test('Capital flow refreshes on entry and ignores an older overlapping snapshot response',async({page})=>{
  await setup(page);
  let requests=0, releaseOld;
  const oldResponse=new Promise(resolve=>{releaseOld=resolve;});
  await page.route('**/api/daily-bonus',async route=>{
    const first=++requests===1;
    if(first)await oldResponse;
    await route.fulfill({json:{cluster:'devnet',snapshotEnabled:true,payoutEnabled:true,
      nextCutoffAt:first?'2026-10-18T10:05:00Z':'2026-10-18T10:10:00Z',snapshots:[]}});
  });
  try {
    await page.goto('/#overview');
    await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await expect.poll(()=>requests).toBe(1);
    await page.locator('.primary-nav > a[href="#capital-flow"]').click();
    await expect.poll(()=>requests).toBe(2);
    const status=page.locator('#daily-bonus-dashboard [data-bonus-status]');
    await expect(status).toContainText('10:10:00 UTC');
    const completed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/daily-bonus');
    releaseOld();await completed;
    await expect(status).toContainText('10:10:00 UTC');
    await expect(status).not.toContainText('10:05:00 UTC');
  } finally {releaseOld();}
});

test('QA snapshot labels stay readable and retain their original selection and proof identifiers',async({page})=>{
  const key='qa5m:2026-10-18T16:25:00Z@abcdef012345';
  const response=fixture();response.worker={status:'degraded'};response.history.rows[0].day=key;
  await setup(page,()=>response);
  await page.route('**/api/daily-bonus',route=>route.fulfill({json:{cluster:'devnet',snapshotEnabled:true,payoutEnabled:true,
    snapshots:[{day:key,status:'snapshotted',hash:'a'.repeat(64),allocatedLamports:'0',retainedLamports:'0',rankings:{creators:[],referrals:[],traders:[]},sources:[]}]}}));
  await page.goto('/#bonuses');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const day=page.locator('[data-bonus-history-rows] tbody tr td').first();
  await expect(day).toHaveText('2026-10-18 · 16:25–16:30 UTC · QA');
  await expect(day).toHaveAttribute('title',key);
  await expect(page.locator('[data-bonus-history-status]')).toContainText('Payout verification is delayed');
  await expect(page.locator('[data-bonus-history-status]')).not.toContainText('Worker:');
  await expect(page.locator('[data-bonus-history-rows]').getByRole('link',{name:'Transaction ↗',exact:true})).toHaveAttribute('href',/3{64}\?cluster=devnet$/);
  await page.goto('/#overview');await expect(page.locator('[data-bonus-verification]')).toContainText('Payout verification is delayed');
  await page.goto('/#capital-flow');
  await expect(page.locator('[data-bonus-day]')).toHaveValue(key);
  await expect(page.locator('[data-bonus-day] option')).toHaveText('2026-10-18 · 16:25–16:30 UTC · QA');
  await expect(page.locator('[data-bonus-results]')).not.toContainText('@abcdef012345');
  await page.locator('#daily-bonus-dashboard').screenshot({path:test.info().outputPath('readable-snapshot-windows.png')});
});

// FQA-071: actual bootstrap and native input; all payment values are local fixtures.
const bonusHistoryRows = '[data-bonus-history-rows]';
const bonusRecipient = `${bonusHistoryRows} tbody td:nth-child(2) a`;
const bonusCategory = '[data-bonus-history-category]';
const bonusRefresh = '[data-bonus-history-refresh]';
function bonusReceipt({ signature = tx, paymentAccount = null, amount = '149', day = '2026-10-17', who = wallet } = {}) {
  return { wallet:who, signature, paymentAccount, day, receivedLamports:amount,
    categoryLamports:{ creators:amount, referrals:'0', traders:'0' },
    href:`https://explorer.solana.com/${signature ? 'tx' : 'address'}/${signature || paymentAccount}?cluster=devnet` };
}
async function bonusOwnershipFixture(page, width, initial = [bonusReceipt()]) {
  const f = { rows:initial, requests:[], forbidden:[], errors:[], gates:[], ownerOverride:null };
  const readonly = new Set(['getGenesisHash','getAccountInfo','getMultipleAccounts','getBalance','getLatestBlockhash',
    'getSignatureStatuses','getSlot','getBlockHeight','getTokenAccountsByOwner','getTokenLargestAccounts','getProgramAccounts']);
  let pending;
  f.hold = () => {
    expect(pending).toBeUndefined(); let release, start, done;
    const gate = { ready:new Promise(resolve => { start = resolve; }), wait:new Promise(resolve => { release = resolve; }),
      release:() => release(), completed:new Promise(resolve => { done = resolve; }), done, start, status:200, snapshot:null };
    pending = gate; f.gates.push(gate); return gate;
  };
  await page.setViewportSize({ width, height:width < 700 ? 844 : 900 });
  page.on('pageerror', error => f.errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const local = url.origin === new URL(test.info().project.use.baseURL).origin;
    if (!local) {
      if (method === 'GET' && ['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname)) return route.continue();
      f.forbidden.push({ method, path:url.origin + url.pathname, reason:'external-request-blocked' }); return route.abort();
    }
    if (url.pathname === '/api/solana/rpc') {
      let body; try { body = request.postDataJSON(); } catch { /* Unknown JSON is blocked below. */ }
      const calls = Array.isArray(body) ? body : [body];
      const safe = method === 'POST' && calls.length > 0 && calls.every(call => call && readonly.has(call.method));
      f.requests.push({ path:url.pathname, method, rpc: calls.map(call => call?.method), locallyUnavailable:true });
      if (!safe) f.forbidden.push({ path:url.pathname, method, rpc:calls.map(call => call?.method), reason:'unknown-or-mutating-rpc-blocked' });
      return route.fulfill({ status:safe ? 503 : 403, json:{ error:'Local unavailable read fixture; no RPC forwarded' } });
    }
    if (!['GET','HEAD','OPTIONS'].includes(method)) {
      f.forbidden.push({ method, path:url.pathname, reason:'non-read-request-blocked' });
      return route.fulfill({ status:403, json:{ error:'No mutation allowed' } });
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    f.requests.push({ path:url.pathname, method, at:Date.now(), category:url.searchParams.get('category'), page:url.searchParams.get('page') });
    if (url.pathname === '/api/fee-policy') return route.fulfill({ json:{ split:PROTOCOL_FEE_SPLIT } });
    if (url.pathname !== '/api/daily-bonus/dashboard') return route.fulfill({ status:503, json:{ error:'Local read unavailable' } });
    const category = url.searchParams.get('category'), pageNumber = Number(url.searchParams.get('page'));
    const gate = pending; pending = undefined;
    if (gate) { gate.request = { category, page:pageNumber }; gate.start(); await gate.wait; }
    try {
      if (gate?.status !== undefined && gate.status !== 200) return await route.fulfill({ status:gate.status, json:{ error:'Controlled unavailable dashboard' } });
      const value = fixture({ category, page:pageNumber });
      value.history = { ...value.history, rows:f.rows, ...f.ownerOverride };
      if (gate?.snapshot) Object.assign(value, gate.snapshot);
      return await route.fulfill({ json:value });
    } finally { gate?.done(); }
  });
  f.open = async () => {
    await page.goto('/#bonuses'); await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await expect(page.locator(bonusRecipient)).toHaveCount(f.rows.length);
    const fonts = await page.evaluate(async () => { await document.fonts.ready; return { loaded:document.fonts.check('600 14px Manrope'),
      actual:[...document.fonts].filter(font => font.family.replaceAll('"','') === 'Manrope').map(font => ({ family:font.family, status:font.status })) }; });
    expect(fonts.loaded).toBe(true); expect(fonts.actual.some(font => font.status === 'loaded')).toBe(true);
    await test.info().attach('actual-fonts', { body:JSON.stringify(fonts), contentType:'application/json' });
  };
  f.trigger = async () => { const gate = f.hold(); await page.locator(bonusRefresh).click(); await gate.ready; return gate; };
  f.finish = async info => {
    f.gates.forEach(gate => gate.release());
    await info.attach('request-classification', { body:JSON.stringify({ requests:f.requests, forbidden:f.forbidden, errors:f.errors }, null, 2), contentType:'application/json' });
    expect(f.forbidden).toEqual([]); expect(f.errors).toEqual([]);
  };
  return f;
}
// Passive geometry/identity observer. No focus, scroll, renderer, state or clock mutation.
function observeBonusHistoryFocus(original, expectedText = '') {
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
      const ready = !expectedText || element.closest('tr')?.textContent.includes(expectedText);
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

async function armBonusObservation(target, expectedText = '') {
  return target.evaluate((element, { source, expectedText }) => {
    const observe = new Function('return (' + source + ')')();
    const state = window.__bonusFocusEvidence = { original:element, began:performance.now(), removed:false, events:[] };
    const mutations = new MutationObserver(records => { for (const record of records) for (const removed of record.removedNodes)
      if (removed === element || removed.contains?.(element)) state.removed = true; });
    mutations.observe(document.querySelector('[data-bonus-history-rows]'), { childList:true, subtree:true });
    const onFocus = event => state.events.push({ type:event.type, tag:event.target.tagName, original:event.target === element, at:performance.now() });
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('keydown', event => { state.key = { key:event.key, trusted:event.isTrusted, at:performance.now() }; }, { capture:true, once:true });
    state.promise = observe(element, expectedText).then(proof => { mutations.disconnect(); document.removeEventListener('focusin', onFocus, true);
      return { proof, key:state.key, events:state.events, removed:state.removed, began:state.began, ended:performance.now(),
        connected:element.isConnected, active:document.activeElement === element }; });
    return state.began;
  }, { source:observeBonusHistoryFocus.toString(), expectedText });
}
async function readBonusObservation(page, info, label, { native = false, retained = true } = {}) {
  const result = await page.evaluate(() => window.__bonusFocusEvidence.promise);
  await info.attach(label, { body:JSON.stringify(result, null, 2), contentType:'application/json' });
  expect(result.proof.pass, JSON.stringify(result)).toBe(true); expect(result.ended - result.began).toBeLessThanOrEqual(1000);
  expect(result.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);
  expect(result.connected && result.active).toBe(true); if (retained) expect(result.removed).toBe(false);
  if (native) { expect(result.key?.key).toBe('Tab'); expect(result.key.trusted).toBe(true); }
  return result;
}
async function nativeBonusRecipient(page, info, index = 0, label = 'original-native-entry') {
  const target = await page.locator(bonusRecipient).nth(index).elementHandle(); expect(target).not.toBeNull();
  await page.locator(bonusCategory).click(); await page.keyboard.press('Escape');
  let next = false;
  for (let i = 0; i < 30; i++) {
    next = await target.evaluate(element => {
      const all = [...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')]
        .filter(node => node.tabIndex >= 0 && !node.disabled && !node.closest('[hidden],[inert]') && node.getClientRects().length && getComputedStyle(node).visibility === 'visible');
      const at = all.indexOf(document.activeElement); return at >= 0 && all[at + 1] === element;
    });
    if (next) break; await page.keyboard.press('Tab');
  }
  expect(next).toBe(true); await armBonusObservation(target); await page.keyboard.press('Tab');
  await readBonusObservation(page, info, label, { native:true }); return target;
}
async function releaseBonusRetained(page, gate, original, info, label, expectedText) {
  await armBonusObservation(original, expectedText); gate.release();
  await readBonusObservation(page, info, label);
  expect(await original.evaluate(element => element.isConnected && document.activeElement === element)).toBe(true);
}
async function bonusSnapshot(page, info, label) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path:info.outputPath(label + '.png'), fullPage:false });
  await info.attach(label + '-history', { body:JSON.stringify(await page.locator(bonusHistoryRows).evaluate(element => ({
    text:element.textContent, page:location.href, category:document.querySelector('[data-bonus-history-category]').value,
    documentOverflow:document.documentElement.scrollWidth > innerWidth,
    recipients:[...element.querySelectorAll('tbody td:nth-child(2) a')].map(link => ({ href:link.getAttribute('href'), text:link.textContent }))
  })), null, 2), contentType:'application/json' });
}
test.describe('FQA-071 original bonus history ownership', () => {
  test.describe.configure({ timeout:60000 });
  for (const width of [390,1440]) {
    test(`ordinary scheduled read updates/reorders seven cells around exact recipient at${width}`, async ({ page }, info) => {
      const sameWalletOtherReceipt = bonusReceipt({ signature:'4'.repeat(64), amount:'201' });
      const f = await bonusOwnershipFixture(page, width, [sameWalletOtherReceipt, bonusReceipt()]);
      try {
        await f.open(); const original = await nativeBonusRecipient(page, info, 1);
        const row = await original.evaluateHandle(element => element.closest('tr'));
        const gate = f.hold(); await gate.ready; // Actual unmodified30s background GET; no browser clock override.
        const dashboard = f.requests.filter(request => request.path === '/api/daily-bonus/dashboard');
        expect(dashboard.at(-1).at - dashboard[0].at).toBeGreaterThanOrEqual(28000);
        expect(gate.request).toEqual({ category:'all', page:1 });
        f.rows = [bonusReceipt({ amount:'150', day:'qa5m:2026-10-18T16:25:00Z@abcdef012345' }), sameWalletOtherReceipt];
        await releaseBonusRetained(page, gate, original, info, 'same-owner-response-full-outline', '0.00000015 SOL');
        expect(await row.evaluate(element => element.isConnected && element === document.querySelector('[data-bonus-history-rows] tbody tr'))).toBe(true);
        await expect(page.locator(`${bonusHistoryRows} th`)).toHaveText(['UTC snapshot','Wallet','Wallet received','Creator bonus','Referral bonus','Trader bonus','Receipt']);
        await expect(page.locator(`${bonusHistoryRows} tbody tr`).first().locator('td')).toHaveText([
          '2026-10-18 · 16:25–16:30 UTC · QA', '22222…22222', '0.00000015 SOL','0.00000015 SOL','0 SOL','0 SOL','Transaction ↗']);
        await expect(page.locator(`${bonusHistoryRows} tbody tr`).first().locator('td').first()).toHaveAttribute('title','qa5m:2026-10-18T16:25:00Z@abcdef012345');
        await expect(page.locator(`${bonusHistoryRows} tbody tr`).first().locator('td').last().locator('a')).toHaveAttribute('href',f.rows[0].href);
        await expect(page.locator(`${bonusHistoryRows} tbody tr`).first().locator('td').last().locator('a')).toHaveAttribute('rel','noopener noreferrer');
        await bonusSnapshot(page, info, 'retained-updated-order-' + width);
        await page.keyboard.press('Enter'); await expect(page).toHaveURL(new RegExp('/wallet/' + wallet + '$'));
      } finally { await f.finish(info); }
    });
    test(`receipt aliases update proof and ambiguous bridges never reuse another payment at${width}`, async ({ page }, info) => {
      const account = '5'.repeat(44), other = '6'.repeat(44), signature = '7'.repeat(64);
      const f = await bonusOwnershipFixture(page, width, [bonusReceipt({ signature:null, paymentAccount:account })]);
      try {
        await f.open(); const original = await nativeBonusRecipient(page, info);
        for (const [index, receipt] of [bonusReceipt({ signature, paymentAccount:account, amount:'151' }), bonusReceipt({ signature, amount:'152' })].entries()) {
          const gate = await f.trigger(); await nativeBonusRecipient(page, info, 0, 'alias-native-entry-' + index);
          f.rows = [receipt]; await releaseBonusRetained(page, gate, original, info, 'alias-update-' + index, index ? '0.000000152 SOL' : '0.000000151 SOL');
          await expect(page.locator(`${bonusHistoryRows} td:last-child a`)).toHaveAttribute('href',receipt.href);
          await expect(page.locator(`${bonusHistoryRows} td:last-child a`)).toHaveText('Transaction ↗');
        }
        // Establish two distinct same-wallet receipts before presenting a merge bridge.
        let gate = await f.trigger(); f.rows = [bonusReceipt({ signature, amount:'153' }), bonusReceipt({ signature:null, paymentAccount:other, amount:'201' })];
        gate.release(); await expect(page.locator(bonusRecipient)).toHaveCount(2);
        const bridgeOriginal = await nativeBonusRecipient(page, info);
        gate = await f.trigger(); await nativeBonusRecipient(page, info);
        f.rows = [bonusReceipt({ signature, paymentAccount:other, amount:'154' })];
        const selector = await page.locator(bonusCategory).elementHandle(); await armBonusObservation(selector); gate.release();
        await readBonusObservation(page, info, 'ambiguous-bridge-fallback', { retained:false });
        expect(await bridgeOriginal.evaluate(element => element.isConnected)).toBe(false);
        await expect(page.locator(bonusRecipient)).toHaveCount(1);
        // Duplicate aliases and missing identity are rendered independently, not merged.
        gate = await f.trigger(); f.rows = [bonusReceipt({ signature, amount:'155' }), bonusReceipt({ signature, amount:'156' }), bonusReceipt({ signature:null, amount:'157' })];
        gate.release(); await expect(page.locator(bonusRecipient)).toHaveCount(3);
        await expect(page.locator(`${bonusHistoryRows} tbody tr td:nth-child(3)`)).toHaveText(['0.000000155 SOL','0.000000156 SOL','0.000000157 SOL']);
        const duplicateOriginal = await nativeBonusRecipient(page, info);
        gate = await f.trigger(); await nativeBonusRecipient(page, info);
        f.rows = [bonusReceipt({ signature, amount:'158' })];
        await armBonusObservation(selector); gate.release(); await readBonusObservation(page, info, 'duplicate-to-single-fallback', { retained:false });
        expect(await duplicateOriginal.evaluate(element => element.isConnected)).toBe(false);
        await expect(page.locator(`${bonusHistoryRows} tbody tr td:nth-child(3)`)).toHaveText('0.000000158 SOL');
        await bonusSnapshot(page, info, 'alias-and-ambiguity-' + width);
      } finally { await f.finish(info); }
    });
    test(`focused insertion preserves identity and split or missing identities are never aliased at${width}`, async ({ page }, info) => {
      const account = '6'.repeat(44), signature = '5'.repeat(64), who = '8'.repeat(44);
      const own = bonusReceipt({ signature, paymentAccount:account });
      const f = await bonusOwnershipFixture(page, width, [own]);
      try {
        await f.open(); const original = await nativeBonusRecipient(page, info);
        let gate = await f.trigger(); await nativeBonusRecipient(page, info);
        // Same tx for another wallet and another receipt for same wallet are distinct.
        f.rows = [bonusReceipt({ signature, who, amount:'170' }), { ...own, receivedLamports:'171' }, bonusReceipt({ signature:'7'.repeat(64), amount:'172' })];
        await releaseBonusRetained(page, gate, original, info, 'focused-row-sibling-insertion', '0.000000171 SOL');
        expect(await original.evaluate(element => element === document.querySelectorAll('[data-bonus-history-rows] tbody td:nth-child(2) a')[1])).toBe(true);
        await expect(page.locator(bonusRecipient)).toHaveCount(3);
        gate = await f.trigger(); await nativeBonusRecipient(page, info, 1);
        f.rows = [bonusReceipt({ signature, amount:'173' }), bonusReceipt({ signature:null, paymentAccount:account, amount:'174' })];
        const selector = await page.locator(bonusCategory).elementHandle(); await armBonusObservation(selector); gate.release();
        await readBonusObservation(page, info, 'split-alias-fallback', { retained:false });
        expect(await original.evaluate(element => element.isConnected)).toBe(false);
        await expect(page.locator(bonusRecipient)).toHaveCount(2);
        gate = await f.trigger(); f.rows = [bonusReceipt({ signature:null, amount:'175' })]; gate.release();
        await expect(page.locator(bonusRecipient)).toHaveCount(1);
        const unkeyed = await nativeBonusRecipient(page, info);
        gate = await f.trigger(); await nativeBonusRecipient(page, info); f.rows = [bonusReceipt({ signature:null, amount:'176' })];
        await armBonusObservation(selector); gate.release(); await readBonusObservation(page, info, 'missing-key-fallback', { retained:false });
        expect(await unkeyed.evaluate(element => element.isConnected)).toBe(false);
        await expect(page.locator(`${bonusHistoryRows} tbody td:nth-child(3)`)).toHaveText('0.000000176 SOL');
        await bonusSnapshot(page, info, 'insertion-split-missing-' + width);
      } finally { await f.finish(info); }
    });
    for (const state of ['removed','empty','unavailable']) test(`genuine ${state} clears truthful history and falls back only from original owner at${width}`, async ({ page }, info) => {
      const f = await bonusOwnershipFixture(page, width);
      try {
        await f.open(); const original = await nativeBonusRecipient(page, info);
        const gate = await f.trigger(); await nativeBonusRecipient(page, info);
        if (state === 'unavailable') gate.status = 503;
        else f.rows = state === 'empty' ? [] : [bonusReceipt({ signature:'8'.repeat(64), who:'9'.repeat(44), amount:'160' })];
        const selector = await page.locator(bonusCategory).elementHandle(); await armBonusObservation(selector); gate.release();
        const fallback = await readBonusObservation(page, info, 'removed-original-to-category', { retained:false });
        expect(fallback.events.filter(event => event.original)).toHaveLength(1);
        expect(await original.evaluate(element => element.isConnected)).toBe(false);
        if (state === 'unavailable') { await expect(page.locator(bonusHistoryRows)).toBeEmpty(); await expect(page.locator('[data-bonus-history-status]')).toContainText('unavailable'); }
        else if (state === 'empty') await expect(page.locator(bonusHistoryRows)).toHaveText('No finalized bonus payouts in this category.');
        else await expect(page.locator(bonusRecipient)).toHaveAttribute('href','/wallet/' + '9'.repeat(44));
        const recovery = await f.trigger(); f.rows = [bonusReceipt({ amount:'161' })]; recovery.release();
        await expect(page.locator(`${bonusHistoryRows} tbody td:nth-child(3)`)).toHaveText('0.000000161 SOL');
        await nativeBonusRecipient(page, info, 0, 'native-recovered-recipient');
        await bonusSnapshot(page, info, state + '-recovered-' + width);
        await page.keyboard.press('Enter'); await expect(page).toHaveURL(new RegExp('/wallet/' + wallet + '$'));
      } finally { await f.finish(info); }
    });
    test(`unfocused updates and mismatched or missing response metadata never steal focus at${width}`, async ({ page }, info) => {
      const f = await bonusOwnershipFixture(page, width);
      try {
        await f.open();
        let gate = await f.trigger(); const refreshOwner = await page.locator(bonusRefresh).elementHandle();
        f.rows = []; gate.release(); await expect(page.locator(bonusHistoryRows)).toContainText('No finalized');
        expect(await refreshOwner.evaluate(element => element.isConnected && document.activeElement === element)).toBe(true);
        gate = await f.trigger(); gate.status = 503; gate.release(); await expect(page.locator(bonusHistoryRows)).toBeEmpty();
        expect(await refreshOwner.evaluate(element => document.activeElement === element)).toBe(true);
        gate = await f.trigger(); f.rows = [bonusReceipt()]; gate.release(); await expect(page.locator(bonusRecipient)).toHaveCount(1);
        for (const [index, owner] of [{ category:'creators', page:1 }, { category:null, page:null }, { category:'all', page:2 }].entries()) {
          const original = await nativeBonusRecipient(page, info, 0, 'metadata-entry-' + index);
          gate = await f.trigger(); await nativeBonusRecipient(page, info, 0, 'metadata-reentry-' + index);
          f.ownerOverride = owner; gate.release();
          await expect.poll(() => original.evaluate(element => element.isConnected)).toBe(false);
          expect(await page.locator(bonusCategory).evaluate(element => document.activeElement === element)).toBe(false);
          f.ownerOverride = null; gate = await f.trigger(); gate.release(); await expect(page.locator(bonusRecipient)).toHaveCount(1);
        }
        await bonusSnapshot(page, info, 'unfocused-owner-metadata-' + width);
      } finally { await f.finish(info); }
    });
    test(`native category page and route leave cancel ownership and older responses at${width}`, async ({ page }, info) => {
      const f = await bonusOwnershipFixture(page, width);
      try {
        await f.open(); const original = await nativeBonusRecipient(page, info);
        const old = await f.trigger(); old.snapshot = { history:{ ...fixture().history, rows:[bonusReceipt({ amount:'140' })] } };
        await nativeBonusRecipient(page, info);
        const newer = f.hold(); await page.locator(bonusCategory).click(); await page.keyboard.press('c'); await page.keyboard.press('Enter');
        await expect(page.locator(bonusCategory)).toHaveValue('creators'); await newer.ready;
        f.rows = [bonusReceipt({ amount:'162' })]; newer.release(); await expect(page.locator(`${bonusHistoryRows} tbody td:nth-child(3)`)).toHaveText('0.000000162 SOL');
        expect(await original.evaluate(element => element.isConnected)).toBe(false); expect(await page.locator(bonusCategory).evaluate(element => document.activeElement === element)).toBe(true);
        old.release(); await old.completed; // Existing serial/abort must prevent this older read from reclaiming a row/owner.
        await expect(page.locator(bonusCategory)).toHaveValue('creators'); await expect(page.locator(`${bonusHistoryRows} tbody td:nth-child(3)`)).toHaveText('0.000000162 SOL');
        let gate = f.hold(); await page.locator('[data-bonus-next]').click(); await gate.ready;
        expect(gate.request).toEqual({ category:'creators', page:2 });
        const nextOwner = await page.locator('[data-bonus-next]').elementHandle();
        f.ownerOverride = { category:'creators', page:1 }; gate.release(); // Page clamp does not inherit old owner.
        await expect(page.locator('[data-bonus-page]')).toContainText('Page 1');
        expect(await page.locator(bonusCategory).evaluate(element => document.activeElement === element)).toBe(false);
        expect(await nextOwner.evaluate(element => document.activeElement === element)).toBe(true);
        f.ownerOverride = null;
        const leaving = await nativeBonusRecipient(page, info, 0, 'before-route-leave'); gate = await f.trigger(); await nativeBonusRecipient(page, info);
        if (width < 700) await page.getByRole('navigation',{ name:'Mobile workspace' }).getByRole('link',{ name:'Home', exact:true }).click();
        else await page.locator('#sidebar a.nav-item[href="#overview"]').click();
        await expect(page).toHaveURL(/#overview$/);
        const outside = await page.evaluateHandle(() => document.activeElement);
        gate.release(); await expect.poll(() => leaving.evaluate(element => element.isConnected)).toBe(false);
        expect(await outside.evaluate(element => element.isConnected && document.activeElement === element)).toBe(true);
        await page.locator('#home-daily-bonuses a[href="#bonuses"]').first().click(); await expect(page).toHaveURL(/#bonuses$/);
        await nativeBonusRecipient(page, info, 0, 'after-native-route-return');
        await bonusSnapshot(page, info, 'owner-leave-return-' + width);
      } finally { await f.finish(info); }
    });
  }
});
