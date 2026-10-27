import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const wallet = 'ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC';
const mint = 'EtMFvbnLJMmp4PWqDVSqYzWfkWhZy3FznJQTN35rYWPc';
const xSignature = '3'.repeat(64);
const holderSignature = '4'.repeat(64);
const bonusSignature = '5'.repeat(64);
const payment = '6'.repeat(32);

for (const [referralStatus, hasDailyReceipt] of [[200, true], [401, true], [503, true], [401, false]]) test(`wallet profile Daily bonus receipt ${hasDailyReceipt} with referral HTTP ${referralStatus}`, async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status:503, json:{ error:'mocked unavailable' } }));
  await page.route('**/api/fee-policy', route => route.fulfill({ json:{ split:PROTOCOL_FEE_SPLIT } }));
  await page.route('**/api/launches', route => route.fulfill({ json:[{
    mint, symbol:'QA', name:'QA token', creatorWallet:wallet, cluster:'devnet', onchainVerified:true,
  }] }));
  await page.route('**/api/rewards/experience*', route => route.fulfill({ json:{
    cluster:'devnet', evidence:{ status:'recorded-finalized-v3' },
    wallet:{ address:wallet, rows:[{ mint, symbol:'QA', payouts:[
      { kind:'x', wallet, signature:xSignature, amountLamports:'123127',
        paidAt:'2026-10-14T02:00:00Z', feeSourceVerified:true },
      { kind:'holder', wallet, signature:holderSignature, amountLamports:'250000',
        paidAt:'2026-10-14T01:00:00Z', feeSourceVerified:true },
      { kind:'holder', wallet, signature:'7'.repeat(64), amountLamports:'900000',
        feeSourceVerified:false },
    ] }] },
  } }));
  await page.route('**/api/airdrops/reserves', route => route.fulfill({ json:{
    cluster:'devnet', reserves:[{ mint, verified:true, status:'drop-closed',
      reservedTokens:'100', totalBaseUnits:'100000000' }],
  } }));
  await page.route('**/api/airdrops/claims/proof**', route => route.fulfill({ json:{
    status:'claimed', recipient:wallet, amount:'12500000', payment,
  } }));
  await page.route('**/api/referral-claims?wallet=*', route => referralStatus === 200 ? route.fulfill({ json:{
    wallet, claims:[{ status:'paid', finalized:true, balanceDeltaVerified:true,
      recipientWallet:wallet, asset:'SOL', level:2,
      amount:'0.2', payoutSignature:bonusSignature, paidAt:'2026-10-14T00:00:00Z' }],
  } }) : route.fulfill({ status:referralStatus, json:{ error:'Referral fixture unavailable' } }));
  const dailyPayment = { amount:'500000', amountReceived:'450000', finalized:true, balanceDeltaVerified:true,
    signature:'8'.repeat(64), payment:'9'.repeat(32), paidAt:'2026-10-17T12:00:00Z' };
  await page.route('**/api/daily-bonus', route => route.fulfill({ json:{ cluster:'devnet', snapshots:[{
    day:'2026-10-17', status:'snapshotted', hash:'c'.repeat(64), allocatedLamports:'500000', retainedLamports:'0',
    rankings:{ creators:[], referrals:[], traders:[] }, sources:hasDailyReceipt ? [
      { status:'paid', mint, payments:{ [wallet]:{ ...dailyPayment, signature:null } } },
      { status:'paid', mint, payments:{ [wallet]:{ ...dailyPayment, payment:null } } },
      { status:'paid', mint, payments:{ [wallet]:dailyPayment,
      [mint]:{ ...dailyPayment, amount:'9000000000', amountReceived:'9000000000', signature:'A'.repeat(64) } } },
      { status:'paid', mint, payments:{ [wallet]:dailyPayment } },
      { status:'distributing', mint, payments:{ [wallet]:{ ...dailyPayment, finalized:false, signature:'B'.repeat(64) } } }] : [],
  }] } }));
  await page.addInitScript(address => {
    const listeners = new Map();
    const provider = {
      isPhantom:true, isConnected:false, publicKey:null,
      signTransaction:async transaction => transaction,
      on(event, callback) { listeners.set(event, [...(listeners.get(event) || []), callback]); },
      async connect(options = {}) {
        if (options.onlyIfTrusted) throw new Error('Not trusted');
        provider.publicKey = { toBase58:() => address };
        provider.isConnected = true;
        for (const callback of listeners.get('connect') || []) callback(provider.publicKey);
        return { publicKey:provider.publicKey };
      },
      async disconnect() {
        provider.isConnected = false; provider.publicKey = null;
        for (const callback of listeners.get('disconnect') || []) callback();
      },
    };
    window.phantom = { solana:provider };
    window.solana = provider;
  }, wallet);

  await page.goto(`/wallet/${wallet}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('#connect-button').click();
  await page.locator('[data-wallet-choice="phantom"]').click();
  await expect(page.locator('#wallet-self-badge')).toBeVisible();
  await expect(page.locator('#wallet-detail-content .wallet-activity-row')).toHaveCount((referralStatus === 200 ? 6 : 5) - (hasDailyReceipt ? 0 : 1));
  for (const [filter, label] of [
    ['claim','X reward claimed'], ['reward','Holder reward received'],
    ['airdrop','Community airdrop claimed'], ['bonus',hasDailyReceipt ? 'Daily bonus received' : 'Bonus history incomplete'],
  ]) {
    await page.locator(`[data-wallet-filter="${filter}"]`).click();
    await expect(page.locator('#wallet-detail-content .wallet-activity-row')).toHaveCount(filter === 'bonus' ? (hasDailyReceipt ? 1 : 0) + (referralStatus === 200 ? 1 : 0) : 1);
    await expect(page.locator('#wallet-detail-content')).toContainText(label);
  }
  await page.locator('[data-wallet-filter="bonus"]').click();
  const content = page.locator('#wallet-detail-content');
  if (hasDailyReceipt) await expect(content).toContainText('0.00045 SOL');
  else expect((await content.textContent()).split('Verify this wallet in Referrals').length - 1).toBe(1);
  await expect(content).not.toContainText('9 SOL');
  await expect(page.locator('[data-wallet-bonus-coverage]')).toContainText('up to 30 published UTC snapshots');
  await expect(page.locator('[data-wallet-bonus-coverage]')).toContainText(referralStatus === 200 ? 'Referral bonus records loaded'
    : referralStatus === 401 ? 'Verify this wallet in Referrals' : 'Referral bonus history is unavailable');
  await page.setViewportSize({ width:390, height:844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path:test.info().outputPath('wallet-daily-bonus-mocked.png'), fullPage:true });
  await page.locator('#connect-button').click();
  await page.locator('#wallet-popover-disconnect').click();
  await expect(page.locator('[data-wallet-filter="bonus"]')).toBeHidden();
  await expect(page.locator('#wallet-detail-content')).not.toContainText('Referral bonus received');
  await expect(page.locator('#wallet-detail-content')).not.toContainText('Daily bonus received');
});

// FQA-066: actual bootstrap, read-only controlled startup responses. Neither
// renderers nor application state, timers, focus or scroll are changed by tests.
const createdWallet = '8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk';
const createdMints = [
  '4r3yqXhj7v4fVSFNTvEKUmn1WovnL8aHdk8hUGLbpXGq',
  'H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z',
  'BHFsQA2xqgGXVuHeTngQY8t6mNaaHwVZdXcYuzigNAHK',
];
const createdRegistry = () => createdMints.map((mint, index) => ({ mint,
  creatorWallet:createdWallet, onchainVerified:true, cluster:'devnet',
  name:`Created fixture ${index + 1}`, symbol:`CF${index + 1}`,
  createdAt:`2026-10-${20 - index}T00:00:00Z`,
}));

// Starts before the native action. Include the actual outline (negative offsets
// included), fixed chrome and each ancestor's clipping client box on both axes.
function observeCreatedFocus(selector) {
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

async function createdReads(page, { unavailable = false, rows = createdRegistry(), holdPriorArtwork = false } = {}) {
  const generation = id => ({ id, ordinal:0, closing:false, held:[], inFlight:new Set() });
  let current = generation(0);
  const generations = new Map([[0, current]]), requests = [], completedImages = [];
  page.on('requestfinished', request => { if (new URL(request.url()).pathname === `/devnet-images/${createdMints[0]}`) completedImages.push(request.url()); });
  page.on('response', response => {
    if (response.headers()['x-fqa066-phase'] !== 'initial') return;
    const id = Number(response.headers()['x-fqa066-generation']), state = generations.get(id);
    if (!state) return;
    response.json().then(body => { state.proof = { generation:id, status:response.status(),
      contentType:response.headers()['content-type'], body }; }).catch(error => { state.proofError = error.message; });
  });
  await page.route('**/*', async route => {
    // One persistent transport; every pending handler owns its document fixture.
    const state = current;
    const task = (async () => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!['GET', 'HEAD'].includes(request.method())) return route.fulfill({ status:503, json:{ error:'No writes in read-only fixture' } });
    if (path.startsWith('/devnet-images/')) {
      if (holdPriorArtwork && path === `/devnet-images/${createdMints[0]}` && url.protocol === 'http:') {
        await new Promise(resolve => state.held.push(Object.assign(resolve, { oldImage:true })));
      }
      return state.closing ? route.abort() : route.fulfill({ contentType:'image/svg+xml',
        body:`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${url.protocol === 'https:' ? '#f4a340' : '#26354d'}"/></svg>` });
    }
    if (path.startsWith('/api/')) {
      requests.push(path);
      if (path === '/api/fee-policy') return route.fulfill({ json:{ split:PROTOCOL_FEE_SPLIT } });
      if (path === '/api/market/sol-usd') {
        await new Promise(resolve => { state.quoteRelease = resolve; state.held.push(resolve); });
        return state.closing ? route.abort() : route.fulfill({ json:{ priceUsd:150 } });
      }
      if (path === '/api/launches') {
        const index = ++state.ordinal;
        // Existing navigation/explore startup callers both issue this read.
        if (index === 2) return route.fulfill({ headers:{ 'x-fqa066-generation':String(state.id), 'x-fqa066-phase':'initial' },
          ...(unavailable ? { status:503, json:{ error:'Initial registry unavailable' } } : { json:rows }) });
        const response = await new Promise(resolve => state.held.push(Object.assign(resolve, { registry:index === 1 })));
        return state.closing ? route.abort() : route.fulfill(response);
      }
      return route.fulfill({ status:503, json:{ error:'Explicit unavailable read fixture' } });
    }
    if (url.protocol === 'https:') return route.abort();
    return route.continue();
    })();
    state.inFlight.add(task);
    try { await task; } finally { state.inFlight.delete(task); }
  });
  const close = state => { state.closing = true; state.held.forEach(release => release({ status:503, json:{} })); };
  return { requests,
    async ready() {
      const state = current;
      await expect.poll(() => state.ordinal >= 2 && Boolean(state.quoteRelease) && Boolean(state.proof)).toBe(true);
      expect(state.proofError).toBeUndefined(); expect(state.proof.generation).toBe(state.id);
      expect(state.proof.contentType).toMatch(/^application\/json/);
      expect(state.proof.status).toBe(unavailable ? 503 : 200);
      expect(state.proof.body).toEqual(unavailable ? { error:'Initial registry unavailable' } : JSON.parse(JSON.stringify(rows)));
    },
    proof() { return current.proof; },
    async quote() { const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/market/sol-usd'); current.quoteRelease(); await (await response).finished(); },
    async registry(response) { const observed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/launches'); const release = current.held.find(callback => callback.registry && !callback.used); expect(release).toBeTruthy(); release.used = true; release(response); await (await observed).finished(); },
    pendingOldArtwork() { return current.held.filter(callback => callback.oldImage).length; },
    async releaseOldArtwork() { const response = page.waitForResponse(r => new URL(r.url()).pathname === `/devnet-images/${createdMints[0]}` && new URL(r.url()).protocol === 'http:'); current.held.filter(callback => callback.oldImage).forEach(release => release()); await (await response).finished(); },
    completedImages,
    async nextDocument() { const previous = current; close(previous); await Promise.all([...previous.inFlight]); current = generation(previous.id + 1); generations.set(current.id, current); },
    close() { for (const state of generations.values()) close(state); },
  };
}

async function createdEntry(page, testInfo) {
  await page.locator('body.workspace-ready.product-experience-ready.page-route-wallet').waitFor();
  await page.locator('[data-wallet-tab="created"]').click();
  // Do not await the observation until after the final native action.
  const observation = page.evaluate(observeCreatedFocus, '#wallet-detail-content a');
  await page.keyboard.press('Tab');
  const result = await observation;
  await testInfo.attach('whole-painted-entry', { body:JSON.stringify(result), contentType:'application/json' });
  expect(result.pass).toBe(true);
  await page.screenshot({ path:testInfo.outputPath('created-native-entry.png') });
  return page.locator('#wallet-detail-content a').first().elementHandle();
}

for (const viewport of [{ width:360, height:740 }, { width:390, height:844 }, { width:1440, height:900 }]) {
  test(`Created links preserve native focus through quote and reordered registry reads ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); const reads = await createdReads(page);
    try {
      await page.goto(`/wallet/${createdWallet}`); await reads.ready();
      await expect(page.locator('#wallet-stat-launches')).toHaveText('3');
      const original = await createdEntry(page, testInfo), href = await original.getAttribute('href');
      const originalAge = await original.$eval('b small', e => e.textContent);
      const quoteObservation = page.evaluate(observeCreatedFocus, '#wallet-detail-content a');
      await reads.quote(); expect((await quoteObservation).pass).toBe(true);
      expect(await original.evaluate(e => e.isConnected && e === document.activeElement)).toBe(true);
      const changed = createdRegistry(); changed[0].name = 'Updated created token'; changed[0].symbol = 'NEW';
      changed[0].createdAt = '2020-01-01T00:00:00Z';
      changed[0].imageUri = `https://metadata.funded.vip/devnet-images/${createdMints[0]}`;
      const observation = page.evaluate(observeCreatedFocus, `#wallet-detail-content a[data-token-mint="${createdMints[0]}"]`);
      await reads.registry({ json:changed });
      await expect(page.locator('#wallet-detail-content a').last()).toContainText('Created Updated created token');
      expect(await original.evaluate(e => e.isConnected && e === document.activeElement)).toBe(true);
      expect(await original.getAttribute('href')).toBe(href);
      await expect(page.locator('#wallet-detail-content a').last().locator('b small')).not.toHaveText(originalAge);
      await expect(page.locator('#wallet-detail-content a').last().locator('img')).toHaveAttribute('src', changed[0].imageUri);
      expect((await observation).pass).toBe(true);
      await expect(page.locator('#wallet-detail-content a')).toHaveText([
        /Created fixture 2/, /Created fixture 3/, /Created Updated created token.*NEW.*Verified/,
      ]);
      await page.screenshot({ path:testInfo.outputPath('created-reordered-focus.png') });
      await page.keyboard.press('Enter'); await expect(page).toHaveURL(new RegExp(`${href}$`));
    } finally { reads.close(); }
  });

  for (const empty of [false, true]) test(`Created focused ${empty ? 'empty' : 'removed'} registry falls back once to selected tab ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); const reads = await createdReads(page);
    try {
      await page.goto(`/wallet/${createdWallet}`); await reads.ready();
      await expect(page.locator('#wallet-stat-launches')).toHaveText('3');
      const original = await createdEntry(page, testInfo);
      const observation = page.evaluate(observeCreatedFocus, '[data-wallet-tab="created"]');
      await reads.registry({ json:empty ? [] : createdRegistry().slice(1) });
      await expect(page.locator('[data-wallet-tab="created"]')).toBeFocused();
      expect(await original.evaluate(e => e.isConnected)).toBe(false);
      expect((await observation).pass).toBe(true);
      await expect(page.locator('#wallet-detail-content a')).toHaveCount(empty ? 0 : 2);
      if (empty) await expect(page.locator('#wallet-detail-content')).toContainText('No created coins found');
      await page.screenshot({ path:testInfo.outputPath('created-removal-recovery.png') });
      // A second normal render must not move focus after the user leaves it.
      await page.keyboard.press('Tab'); const after = await page.evaluateHandle(() => document.activeElement);
      const unfocusedObservation = page.evaluate(() => new Promise(resolve => {
        const original = document.activeElement, changes = [];
        const listener = () => changes.push(document.activeElement.tagName);
        document.addEventListener('focusin', listener);
        setTimeout(() => { document.removeEventListener('focusin', listener); resolve({ same:original === document.activeElement, changes }); }, 150);
      }));
      await reads.quote(); await expect.poll(() => after.evaluate(e => e === document.activeElement)).toBe(true);
      expect(await unfocusedObservation).toEqual({ same:true, changes:[] });
    } finally { reads.close(); }
  });

  test(`Created unfocused registry refresh and tab ownership remain isolated ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); const reads = await createdReads(page);
    try {
      await page.goto(`/wallet/${createdWallet}`); await reads.ready();
      await expect(page.locator('#wallet-stat-launches')).toHaveText('3');
      await createdEntry(page, testInfo);
      await page.keyboard.press('Shift+Tab'); await expect(page.locator('[data-wallet-tab="created"]')).toBeFocused();
      const changed = createdRegistry().slice(1);
      await reads.registry({ json:changed });
      await expect(page.locator('#wallet-detail-content a')).toHaveCount(2);
      await expect(page.locator('[data-wallet-tab="created"]')).toBeFocused();
      await page.keyboard.press('ArrowLeft'); await expect(page.locator('[data-wallet-tab="balances"]')).toBeFocused();
      await expect(page.locator('.wallet-balance-grid')).toBeVisible();
      await reads.quote();
      await expect(page.locator('[data-wallet-tab="balances"]')).toBeFocused();
      await expect(page.locator('.wallet-balance-grid')).toContainText('Unavailable');
      await page.keyboard.press('ArrowRight'); await expect(page.locator('[data-wallet-tab="created"]')).toBeFocused();
      await expect(page.locator('#wallet-detail-content a')).toHaveCount(2);
      await expect(page.locator('#wallet-detail-content')).not.toContainText('Created fixture 1');
    } finally { reads.close(); }
  });

  test(`Created failed ordinary registry refresh retains known focused row ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); const reads = await createdReads(page);
    try {
      await page.goto(`/wallet/${createdWallet}`); await reads.ready();
      await expect(page.locator('#wallet-stat-launches')).toHaveText('3');
      const original = await createdEntry(page, testInfo);
      const observation = page.evaluate(observeCreatedFocus, '#wallet-detail-content a');
      await reads.registry({ status:503, json:{ error:'Registry refresh unavailable; preserve known records' } });
      expect((await observation).pass).toBe(true);
      expect(await original.evaluate(e => e.isConnected && e === document.activeElement)).toBe(true);
      await expect(page.locator('#wallet-detail-content a')).toHaveCount(3);
      await expect(page.locator('#wallet-stat-launches')).toHaveText('3');
      await page.keyboard.press('Enter'); await expect(page).toHaveURL(new RegExp(`/token/${createdMints[0]}$`));
    } finally { reads.close(); }
  });
}

test('Created initial unavailable registry remains distinct from a confirmed empty registry', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 }); const reads = await createdReads(page, { unavailable:true });
  try {
    await page.goto(`/wallet/${createdWallet}`); await reads.ready();
    await page.locator('body.workspace-ready.product-experience-ready.page-route-wallet').waitFor();
    await page.locator('[data-wallet-tab="created"]').click();
    await reads.quote();
    await expect(page.locator('#wallet-detail-content')).toContainText('Created coins unavailable');
    await expect(page.locator('#wallet-stat-launches')).toHaveText('—');
    await expect(page.locator('#wallet-detail-content a')).toHaveCount(0);
    await reads.registry({ json:[] });
    await expect(page.locator('#wallet-detail-content')).toContainText('No created coins found');
    await expect(page.locator('#wallet-stat-launches')).toHaveText('0');
    await expect(page.locator('[data-wallet-tab="created"]')).toBeFocused();
  } finally { reads.close(); }
});

test('Created wallet navigation cannot reuse another wallet token rows', async ({ page }, testInfo) => {
  const reads = await createdReads(page);
  try {
    await page.goto(`/wallet/${createdWallet}`); await reads.ready();
    await expect(page.locator('#wallet-stat-launches')).toHaveText('3');
    await createdEntry(page, testInfo);
    await reads.nextDocument();
    await page.goto(`/wallet/${wallet}`); await reads.ready();
    expect(reads.proof().generation).toBe(1);
    await testInfo.attach('second-document-registry-json', { body:JSON.stringify(reads.proof()), contentType:'application/json' });
    await page.locator('body.workspace-ready.product-experience-ready.page-route-wallet').waitFor();
    // A different document/route owns the public profile after address navigation.
    await page.locator('[data-wallet-tab="created"]').click();
    await reads.registry({ json:createdRegistry() });
    await expect(page.locator('#wallet-page-address')).toHaveText(wallet);
    await expect(page.locator('#wallet-detail-content a')).toHaveCount(0);
    await expect(page.locator('#wallet-detail-content')).toContainText('No created coins found');
    await expect(page.locator('[data-wallet-tab="created"]')).toBeFocused();
  } finally { reads.close(); }
});

test('Created same-document wallet switch and disconnect preserve public owner boundaries', async ({ page }, testInfo) => {
  await page.setViewportSize({ width:390, height:844 });
  // Unfunded in-memory provider stub; signing is forbidden and no key exists.
  await page.addInitScript(address => {
    const listeners = new Map();
    const provider = { isPhantom:true, isConnected:false, publicKey:null,
      signTransaction:async () => { throw new Error('Signing forbidden in read-only fixture'); },
      on(event, callback) { listeners.set(event, [...(listeners.get(event) || []), callback]); },
      async connect(options = {}) {
        if (options.onlyIfTrusted) throw new Error('Not trusted');
        provider.publicKey = { toBase58:() => address }; provider.isConnected = true;
        for (const callback of listeners.get('connect') || []) callback(provider.publicKey);
        return { publicKey:provider.publicKey };
      },
      async disconnect() { provider.isConnected = false; provider.publicKey = null;
        for (const callback of listeners.get('disconnect') || []) callback(); },
    };
    window.phantom = { solana:provider }; window.solana = provider;
  }, wallet);
  const rows = [...createdRegistry(), { ...createdRegistry()[0], mint, creatorWallet:wallet, name:'Other wallet token' }];
  const reads = await createdReads(page, { rows });
  try {
    await page.goto(`/wallet/${createdWallet}`); await reads.ready();
    await expect(page.locator('#wallet-stat-launches')).toHaveText('3');
    const previous = await createdEntry(page, testInfo);
    await page.locator('#connect-button').click(); await page.locator('[data-wallet-choice="phantom"]').click();
    await page.locator('#connect-button').click(); await page.locator('#wallet-popover-detail-link').click();
    await expect(page).toHaveURL(new RegExp(`/wallet/${wallet}$`));
    expect(await previous.evaluate(e => e.isConnected)).toBe(false);
    await expect(page.locator('#wallet-self-badge')).toBeVisible();
    await expect(page.locator('#wallet-stat-launches')).toHaveText('1');
    const current = await createdEntry(page, testInfo);
    expect(await current.getAttribute('href')).toBe(`/token/${mint}`);
    await page.locator('#connect-button').click(); await page.locator('#wallet-popover-disconnect').click();
    await expect(page.locator('#wallet-self-badge')).toBeHidden();
    const afterDisconnect = await page.evaluateHandle(() => document.activeElement);
    await reads.registry({ json:rows }); await reads.quote();
    await expect(page.locator('#wallet-detail-content a')).toHaveCount(1);
    expect(await current.evaluate(e => e.isConnected)).toBe(true);
    expect(await afterDisconnect.evaluate(e => e === document.activeElement)).toBe(true);
    await expect(page.locator('#wallet-detail-content')).toContainText('Other wallet token');
    await expect(page.locator('#wallet-detail-content')).not.toContainText('Created fixture');
    await expect(page.locator('#wallet-detail-content')).not.toContainText('Daily bonus received');
  } finally { reads.close(); }
});

for (const viewport of [{ width:360, height:740 }, { width:390, height:844 }, { width:1440, height:900 }]) {
  test(`Created late prior artwork cannot overwrite current registry image ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); const reads = await createdReads(page, { holdPriorArtwork:true });
    try {
      await page.goto(`/wallet/${createdWallet}`); await reads.ready();
      await expect(page.locator('#wallet-stat-launches')).toHaveText('3');
      const original = await createdEntry(page, testInfo);
      await expect.poll(() => reads.pendingOldArtwork()).toBeGreaterThan(0);
      const changed = createdRegistry(), uri = `https://metadata.funded.vip/devnet-images/${createdMints[0]}`;
      changed[0].name = 'Current project artwork'; changed[0].imageUri = uri;
      await reads.registry({ json:changed });
      const row = page.locator(`#wallet-detail-content a[data-token-mint="${createdMints[0]}"]`);
      await expect(row.locator('img')).toHaveAttribute('src', uri);
      expect(await row.locator('img').evaluate(e => e.complete && e.naturalWidth > 0)).toBe(true);
      const observation = page.evaluate(selector => new Promise(resolve => {
        const row = document.querySelector(selector), samples = [], start = performance.now();
        const sample = () => samples.push({ at:performance.now() - start,
          src:row.querySelector('img')?.getAttribute('src'), connected:row.isConnected,
          focused:row === document.activeElement });
        const observer = new MutationObserver(sample); observer.observe(row, { childList:true, subtree:true });
        sample(); setTimeout(() => { sample(); observer.disconnect(); resolve(samples); }, 500);
      }), `#wallet-detail-content a[data-token-mint="${createdMints[0]}"]`);
      await reads.releaseOldArtwork(); const samples = await observation;
      expect(reads.completedImages.some(url => url === new URL(`/devnet-images/${createdMints[0]}`, page.url()).href)).toBe(true);
      expect(samples.every(sample => sample.src === uri && sample.connected && sample.focused)).toBe(true);
      expect(await original.evaluate(e => e.isConnected && e === document.activeElement)).toBe(true);
      await expect(row).toContainText('Created Current project artwork');
      await expect(row.locator('img')).toHaveAttribute('src', uri);
      expect(await row.locator('img').evaluate(e => e.complete && e.naturalWidth > 0)).toBe(true);
      await testInfo.attach('completed-prior-image-and-current-artwork', { body:JSON.stringify({
        generation:reads.proof().generation, completedImageReads:reads.completedImages, samples,
      }), contentType:'application/json' });
      await page.screenshot({ path:testInfo.outputPath('created-current-art-after-old-response.png') });
      await page.keyboard.press('Enter'); await expect(page).toHaveURL(new RegExp(`/token/${createdMints[0]}$`));
    } finally { reads.close(); }
  });
}

// FQA-064 / UX-047: actual-bootstrap identity/balance scope; all provider and transport data are local mocks.
const balanceScopeSelf='ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC';
const balanceScopeOffCurve='5PkGrsC4Q9Hpnc5dhSKvoPtsmcKhYcokQJ5a6CnqWMhQ';
const balanceScopeCaption='Shown only for your connected wallet.';
async function balanceScopeFixture(page,width){
  const {PublicKey}=await import('@solana/web3.js');expect(PublicKey.isOnCurve(new PublicKey(balanceScopeSelf).toBytes())).toBe(true);expect(PublicKey.isOnCurve(new PublicKey(balanceScopeOffCurve).toBytes())).toBe(false);
  const f={reads:[],forbidden:[],errors:[],balances:[],balanceMode:'ready'};
  await page.setViewportSize({width,height:width<700?844:900});
  await page.addInitScript(address=>{
    sessionStorage.setItem('funded.app.wallet.manual-disconnect','1');
    const listeners=new Map(),audit=window.__walletBalanceFixtureAudit={connects:[],signs:[]};
    const provider={isPhantom:true,isConnected:false,publicKey:null,
      on(event,callback){listeners.set(event,[...(listeners.get(event)||[]),callback]);},
      async connect(options={}){audit.connects.push({trustedOnly:options.onlyIfTrusted===true});if(options.onlyIfTrusted)throw Error('Fixture is not trusted');provider.publicKey={toBase58:()=>address};provider.isConnected=true;for(const callback of listeners.get('connect')||[])callback(provider.publicKey);return{publicKey:provider.publicKey};},
      async signTransaction(){audit.signs.push('transaction');throw Error('No signing admitted in balance fixture');},
      async disconnect(){provider.isConnected=false;provider.publicKey=null;for(const callback of listeners.get('disconnect')||[])callback();}
    };
    // No signMessage method: the existing app cannot request an authentication signature or prepare a login.
    window.phantom={solana:provider};window.solana=provider;
  },balanceScopeSelf);
  page.on('pageerror',e=>f.errors.push(e.message));
  const safeRpc=new Set(['getAccountInfo','getMultipleAccounts','getBalance','getTokenAccountsByOwner','getProgramAccounts','getGenesisHash','getSlot','getTokenSupply','getTokenAccountBalance']);
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method(),local=url.origin===new URL(test.info().project.use.baseURL).origin;
    if(!local){if(method==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))return route.continue();f.forbidden.push({method,path:url.origin+url.pathname});return route.abort();}
    if(url.pathname==='/api/solana/rpc'){
      let body;try{body=request.postDataJSON();}catch{}const calls=Array.isArray(body)?body:[body];
      if(method!=='POST'||!calls.length||!calls.every(c=>c&&safeRpc.has(c.method))){f.forbidden.push({method,path:url.pathname,calls});return route.fulfill({status:403,json:{error:'Unknown or mutating RPC blocked'}});}
      f.reads.push({path:url.pathname,method,calls,at:Date.now()});
      const responses=calls.map(c=>{let result;if(c.method==='getBalance'){
        const record={sequence:f.balances.length+1,request,mode:f.balanceMode,address:c.params[0],startedAt:Date.now(),id:c.id};f.balances.push(record);
        if(c.params[0]!==balanceScopeSelf){f.forbidden.push({reason:'No public-address balance lookup admitted',address:c.params[0]});return{jsonrpc:'2.0',id:c.id,error:{code:-32000,message:'Fixture address mismatch'}};}
        if(f.balanceMode==='unavailable')return{jsonrpc:'2.0',id:c.id,error:{code:-32000,message:'Fixture balance not returned'}};
        result={context:{slot:100},value:1250000000};
      }else if(c.method==='getAccountInfo')result={context:{slot:100},value:null};else if(c.method==='getMultipleAccounts')result={context:{slot:100},value:c.params[0].map(()=>null)};else if(c.method==='getProgramAccounts')result=[];else if(c.method==='getTokenAccountsByOwner')result={context:{slot:100},value:[]};else if(c.method==='getGenesisHash')result='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';else if(c.method==='getSlot')result=100;else return{jsonrpc:'2.0',id:c.id,error:{code:-32000,message:'Controlled unavailable read'}};return{jsonrpc:'2.0',id:c.id,result};});
      return route.fulfill({json:Array.isArray(body)?responses:responses[0]});
    }
    if(!['GET','HEAD','OPTIONS'].includes(method)){f.forbidden.push({method,path:url.pathname});return route.fulfill({status:403,json:{error:'No API writes admitted'}});}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    f.reads.push({path:url.pathname,method,at:Date.now()});
    if(url.pathname==='/api/fee-policy')return route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}});
    if(url.pathname==='/api/x/me')return route.fulfill({json:{authenticated:false,configured:true}});
    if(url.pathname==='/api/referrals/session')return route.fulfill({json:{authenticated:false}});
    if(url.pathname==='/api/market/sol-usd')return route.fulfill({json:{priceUsd:100}});
    if(url.pathname==='/api/launches')return route.fulfill({json:[]});
    if(url.pathname==='/api/pump/explore')return route.fulfill({json:{cluster:'devnet',items:[]}});
    if(url.pathname==='/api/airdrops/reserves')return route.fulfill({json:{cluster:'devnet',reserves:[]}});
    if(url.pathname==='/api/rewards/experience')return route.fulfill({json:{cluster:'devnet',wallet:{address:balanceScopeSelf,rows:[]},evidence:{status:'unavailable'}}});
    if(url.pathname==='/api/daily-bonus')return route.fulfill({json:{cluster:'devnet',snapshots:[]}});
    if(url.pathname===`/api/wallets/${balanceScopeSelf}/trades`)return route.fulfill({json:{wallet:balanceScopeSelf,cluster:'devnet',source:'finalized-wallet-pump-trades',coverage:'complete',signatureLimit:50,rowLimit:100,scannedSignatures:0,trades:[]}});
    return route.fulfill({status:503,json:{error:'Controlled unavailable read; no provider forwarded'}});
  });
  f.open=async address=>{await page.goto('/wallet/'+address,{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveClass(/workspace-ready/);await expect(page.locator('#wallet-page-address')).toHaveText(address);const fonts=await page.evaluate(async()=>{await document.fonts.load('600 14px Manrope');await document.fonts.ready;return[...document.fonts].filter(f=>f.family.includes('Manrope')&&f.status==='loaded').map(f=>({family:f.family,weight:f.weight}));});expect(fonts.length).toBeGreaterThan(0);await test.info().attach('actual-fonts-'+address,{body:JSON.stringify(fonts),contentType:'application/json'});};
  f.finish=async()=>{const audit=await page.evaluate(()=>window.__walletBalanceFixtureAudit);await test.info().attach('balance-scope-reads-and-guards',{body:JSON.stringify({reads:f.reads,balances:f.balances.map(({request,...r})=>r),forbidden:f.forbidden,errors:f.errors,provider:audit,qualification:'Actual bootstrap; mocked on-curve provider exposes public identity only, signing stub rejects/no signMessage, read-only RPC/API fixtures; no private keys, real signatures, balances or chain outcomes.'},null,2),contentType:'application/json'});expect.soft(f.forbidden).toEqual([]);expect.soft(f.errors).toEqual([]);expect.soft(audit.signs).toEqual([]);};return f;
}

function observeBalanceScopeFocus(original, readiness = {}) {
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
      const observation=window.__walletBalanceScopeFocus,tab=readiness.tab&&document.querySelector('[data-wallet-tab="'+readiness.tab+'"]');
      const ready=(!readiness.tab||tab?.getAttribute('aria-selected')==='true')
        && (!readiness.content||document.querySelector('#wallet-detail-content')?.textContent.includes(readiness.content))
        && (!readiness.caption||document.querySelector('#wallet-stat-sol-note')?.textContent===readiness.caption)
        && (!readiness.balance||document.querySelector('#wallet-stat-sol')?.textContent===readiness.balance)
        && (!readiness.menu||document.querySelector('#connect-button')?.getAttribute('aria-expanded')==='true')
        && (!readiness.balanceSequence||observation.completedBalanceSequence===readiness.balanceSequence);
      const clear = Boolean(ready && element.isConnected && rect && cornersClear && element === document.activeElement && element.matches(':focus-visible')
        && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
        && rect.left - edge >= bounds.left && rect.right + edge <= bounds.right
        && rect.top - edge >= bounds.top && rect.bottom + edge <= bounds.bottom);
      const now = performance.now(), geometry = JSON.stringify([position, scrollX, scrollY, bounds]);
      if (clear) { if (stationaryAt === null || previous !== geometry) stationaryAt = now; }
      else stationaryAt = null;
      previous = geometry;
      samples.push({ at:now - began, clear, ready, completedBalanceSequence:observation.completedBalanceSequence, position, edge, bounds, clips, root, cornersClear,
        stationaryMs:stationaryAt === null ? 0 : now - stationaryAt });
      if (now - began > 1000) return finish(false);
      if (clear && now - stationaryAt >= 100) return finish(true);
      frame = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => finish(false), 1000);
    frame = requestAnimationFrame(tick);
  });
}


async function armBalanceScope(original,readiness={}){await original.evaluate((element,{source,readiness})=>{
  const state=window.__walletBalanceScopeFocus={began:performance.now(),events:[],removed:false};
  const observer=new MutationObserver(records=>{for(const r of records)for(const node of r.removedNodes)if(node===element||node.contains?.(element))state.removed=true;});observer.observe(document.body,{childList:true,subtree:true});
  const changed=e=>state.events.push({original:e.target===element,id:e.target.id,tab:e.target.dataset.walletTab});document.addEventListener('focusin',changed,true);const key=e=>state.key={key:e.key,trusted:e.isTrusted};document.addEventListener('keydown',key,{capture:true,once:true});
  state.promise=(new Function('return ('+source+')')())(element,readiness).then(proof=>{observer.disconnect();document.removeEventListener('focusin',changed,true);document.removeEventListener('keydown',key,true);return{proof,readiness,key:state.key,events:state.events,removed:state.removed,connected:element.isConnected,active:document.activeElement===element,began:state.began,ended:performance.now()};});
},{source:observeBalanceScopeFocus.toString(),readiness});}
async function balanceScopeProof(page,label,key){const result=await page.evaluate(()=>window.__walletBalanceScopeFocus.promise);await test.info().attach(label,{body:JSON.stringify(result,null,2),contentType:'application/json'});expect(result.proof.pass,JSON.stringify(result)).toBe(true);expect(result.ended-result.began).toBeLessThanOrEqual(1000);expect(result.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);expect(result.active&&result.connected&&!result.removed).toBe(true);expect(result.events.every(e=>e.original)).toBe(true);expect(result.key).toEqual({key,trusted:true});}
async function nativeBalanceScopeEntry(page,selector,readiness={}){
  const original=await page.locator(selector).elementHandle();expect(original).not.toBeNull();await page.locator('#wallet-page-title').click();let next=false;
  for(let n=0;n<120;n++){next=await original.evaluate(e=>{const nodes=[...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')].filter(n=>n.tabIndex>=0&&!n.disabled&&!n.closest('[hidden],[inert]')&&n.getClientRects().length&&getComputedStyle(n).visibility==='visible');return nodes[nodes.indexOf(document.activeElement)+1]===e;});if(next)break;await page.keyboard.press('Tab');}expect(next).toBe(true);await armBalanceScope(original,readiness);await page.keyboard.press('Tab');await balanceScopeProof(page,'native-scope-entry-'+selector,'Tab');return original;
}
async function balanceScopeCaptionProof(page,value,caption,label){
  await expect(page.locator('#wallet-stat-sol')).toHaveText(value);await expect(page.locator('#wallet-stat-sol-note')).toHaveText(caption);await expect(page.locator('#wallet-page')).not.toContainText('Connect this wallet to view balance');
  await page.mouse.wheel(0,-20000);await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
  const result=await page.evaluate(()=>{const note=document.querySelector('#wallet-stat-sol-note'),value=document.querySelector('#wallet-stat-sol'),cell=note.parentElement,css=getComputedStyle(note),rect=note.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(note);const top=Math.max(0,document.querySelector('.topbar')?.getBoundingClientRect().bottom||0),nav=document.querySelector('.mobile-workspace-nav'),bottom=nav?.getClientRects().length?nav.getBoundingClientRect().top:innerHeight;const bounds={left:0,right:innerWidth,top,bottom},clips=[],rootStyle=getComputedStyle(document.documentElement);for(let a=note.parentElement;a;a=a.parentElement){const c=getComputedStyle(a),r=a.getBoundingClientRect(),x=/^(hidden|clip|auto|scroll)$/.test(c.overflowX),y=/^(hidden|clip|auto|scroll)$/.test(c.overflowY);if(!x&&!y)continue;const viewport=a===document.documentElement||a===document.body&&rootStyle.overflowX==='visible'&&rootStyle.overflowY==='visible'&&rootStyle.contain==='none'&&c.contain==='none';if(viewport){clips.push({tag:a.tagName,viewport:true});continue;}const box={left:r.left+a.clientLeft,right:r.left+a.clientLeft+a.clientWidth,top:r.top+a.clientTop,bottom:r.top+a.clientTop+a.clientHeight};if(x){bounds.left=Math.max(bounds.left,box.left);bounds.right=Math.min(bounds.right,box.right);}if(y){bounds.top=Math.max(bounds.top,box.top);bounds.bottom=Math.min(bounds.bottom,box.bottom);}clips.push({tag:a.tagName,id:a.id,x,y,...box});}return{caption:note.textContent,value:value.textContent,label:cell.querySelector('span')?.textContent,sameCell:value.parentElement===cell,noteTag:note.tagName,tabIndex:note.tabIndex,live:note.hasAttribute('aria-live')||Boolean(note.closest('[aria-live]')),font:css.font,clamp:css.webkitLineClamp,textOverflow:css.textOverflow,width:note.clientWidth,scrollWidth:note.scrollWidth,height:note.clientHeight,scrollHeight:note.scrollHeight,rect:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom},lines:[...range.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),top,bottom,bounds,clips,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};});
  await test.info().attach('caption-layout-'+label,{body:JSON.stringify(result,null,2),contentType:'application/json'});expect(result.sameCell).toBe(true);expect(result.label).toBe('SOL balance');expect(result.noteTag).toBe('SMALL');expect(result.tabIndex).toBe(-1);expect(result.live).toBe(false);expect(result.overflow).toBe(false);expect(result.clamp).toBe('none');expect(result.textOverflow).not.toBe('ellipsis');expect(result.scrollWidth).toBeLessThanOrEqual(result.width+1);expect(result.scrollHeight).toBeLessThanOrEqual(result.height+1);expect(result.lines.length).toBeGreaterThan(0);for(const line of result.lines){expect(line.left).toBeGreaterThanOrEqual(result.bounds.left);expect(line.right).toBeLessThanOrEqual(result.bounds.right);expect(line.top).toBeGreaterThanOrEqual(result.bounds.top);expect(line.bottom).toBeLessThanOrEqual(result.bounds.bottom);}await page.screenshot({path:test.info().outputPath(label+'.png')});
}
async function balanceScopeTabs(page,value,caption,label){
  const readiness={caption,balance:value};await nativeBalanceScopeEntry(page,'[data-wallet-tab="activity"]',{...readiness,tab:'activity'});
  for(const[tab,key,content]of[['balances','ArrowRight','Native SOL'],['created','ArrowRight','No created coins found'],['activity','Home',null]]){const original=await page.locator('[data-wallet-tab="'+tab+'"]').elementHandle();await armBalanceScope(original,{...readiness,tab,content});await page.keyboard.press(key);await balanceScopeProof(page,label+'-native-'+tab,key);await expect(page.locator('[data-wallet-tab="'+tab+'"]').first()).toHaveAttribute('aria-selected','true');await expect(page.locator('#wallet-stat-sol')).toHaveText(value);await expect(page.locator('#wallet-stat-sol-note')).toHaveText(caption);if(tab==='balances'){const article=page.locator('#wallet-detail-content .wallet-balance-grid article').first();await expect(article).toContainText('Native SOL');await expect(article.locator('strong')).toHaveText(value==='—'?'Unavailable':value);}}
}
async function connectBalanceScopeMock(page){await page.locator('#connect-button').click();await page.locator('[data-wallet-choice="phantom"]').click();await expect(page.locator('html')).toHaveAttribute('data-connected-wallet',balanceScopeSelf);expect(await page.evaluate(()=>window.__walletBalanceFixtureAudit.signs)).toEqual([]);}

test.describe('FQA-064 connected wallet balance caption scope',()=>{
  test.describe.configure({timeout:60000});test.afterEach(async({page})=>{await page.close();});
  for(const width of[360,390,1440])test(`native public and mocked self identity preserve scoped SOL balance at${width}`,async({page})=>{
    const f=await balanceScopeFixture(page,width);try{
      await f.open(balanceScopeOffCurve);await expect(page.locator('#wallet-self-badge')).toBeHidden();await balanceScopeCaptionProof(page,'—',balanceScopeCaption,'offcurve-public-'+width);expect(f.balances.length).toBe(0);await balanceScopeTabs(page,'—',balanceScopeCaption,'offcurve-public');
      await connectBalanceScopeMock(page);await expect.poll(()=>f.balances.some(r=>r.address===balanceScopeSelf&&r.mode==='ready')).toBe(true);await expect(page.locator('#header-wallet-balance')).toHaveText('1.2500');await expect(page.locator('#wallet-self-badge')).toBeHidden();await expect(page.locator('#wallet-page-address')).toHaveText(balanceScopeOffCurve);await balanceScopeCaptionProof(page,'—',balanceScopeCaption,'connected-other-'+width);await balanceScopeTabs(page,'—',balanceScopeCaption,'connected-other');
      await test.info().attach('first-document-provider',{body:JSON.stringify(await page.evaluate(()=>window.__walletBalanceFixtureAudit)),contentType:'application/json'});
      await f.open(balanceScopeSelf);expect(await page.locator('html').getAttribute('data-connected-wallet') || '').toBe('');const disconnectedProvider=await page.evaluate(()=>({isConnected:window.phantom.solana.isConnected,publicKey:window.phantom.solana.publicKey,connects:window.__walletBalanceFixtureAudit.connects,signs:window.__walletBalanceFixtureAudit.signs}));expect(disconnectedProvider).toEqual({isConnected:false,publicKey:null,connects:[],signs:[]});await expect(page.locator('#wallet-self-badge')).toBeHidden();await balanceScopeCaptionProof(page,'—',balanceScopeCaption,'oncurve-public-'+width);await balanceScopeTabs(page,'—',balanceScopeCaption,'oncurve-public');
      await connectBalanceScopeMock(page);await expect(page.locator('#wallet-self-badge')).toBeVisible();await expect(page.locator('#wallet-stat-sol')).toHaveText('1.2500 SOL');await balanceScopeCaptionProof(page,'1.2500 SOL','Connected wallet balance','self-ready-'+width);await balanceScopeTabs(page,'1.2500 SOL','Connected wallet balance','self-ready');
      const header=await nativeBalanceScopeEntry(page,'#connect-button');f.balanceMode='unavailable';const sequence=f.balances.length+1;const responsePromise=page.waitForResponse(r=>r.request()===f.balances.find(b=>b.sequence===sequence)?.request,{timeout:15000});await armBalanceScope(header,{caption:'Balance currently unavailable',balance:'—',menu:true,balanceSequence:sequence});await page.keyboard.press('Enter');const response=await responsePromise;let timer;const body=await Promise.race([(async()=>{expect(await response.finished()).toBeNull();return response.body();})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Balance response body deadline')),15000);})]).finally(()=>clearTimeout(timer));const decoded=JSON.parse(body.toString()),record=f.balances.find(r=>r.sequence===sequence),reply=(Array.isArray(decoded)?decoded:[decoded]).find(r=>r.id===record.id);expect(reply.error?.message).toBe('Fixture balance not returned');record.bodyCompleteAt=Date.now();record.bodyBytes=body.length;await header.evaluate((element,sequence)=>{window.__walletBalanceScopeFocus.completedBalanceSequence=sequence;},sequence);await balanceScopeProof(page,'self-balance-unavailable-native-menu','Enter');await page.locator('#connect-button').click();await expect(page.locator('#wallet-popover')).toBeHidden();await balanceScopeCaptionProof(page,'—','Balance currently unavailable','self-unavailable-'+width);await balanceScopeTabs(page,'—','Balance currently unavailable','self-unavailable');
      expect(f.balances.every(r=>r.address===balanceScopeSelf)).toBe(true);
    }finally{await f.finish();}
  });
});

// FQA-073: hold only the ordinary post-connect fee GET; no successful fee or quote fixture.
async function walletMetricsResponseBody(response) {
  let timer;
  return Promise.race([(async () => { expect(await response.finished()).toBeNull(); return response.json(); })(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Fee regression response body deadline')), 15000); })]).finally(() => clearTimeout(timer));
}
test.describe('FQA-073 independent wallet balance survives unavailable launch fees', () => {
  test.describe.configure({ timeout:60000 });
  test.afterEach(async ({ page }) => { await page.close(); });
  for (const width of [390, 1440]) test(`held launch fee failure preserves current wallet SOL balance at${width}`, async ({ page }) => {
    const f = await balanceScopeFixture(page, width), held = [], warnings = [];
    let armed = false, closing = false;
    const message = 'FQA073 controlled service fees unavailable';
    page.on('console', entry => { if (entry.type() === 'warning' && entry.text().includes(message)) warnings.push({ text:entry.text(), at:Date.now() }); });
    await page.route('**/api/service-fees', async route => {
      if (!armed) return route.fallback();
      expect(route.request().method()).toBe('GET');
      f.reads.push({ path:'/api/service-fees', method:'GET', held:true, at:Date.now() });
      let release;
      const gate = { request:route.request(), startedAt:Date.now(), release:() => release(), promise:new Promise(resolve => { release = resolve; }) };
      held.push(gate); if (closing) gate.release();
      await gate.promise; gate.releasedAt = Date.now();
      await route.fulfill({ status:503, json:{ error:message } }); gate.fulfilledAt = Date.now();
    });
    const identity = () => page.locator('#header-wallet-balance').evaluate(element => ({
      header:element.textContent, wallet:document.documentElement.dataset.connectedWallet,
      profile:document.querySelector('#wallet-page-address').textContent,
      profileBalance:document.querySelector('#wallet-stat-sol').textContent,
      caption:document.querySelector('#wallet-stat-sol-note').textContent,
    }));
    try {
      await f.open(balanceScopeOffCurve); expect(f.balances.length).toBe(0); armed = true;
      const balanceResponsePromise = page.waitForResponse(response => response.request() === f.balances[0]?.request, { timeout:15000 });
      await connectBalanceScopeMock(page); await expect.poll(() => held.length).toBe(1);
      const balanceResponse = await balanceResponsePromise;
      const balanceBody = await walletMetricsResponseBody(balanceResponse);
      expect(balanceBody.id).toBe(f.balances[0].id); expect(balanceBody.result.value).toBe(1250000000);
      await expect(page.locator('#header-wallet-balance')).toHaveText('1.2500');
      const before = await identity(); expect(before.wallet).toBe(balanceScopeSelf); expect(before.profile).toBe(balanceScopeOffCurve);
      expect(before.profileBalance).toBe('—'); expect(before.caption).toBe(balanceScopeCaption);
      const original = await nativeBalanceScopeEntry(page, '[data-wallet-tab="activity"]', { tab:'activity', caption:balanceScopeCaption, balance:'—' });
      const responsePromise = page.waitForResponse(response => response.request() === held[0].request, { timeout:15000 });
      await armBalanceScope(original, { tab:'activity', caption:balanceScopeCaption, balance:'—', balanceSequence:1 });
      await original.evaluate((element, expected) => {
        const start = performance.now(), state = window.__walletFeeRetention = { bodyComplete:false, samples:[] };
        state.promise = new Promise(resolve => {
          let frame, stationaryAt = null;
          const finish = pass => { cancelAnimationFrame(frame); clearTimeout(timer); resolve({ pass, samples:state.samples }); };
          const sample = () => {
            const now = performance.now(), current = {
              header:document.querySelector('#header-wallet-balance').textContent,
              wallet:document.documentElement.dataset.connectedWallet,
              profile:document.querySelector('#wallet-page-address').textContent,
            };
            const same = current.header === expected.header && current.wallet === expected.wallet && current.profile === expected.profile;
            const clear = state.bodyComplete && same && element.isConnected && document.activeElement === element;
            if (clear && stationaryAt === null) stationaryAt = now; else if (!clear) stationaryAt = null;
            state.samples.push({ at:now-start, bodyComplete:state.bodyComplete, current, same, clear, stationaryMs:stationaryAt === null ? 0 : now-stationaryAt });
            if (now-start > 1000) return finish(false);
            if (clear && now-stationaryAt >= 100) return finish(true);
            frame = requestAnimationFrame(sample);
          };
          const timer = setTimeout(() => finish(false), 1000); frame = requestAnimationFrame(sample);
        });
      }, before);
      held[0].release(); const response = await responsePromise;
      const body = await walletMetricsResponseBody(response);
      expect(response.status()).toBe(503); expect(body).toEqual({ error:message });
      await expect.poll(() => warnings.length).toBeGreaterThan(0);
      await original.evaluate(() => { window.__walletBalanceScopeFocus.completedBalanceSequence = 1; window.__walletFeeRetention.bodyComplete = true; });
      const focus = await page.evaluate(() => window.__walletBalanceScopeFocus.promise);
      const retention = await page.evaluate(() => window.__walletFeeRetention.promise);
      const after = await identity();
      await test.info().attach('fee-failure-current-balance-and-focus', { body:JSON.stringify({ before, after, response:{ method:held[0].request.method(), path:new URL(held[0].request.url()).pathname, status:response.status(), body, startedAt:held[0].startedAt, releasedAt:held[0].releasedAt, fulfilledAt:held[0].fulfilledAt }, balanceResponse:{ status:balanceResponse.status(), body:balanceBody }, warnings, focus, retention, qualification:'Actual native connection and trustedTab entry; original focus retained across exact ordinary fee503 body and warning/catch boundary. Observation-only markers, no app state/style/time/focus/scroll hook; deterministic mocked balance, no financial outcome.' }, null, 2), contentType:'application/json' });
      expect(focus.proof.pass).toBe(true); expect(focus.ended-focus.began).toBeLessThanOrEqual(1000);
      expect(focus.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);
      expect(focus.active && focus.connected && !focus.removed).toBe(true); expect(focus.events.every(event => event.original)).toBe(true);
      expect(retention.pass).toBe(true); expect(retention.samples.at(-1).at).toBeLessThanOrEqual(1000);
      expect(retention.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100); expect(after).toEqual(before);
      expect(f.balances.length).toBe(1); expect(held.length).toBe(1);
      await page.screenshot({ path:test.info().outputPath('fee-failure-retains-current-balance-'+width+'.png') });
    } finally { closing = true; held.forEach(gate => gate.release()); await f.finish(); }
  });
});
