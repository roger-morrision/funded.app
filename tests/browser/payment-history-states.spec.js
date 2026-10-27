import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const loading = 'Checking finalized payout receipts.';
const unavailable = 'Payment history is temporarily unavailable.';
const incomplete = 'Verification coverage is incomplete. Confirmed payments are not available in this response.';
const empty = 'No confirmed payments are available to show yet.';
const data = (status, rows = [], coverage = status === 'partial' ? 'partial' : 'verified') => ({ cluster: 'devnet', status, generatedAt: '2026-10-21T00:00:00Z', checkedAutomatic: rows.length, verifiedPayouts: rows, payoutCoverage: { status: coverage, recorded: status === 'partial' ? 110 : rows.length, verified: rows.length } });
const receipts = [
  { source: 'v3-creator-wallet', to: '8'.repeat(44), signature: '3'.repeat(88), amountLamports: 1000000001, actualReceivedLamports: 999993001, feeLamports: 5000, recipientRentLamports: 2000, feePayer: '8'.repeat(44), blockTime: 1792454400, slot: 512479000 },
  { source: 'automatic-holder', to: '9'.repeat(44), signature: '4'.repeat(88), amountLamports: 200001, actualReceivedLamports: 200001, feeLamports: 5000, feePayer: '7'.repeat(44), blockTime: 1792454460, slot: 512479001 },
];
async function fixture(page, { held = false, history = null } = {}) {
  let release, requests = 0, completed = 0; const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://**/*', r => r.abort());
  await page.route('**/api/**', r => {
    const q = r.request(), path = new URL(q.url()).pathname;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(q.method()) && path !== '/api/solana/rpc') writes.push({ method: q.method(), path });
    return r.fulfill({ status: 503, json: { error: 'Offline history state fixture' } });
  });
  await page.route('**/api/fee-policy', r => r.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
  await page.route('**/api/evidence/payment-history', async r => {
    requests++; if (held) await new Promise(resolve => { release = resolve; });
    await (history ? r.fulfill({ json: history }) : r.fulfill({ status: 503, json: { error: 'History unavailable fixture' } })); completed++;
  });
  return { errors, writes, requests: () => requests, completed: () => completed, set: next => { history = next; }, release: async next => { await expect.poll(() => Boolean(release)).toBe(true); history = next; held = false; release(); } };
}
async function ready(page, width) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
  await page.goto('/#payments'); await page.locator('body.workspace-ready.product-experience-ready').waitFor();
  await page.locator('[data-reward-open="history"]').click(); await expect(page.locator('#payment-list')).toBeVisible();
}
const list = page => page.locator('#payment-list');
const note = page => page.locator('#payment-history-footnote');
async function state(page, message, caption) {
  await expect(list(page).locator('.empty-state')).toHaveText(message); await expect(note(page)).toHaveText(caption);
  const ax = await list(page).ariaSnapshot(); expect(ax).toContain(message);
  expect(await list(page).locator('[role="status"], [aria-live], [tabindex="0"]').count()).toBe(0);
}
async function refresh(page, f, history) {
  const before = f.requests(); f.set(history);
  // Existing route-read callback; no new production endpoint, poll, hook or timer.
  await page.evaluate(() => window.dispatchEvent(new Event('funded:route-change')));
  await expect.poll(() => f.requests()).toBe(before + 1); await expect.poll(() => f.completed()).toBe(before + 1);
}
async function rows(page) {
  return list(page).locator('.payment-history-row').evaluateAll(es => es.map(e => ({ text: e.textContent, details: e.querySelector('details').dataset.receiptKey, wallet: e.querySelector('.payment-history-wallet').getAttribute('href'), transaction: e.querySelector('.payment-receipt-link').getAttribute('href'), transactionLabel: e.querySelector('.payment-receipt-link').getAttribute('aria-label') })));
}
for (const width of [360, 390, 1440]) {
  test(`Rewards History pending read stays loading through native filter and Clear at ${width}px`, async ({ page }, info) => {
    const f = await fixture(page, { held: true }); await ready(page, width); await expect.poll(() => f.requests()).toBe(1);
    await state(page, loading, 'Waiting for the current payment history check to finish.'); expect(f.completed()).toBe(0);
    await expect(list(page)).not.toContainText(/No confirmed payments|unavailable|could not/i);
    await note(page).evaluate(e => { window.historyCaptionChanges = 0; new MutationObserver(records => { window.historyCaptionChanges += records.length; }).observe(e, { childList: true, subtree: true, characterData: true }); });
    await page.locator('#payment-history-type').selectOption('holder'); await state(page, loading, 'Waiting for the current payment history check to finish.');
    const clear = page.locator('#payment-history-clear'); await clear.focus(); await page.keyboard.press('Enter'); await expect(clear).toBeFocused(); await expect(page.locator('#payment-history-type')).toHaveValue('all');
    await state(page, loading, 'Waiting for the current payment history check to finish.'); expect(f.requests()).toBe(1); expect(f.completed()).toBe(0);
    expect(await page.evaluate(() => window.historyCaptionChanges)).toBe(0);
    await page.screenshot({ path: info.outputPath(`pending-${width}.png`) });
    await f.release(data('onchain-indexed')); await state(page, empty, 'No confirmed payments are available.'); await expect(clear).toBeFocused();
    expect(f.requests()).toBe(1); expect(f.completed()).toBe(1); await expect(note(page)).not.toContainText(/Checking|could not/i);
    expect(await page.evaluate(() => window.historyCaptionChanges)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); expect(f.errors).toEqual([]); expect(f.writes).toEqual([]);
  });
  test(`Rewards History unavailable, partial and verified rows retain truthful coverage at ${width}px`, async ({ page }, info) => {
    const f = await fixture(page); await ready(page, width);
    await state(page, unavailable, 'Payment history could not be fully checked. Try again shortly.');
    const clear = page.locator('#payment-history-clear'); await clear.focus();
    await refresh(page, f, data('onchain-indexed')); await state(page, empty, 'No confirmed payments are available.'); await expect(clear).toBeFocused();
    await refresh(page, f, data('partial')); await state(page, incomplete, 'Available history is incomplete. No confirmed payments are available in this response.');
    await refresh(page, f, data('onchain-indexed', [], 'partial')); await state(page, incomplete, 'Available history is incomplete. No confirmed payments are available in this response.');
    for (const malformed of [data('unavailable'), data('unknown'), { ...data('onchain-indexed'), payoutCoverage: null }]) { await refresh(page, f, malformed); await state(page, unavailable, 'Payment history could not be fully checked. Try again shortly.'); }
    await refresh(page, f, data('onchain-indexed', receipts)); await expect(list(page).locator('.payment-history-row')).toHaveCount(2); await expect(note(page)).toHaveText('2 of 2 confirmed payments · fees in details');
    const complete = await rows(page); expect(complete.map(x => x.wallet)).toEqual(receipts.map(r => `https://explorer.solana.com/address/${r.to}?cluster=devnet`)); expect(complete.map(x => x.transaction)).toEqual(receipts.map(r => `https://explorer.solana.com/tx/${r.signature}?cluster=devnet`));
    expect(complete[0].text).toContain('Gross payout 1.000000001 SOL'); expect(complete[0].text).toContain('0.999993001'); expect(complete[0].text).toContain('Transaction fee 0.000005 SOL · paid by receiver'); expect(complete[0].text).toContain('Payment account rent 0.000002 SOL · paid by receiver'); expect(complete[0].text).toContain('Paid Oct 20, 2026, 00:00 UTC');
    const summary = list(page).locator('summary').first(); await summary.focus(); await page.keyboard.press('Enter'); await expect(summary.locator('..')).toHaveAttribute('open', '');
    await refresh(page, f, data('partial', receipts)); await expect(note(page)).toHaveText('2 of 2 confirmed payments · fees in details · some history is missing'); expect(await rows(page)).toEqual(complete); await expect(summary).toBeFocused(); await expect(summary.locator('..')).toHaveAttribute('open', '');
    const payout = page.locator('[data-analytics-metric="payouts"] strong'); await expect(payout).toHaveText('2');
    await page.locator('#payment-history-type').selectOption('x'); await expect(list(page).locator('.empty-state')).toHaveText('No confirmed payments match these filters.'); await expect(note(page)).toHaveText('0 of 2 confirmed payments · fees in details · some history is missing');
    const before = f.requests(); await clear.focus(); await page.keyboard.press('Enter'); await expect(list(page).locator('.payment-history-row')).toHaveCount(2); expect(f.requests()).toBe(before); await expect(payout).toHaveText('2');
    await refresh(page, f, data('onchain-indexed', receipts)); await page.locator('#payment-history-type').selectOption('x'); await expect(list(page).locator('.empty-state')).toHaveText('No confirmed payments match these filters.'); await expect(note(page)).toHaveText('0 of 2 confirmed payments · fees in details');
    await page.screenshot({ path: info.outputPath(`filtered-${width}.png`) }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); expect(f.errors).toEqual([]); expect(f.writes).toEqual([]);
  });
}

// Font-sensitive native coverage: the six offline state cases above stay exact.
function observeFilterFocus(target, {timeoutMs=1000, stableMs=100}={}) {
  return new Promise(resolve=>{
    const start=performance.now(),samples=[];
    let stableSince=null,lastScroll=null,frame,timer,done=false;
    const finish=(pass,reason,last)=>{
      if(done)return;done=true;cancelAnimationFrame(frame);clearTimeout(timer);
      resolve({pass,reason,elapsedMs:performance.now()-start,stableForMs:stableSince===null?0:performance.now()-stableSince,samples,last});
    };
    const sample=()=>{
      const now=performance.now(),e=document.activeElement,r=target.getBoundingClientRect(),s=getComputedStyle(target);
      const n=document.querySelector('.mobile-workspace-nav'),h=document.querySelector('.topbar');
      const margin=(parseFloat(s.outlineWidth)||0)+Math.max(0,parseFloat(s.outlineOffset)||0);
      const state={elapsedMs:now-start,scrollY,focused:e===target,focusVisible:target.matches(':focus-visible'),visible:target.getClientRects().length>0&&r.top-margin>=(h?.getClientRects().length?Math.max(0,h.getBoundingClientRect().bottom):0)&&r.bottom+margin<=(n?.getClientRects().length?n.getBoundingClientRect().top:innerHeight)};
      samples.push(state);
      if(now-start>timeoutMs)return finish(false,'deadline',state);
      if(state.focused&&state.focusVisible&&state.visible){
        if(stableSince===null||lastScroll!==state.scrollY)stableSince=now;
        lastScroll=state.scrollY;
        if(now-stableSince>=stableMs)return finish(true,'visible-and-stationary',state);
      }else{stableSince=null;lastScroll=null;}
      frame=requestAnimationFrame(sample);
    };
    timer=setTimeout(()=>finish(false,'deadline',samples.at(-1)),timeoutMs);
    frame=requestAnimationFrame(sample);
  });
}

for(const {width,height} of [{width:360,height:844},{width:360,height:740},{width:390,height:844},{width:1440,height:900}])test(`Rewards History loaded Manrope native filters and Clear stay readable at ${width}px${height===740?' with 740px height':''}`,async({page},info)=>{
  test.setTimeout(30_000);const check=expect.configure({timeout:15_000});
  const f=await fixture(page,{history:data('onchain-indexed',receipts)}),external=[],wallet=[];
  await page.route('https://**/*',r=>{const q=r.request(),u=new URL(q.url());if(q.method()==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname)){external.push({host:u.hostname,method:q.method()});return r.continue();}return r.abort();});
  page.on('request',q=>{if(new URL(q.url()).pathname.startsWith('/api/wallets/'))wallet.push(q.url());});
  await page.setViewportSize({width,height});await page.goto('/#payments');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.locator('[data-reward-open="history"]').click();await check(list(page)).toBeVisible();await check(list(page).locator('.payment-history-row')).toHaveCount(2);
  const font=await page.evaluate(async()=>{try{await document.fonts.ready;const faces=await document.fonts.load('600 12px "Manrope"','Community / daily bonus 01/01/2030');await document.fonts.ready;const control=document.querySelector('#payment-history-type'),style=getComputedStyle(control);return{loaded:faces.map(f=>({family:f.family,weight:f.weight,status:f.status})),family:style.fontFamily,weight:style.fontWeight,status:document.fonts.status};}catch(e){return{error:String(e)};}});
  await info.attach('actual-control-font',{body:JSON.stringify({font,external},null,2),contentType:'application/json'});
  check(font.error,'font-unavailable: existing Google Fonts could not load').toBeUndefined();check(font.loaded?.length,'font-unavailable: no actual Manrope600 FontFace').toBeGreaterThan(0);check(font.loaded.every(f=>f.family==='Manrope'&&f.status==='loaded')).toBe(true);check(font.loaded.some(f=>{const weights=f.weight.trim().split(/\s+/).map(Number);return weights.length===1?weights[0]===600:weights.length===2&&weights[0]<=600&&weights[1]>=600;}),'font-unavailable: no loaded Manrope face supporting weight600').toBe(true);check(font.family).toContain('Manrope');check(font.weight).toBe('600');
  const type=page.locator('#payment-history-type'),clear=page.locator('#payment-history-clear'),before=f.requests(),kpi=await page.locator('[data-analytics-metric="payouts"] strong').innerText(),originalRows=await rows(page),readability=[];
  const choices=await type.evaluate(e=>{const c=document.createElement('canvas').getContext('2d');c.font=getComputedStyle(e).font;return[...e.options].map(o=>({value:o.value,label:o.textContent,width:c.measureText(o.textContent).width})).sort((a,b)=>b.width-a.width).slice(0,3);});
  for(const choice of choices){await type.selectOption(choice.value);const box=await type.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),c=document.createElement('canvas').getContext('2d');c.font=s.font;return{width:r.width,contentWidth:e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),textWidth:c.measureText(e.selectedOptions[0].textContent).width,font:s.font,selected:e.selectedOptions[0].textContent,left:r.left,right:r.right};});const ax=await type.ariaSnapshot();readability.push({choice,box,ax});await page.screenshot({path:info.outputPath('choice-'+width+'-'+choice.value+'.png')});}
  const dates=await page.locator('#payment-history-from,#payment-history-to').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),c=document.createElement('canvas').getContext('2d');c.font=s.font;return{id:e.id,width:r.width,height:r.height,contentWidth:e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),textWidth:c.measureText('01/01/2030').width,font:s.font,left:r.left,right:r.right};}));
  await info.attach('selected-choice-and-date-readability',{body:JSON.stringify({readability,dates,ax:await page.locator('#payment-history-filters').ariaSnapshot()},null,2),contentType:'application/json'});
  for(const item of readability){check(item.box.contentWidth-item.box.textWidth,'Full selected payout label plus native indicator').toBeGreaterThanOrEqual(20);check(item.ax).toContain(item.choice.label);}
  for(const item of dates){check(item.contentWidth-item.textWidth,'Native date text plus calendar indicator').toBeGreaterThanOrEqual(20);check(item.height).toBeGreaterThanOrEqual(42);}
  await type.selectOption('holder');await page.locator('#payment-history-from').fill('2030-01-01');await check(list(page).locator('.empty-state')).toHaveText('No confirmed payments match these filters.');
  await type.focus();const tabPath=[];for(let i=0;i<14;i++){await page.keyboard.press('Tab');const id=await page.evaluate(()=>document.activeElement?.id);tabPath.push(id);if(id==='payment-history-clear')break;}
  await check(clear).toBeFocused();const beforeEnter=await clear.evaluate(observeFilterFocus,{timeoutMs:1000,stableMs:100});await page.screenshot({path:info.outputPath('native-clear-before-'+width+'.png')});await page.keyboard.press('Enter');await check(clear).toBeFocused();const afterEnter=await clear.evaluate(observeFilterFocus,{timeoutMs:1000,stableMs:100});
  await info.attach('native-filter-focus',{body:JSON.stringify({width,height,font,tabPath,beforeEnter,afterEnter},null,2),contentType:'application/json'});
  check(tabPath).toContain('payment-history-from');check(tabPath).toContain('payment-history-to');check(tabPath.at(-1)).toBe('payment-history-clear');for(const motion of[beforeEnter,afterEnter]){check(motion.pass,JSON.stringify(motion)).toBe(true);check(motion.elapsedMs).toBeLessThanOrEqual(1000);check(motion.stableForMs).toBeGreaterThanOrEqual(100);}
  await check(type).toHaveValue('all');await check(page.locator('#payment-history-from')).toHaveValue('');await check(page.locator('#payment-history-to')).toHaveValue('');check(await rows(page)).toEqual(originalRows);await check(page.locator('[data-analytics-metric="payouts"] strong')).toHaveText(kpi);check(f.requests()).toBe(before);check(wallet).toEqual([]);check(f.errors).toEqual([]);check(f.writes).toEqual([]);check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('native-clear-after-'+width+'.png')});
});

// Local identifier retrieval uses the real bootstrap, controls and receipt renderer.
const searchReceipts = Array.from({length:32}, (_,i) => ({
  ...receipts[i % 2], to:i < 15 ? 'GroupAbC' + '8'.repeat(36) : `WalletAbC${i}` + '9'.repeat(33),
  signature:i === 18 || i === 26 ? 'SharedAbC' + '4'.repeat(79) : `SignatureAbC${i}` + '3'.repeat(73),
  blockTime:1792454400 + i * 60, slot:512479000 + i,
}));
const receiptKey = r => `${r.signature}:${r.to}:${r.source}`;
async function searchFonts(page) {
  await page.unroute('https://**/*');
  await page.route('https://**/*',r => ['fonts.googleapis.com','fonts.gstatic.com'].includes(new URL(r.request().url()).hostname) && r.request().method() === 'GET' ? r.continue() : r.abort());
}
// Start before the action. Resolve the current control on every animation frame;
// a replacement row must contain the response marker before stability can accrue.
function observeSearchFocus(target, {selector, replacementKey = null, waitForRemoval = false}) {
  const original = replacementKey || waitForRemoval ? target : null;
  return new Promise(resolve => {
    const start = performance.now(), samples = []; let since = null, position = null, frame, timer, done = false;
    const finish = pass => {if(done)return;done=true;cancelAnimationFrame(frame);clearTimeout(timer);resolve({pass,elapsedMs:performance.now()-start,stableMs:since===null?0:performance.now()-since,samples});};
    const sample = () => {
      const e = replacementKey ? [...document.querySelectorAll('#payment-list details')].find(d=>d.dataset.receiptKey===replacementKey)?.querySelector(selector) : document.querySelector(selector);
      const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e),h=document.querySelector('.topbar'),n=document.querySelector('.mobile-workspace-nav'),margin=s?(parseFloat(s.outlineWidth)||0)+Math.max(0,parseFloat(s.outlineOffset)||0):0;
      const p=JSON.stringify([scrollX,scrollY,r?.x,r?.y]);
      const visible=!!r&&e.getClientRects().length>0&&r.top-margin>=(h?.getClientRects().length?Math.max(0,h.getBoundingClientRect().bottom):0)&&r.bottom+margin<=(n?.getClientRects().length?n.getBoundingClientRect().top:innerHeight)&&r.left-margin>=0&&r.right+margin<=innerWidth;
      const current=(!original||!original.isConnected)&&(waitForRemoval||document.querySelector('#payment-list')?.textContent.includes('00:02 UTC'));
      const state={at:performance.now()-start,focused:e===document.activeElement,visible,focusVisible:!!e?.matches(':focus-visible'),current:replacementKey||waitForRemoval?current:true};samples.push(state);
      if(state.at>1000)return finish(false);
      if(state.focused&&state.visible&&state.focusVisible&&state.current){if(since===null||p!==position)since=performance.now();position=p;if(performance.now()-since>=100)return finish(true);}else{since=null;position=null;}
      frame=requestAnimationFrame(sample);
    };timer=setTimeout(()=>finish(false),1000);frame=requestAnimationFrame(sample);
  });
}

for(const width of [360,390,1440])test(`Rewards History native local identifier search preserves records, states and focus at ${width}px`,async({browser},info)=>{
  test.setTimeout(60_000);
  const context=await browser.newContext({viewport:{width,height:width<700?844:900},hasTouch:width<700,isMobile:width<700,locale:'en-US'}),page=await context.newPage();
  try{
    const f=await fixture(page,{held:true,history:data('onchain-indexed',searchReceipts)});await searchFonts(page);
    // This unrelated read already retries503 once after1500ms. Supply a truthful
    // unavailable200 fixture so its existing retry cannot be mistaken for search I/O.
    await page.route('**/api/rewards/automatic',r=>r.fulfill({json:{status:'unavailable',schedules:[],serverTime:'2026-10-21T00:00:00Z'}}));
    const calls=[],wallet=[];page.on('request',q=>{const path=new URL(q.url()).pathname;if(path.startsWith('/api/'))calls.push({path,method:q.method()});if(path.startsWith('/api/wallets/'))wallet.push(path);});
    await ready(page,width);
    const fonts=await page.evaluate(async()=>{await document.fonts.ready;const faces=await document.fonts.load('600 16px "Manrope"');return faces.map(f=>({family:f.family,status:f.status}));});expect(fonts.length).toBeGreaterThan(0);expect(fonts.every(f=>f.family==='Manrope'&&f.status==='loaded')).toBe(true);
    const search=page.getByRole('searchbox',{name:'Search wallet or transaction',exact:true}),clear=page.locator('#payment-history-clear'),nav=page.getByRole('navigation',{name:'Payment history pages',includeHidden:true}),focus=[];
    await search.click();await page.keyboard.insertText('Pending');await state(page,loading,'Waiting for the current payment history check to finish.');await expect(search).toBeFocused();expect(f.requests()).toBe(1);expect(f.completed()).toBe(0);
    await f.release(data('onchain-indexed',searchReceipts));await expect(list(page).locator('.empty-state')).toHaveText('No confirmed payments match this search and these filters.');await clear.click();
    await expect(list(page).locator('.payment-history-row')).toHaveCount(32);const baseline=await rows(page),payout=await page.locator('[data-analytics-metric="payouts"] strong').innerText();
    await expect(search).toHaveAccessibleName('Search wallet or transaction');await expect(search).toHaveAccessibleDescription('Filters available confirmed records. Wallet addresses and transaction signatures are case-sensitive.');const searchAX=await search.ariaSnapshot();
    expect(await search.getAttribute('aria-describedby')).toBe('payment-history-search-help');await expect(page.locator('#payment-history-search-help')).toContainText('case-sensitive');
    await nav.getByRole('button',{name:'Next payment history page'}).click();await expect(nav).toContainText('Page 2 of 4');
    const localCalls=calls.length,before=f.requests(),url=page.url();
    if(width<700)await search.tap();else await search.click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('  '+searchReceipts[25].to+'  ');
    await expect(list(page).locator('.payment-history-row')).toHaveCount(1);expect((await rows(page)).map(r=>r.details)).toEqual([receiptKey(searchReceipts[25])]);await expect(note(page)).toHaveText('1 of 32 confirmed payments · fees in details');await expect(search).toBeFocused();await page.keyboard.press('Enter');expect(page.url()).toBe(url);expect(calls.length).toBe(localCalls);
    await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText(searchReceipts[18].signature);expect((await rows(page)).map(r=>r.details)).toEqual([receiptKey(searchReceipts[18]),receiptKey(searchReceipts[26])]);await expect(nav).toContainText('Page 1 of 1');
    await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('GroupAbC');await expect(nav).toContainText('Page 1 of 2');await nav.getByRole('button',{name:'Next payment history page'}).click();await expect(nav).toContainText('Page 2 of 2');
    await search.click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('  GroupAbC  ');await expect(nav).toContainText('Page 2 of 2');await expect(search).toBeFocused();
    await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('SharedAbC');await expect(nav).toContainText('Page 1 of 1');
    await page.locator('#payment-history-type').selectOption('creator');await page.locator('#payment-history-from').fill('2026-10-20');await page.locator('#payment-history-to').fill('2026-10-20');
    expect((await rows(page)).map(r=>r.details)).toEqual([receiptKey(searchReceipts[18]),receiptKey(searchReceipts[26])]);
    await page.locator('#payment-history-from').fill('2026-10-21');await expect(list(page).locator('.empty-state')).toHaveText('Correct the date range to view matching payments.');await expect(page.locator('#payment-history-range-error')).toHaveText('Choose a From date on or before the To date.');await page.locator('#payment-history-from').fill('2026-10-20');await page.locator('#payment-history-type').selectOption('holder');await expect(list(page).locator('.empty-state')).toHaveText('No confirmed payments match this search and these filters.');await page.locator('#payment-history-type').selectOption('all');
    await search.click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('sharedabc.*');await expect(list(page).locator('.empty-state')).toHaveText('No confirmed payments match this search and these filters.');
    await page.keyboard.press('Tab');await expect(page.locator('#payment-history-type')).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(search).toBeFocused();
    focus.push(await search.evaluate(observeSearchFocus,{selector:'#payment-history-search'}));
    await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('X'.repeat(500));const inputGeometry=await search.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{width:r.width,height:r.height,font:parseFloat(s.fontSize)};});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    if(width<700){expect(inputGeometry.font).toBeGreaterThanOrEqual(16);expect(inputGeometry.height).toBeGreaterThanOrEqual(44);expect(inputGeometry.width).toBeGreaterThanOrEqual(44);}
    // A composing event is not yet a committed filter; compositionend is.
    await search.evaluate(e=>{e.value='SharedAbC';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'C'}));});await expect(list(page).locator('.empty-state')).toHaveText('No confirmed payments match this search and these filters.');
    await search.evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'SharedAbC'})));expect((await rows(page)).map(r=>r.details)).toEqual([receiptKey(searchReceipts[18]),receiptKey(searchReceipts[26])]);
    await page.keyboard.press('Escape');await expect(search).toHaveValue('');expect(await rows(page)).toEqual(baseline);await page.keyboard.insertText('SharedAbC');
    await clear.click();await expect(clear).toBeFocused();await expect(search).toHaveValue('');await expect(page.locator('#payment-history-type')).toHaveValue('all');await expect(page.locator('#payment-history-from')).toHaveValue('');await expect(page.locator('#payment-history-to')).toHaveValue('');expect(await rows(page)).toEqual(baseline);expect(f.requests()).toBe(before);expect(calls.length).toBe(localCalls);
    // Native keyboard path to Clear and retained values; no synthetic focus or scroll.
    await search.click();const clearTabPath=[];for(let i=0;i<14;i++){await page.keyboard.press('Tab');const id=await page.evaluate(()=>document.activeElement?.id);clearTabPath.push(id);if(id==='payment-history-clear')break;}expect(clearTabPath).toContain('payment-history-from');expect(clearTabPath).toContain('payment-history-to');await expect(clear).toBeFocused();focus.push(await clear.evaluate(observeSearchFocus,{selector:'#payment-history-clear'}));const clearGeometry=await clear.boundingBox();if(width<700){expect(clearGeometry.width).toBeGreaterThanOrEqual(44);expect(clearGeometry.height).toBeGreaterThanOrEqual(44);}await page.keyboard.press('Enter');await expect(clear).toBeFocused();
    // Search node, raw value, native caret and input focus survive source refresh.
    await search.click();await page.keyboard.insertText('SharedAbC');await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
    await search.evaluate(e=>{window.retainedSearch=e;window.retainedCaret=e.selectionStart;});await refresh(page,f,data('partial',searchReceipts));
    expect(await search.evaluate(e=>e===window.retainedSearch&&e.selectionStart===window.retainedCaret)).toBe(true);await expect(search).toHaveValue('SharedAbC');await expect(search).toBeFocused();await expect(note(page)).toHaveText('2 of 32 confirmed payments · fees in details · some history is missing');focus.push(await search.evaluate(observeSearchFocus,{selector:'#payment-history-search'}));
    const summary=list(page).locator('summary').first(),firstKey=receiptKey(searchReceipts[18]);await summary.click();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(summary).toBeFocused();await expect(summary.locator('..')).toHaveAttribute('open','');
    const replacement=searchReceipts.map((r,i)=>i===18?{...r,blockTime:1792454520}:r),observing=summary.evaluate(observeSearchFocus,{selector:'summary',replacementKey:firstKey});await refresh(page,f,data('partial',replacement));focus.push(await observing);await expect(summary).toBeFocused();await expect(summary.locator('..')).toHaveAttribute('open','');
    const removal=summary.evaluate(observeSearchFocus,{selector:'#payment-history-clear',waitForRemoval:true});await refresh(page,f,data('partial',searchReceipts.filter((_,i)=>i!==18&&i!==26)));focus.push(await removal);await expect(clear).toBeFocused();await expect(search).toHaveValue('SharedAbC');await expect(list(page).locator('.empty-state')).toHaveText('No confirmed payments match this search and these filters.');
    await search.click();
    for(const [history,message,caption] of [[null,unavailable,'Payment history could not be fully checked. Try again shortly.'],[data('partial'),incomplete,'Available history is incomplete. No confirmed payments are available in this response.'],[data('onchain-indexed'),empty,'No confirmed payments are available.']]){await refresh(page,f,history);await state(page,message,caption);await expect(search).toHaveValue('SharedAbC');await expect(search).toBeFocused();}
    await refresh(page,f,data('onchain-indexed',searchReceipts));await clear.click();expect(await rows(page)).toEqual(baseline);await expect(page.locator('[data-analytics-metric="payouts"] strong')).toHaveText(payout);
    await expect(list(page).locator('summary').first()).toHaveText('Amount and fees');expect(wallet).toEqual([]);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);for(const result of focus){expect(result.pass,JSON.stringify(result)).toBe(true);expect(result.elapsedMs).toBeLessThanOrEqual(1000);expect(result.stableMs).toBeGreaterThanOrEqual(100);}
    await info.attach('search-native-evidence',{body:JSON.stringify({width,fonts,searchAX,inputGeometry,clearGeometry,clearTabPath,focus,original:baseline,localApiCalls:calls.slice(0,localCalls),explicitRefreshes:f.requests()-before,noLocalInputRequests:true},null,2),contentType:'application/json'});await page.screenshot({path:info.outputPath('history-search-'+width+'.png')});
  }finally{await context.close();}
});

// FQA-077: native navigation to the separate bonus source. The legacy prefix
// above is unchanged. All receipt/bonus values below are deterministic mocks.
const bonus077Selector = '#rewards-history .payment-history-bonus-link';
const bonus077Path = '/api/daily-bonus/dashboard';
function bonus077Payload() {
  return {
    cluster:'devnet',scope:'all-recorded-snapshots',serverTime:'2026-10-26T00:00:00Z',nextCutoffAt:'2026-10-27T00:00:00Z',
    snapshotEnabled:false,payoutEnabled:false,worker:{status:'unavailable'},snapshots:1,totalPayments:1,unavailableSnapshots:0,unavailableReceipts:0,
    pool:{status:'unavailable',categoryLamports:{}},leaders:{creators:[],referrals:[],traders:[]},
    history:{page:1,pages:1,total:1,rows:[{day:'2026-10-20',wallet:'8'.repeat(44),receivedLamports:'450',categoryLamports:{creators:'450',referrals:'0',traders:'0'},signature:'3'.repeat(88),href:'https://explorer.solana.com/tx/'+ '3'.repeat(88)+'?cluster=devnet'}]},
  };
}
async function bonus077Fixture(page, available) {
  const f=await fixture(page,{held:true});await searchFonts(page);
  // Existing unrelated503 retry is not an effect of the new static anchor.
  await page.route('**/api/rewards/automatic',r=>r.fulfill({json:{status:'unavailable',schedules:[],serverTime:'2026-10-26T00:00:00Z'}}));
  const requests=[],reads=[],pending=new Set();let bonusAvailable=available;
  const request=q=>{const u=new URL(q.url());if(u.pathname.startsWith('/api/'))requests.push({path:u.pathname,query:u.search,method:q.method()});};
  const response=r=>{
    const u=new URL(r.url());if(![bonus077Path,'/api/evidence/payment-history'].includes(u.pathname))return;
    const row={path:u.pathname,query:u.search,status:r.status(),state:'pending'};reads.push(row);
    const work=(async()=>{try{row.finishedError=await r.finished();row.body=await r.json();row.state='complete';}catch(e){row.state='unavailable';row.error=String(e);}})();
    pending.add(work);void work.finally(()=>pending.delete(work));
  };
  page.on('request',request);page.on('response',response);
  await page.route('**/api/daily-bonus/dashboard?*',r=>bonusAvailable?r.fulfill({json:bonus077Payload()}):r.fulfill({status:503,json:{error:'Separate bonus source unavailable fixture'}}));
  return {f,requests,reads,pending,setBonus:value=>{bonusAvailable=value;},detach:()=>{page.off('request',request);page.off('response',response);}};
}
async function bonus077Read(page,action,available) {
  const awaited=page.waitForResponse(r=>new URL(r.url()).pathname===bonus077Path);
  await action();const response=await awaited;
  expect(await response.finished()).toBeNull();const body=await response.json();
  expect(response.request().method()).toBe('GET');expect(new URL(response.url()).searchParams.get('category')).toBe('all');
  expect(new URL(response.url()).searchParams.get('page')).toBe('1');
  await expect(page.locator('#bonuses')).toBeVisible();await expect(page.locator('#bonus-history-title')).toHaveText('Payout history');
  const status=page.locator('#bonuses [data-bonus-history-status]'),rows=page.locator('#bonuses [data-bonus-history-rows]');
  if(available){
    expect(response.status()).toBe(200);expect(body).toEqual(bonus077Payload());
    await expect(status).toContainText('1 finalized receipt(s).');await expect(status).toContainText('Bonus snapshots are not enabled.');
    await expect(rows.locator('tbody tr')).toHaveCount(1);await expect(rows).toContainText('2026-10-20');await expect(rows).toContainText('0.00000045 SOL');
    await expect(page.locator('#bonuses [data-bonus-page]')).toHaveText('Page 1 of 1 · 1 payments');
  }else{
    expect(response.status()).toBe(503);await expect(status).toHaveText('Bonus history is unavailable. No payout or ranking is confirmed here.');
    await expect(rows).toBeEmpty();await expect(page.locator('#bonuses [data-bonus-page]')).toBeEmpty();
  }
  await expect(page.locator('#bonuses [data-bonus-history-category]')).toHaveValue('all');
  return {status:response.status(),body,renderedStatus:await status.innerText(),responseFinished:true,qualification:'Mocked independent source/read completion; not on-chain or matching-payment proof.'};
}
async function bonus077Font(link) {
  const font=await link.evaluate(async e=>{
    await document.fonts.ready;const s=getComputedStyle(e),faces=await document.fonts.load(s.fontWeight+' '+s.fontSize+' "Manrope"',e.textContent);await document.fonts.ready;
    return {family:s.fontFamily,weight:s.fontWeight,size:parseFloat(s.fontSize),faces:faces.map(f=>({family:f.family,weight:f.weight,status:f.status}))};
  });
  expect(font.family).toContain('Manrope');expect(font.weight).toBe('700');expect(font.size).toBeGreaterThanOrEqual(14);
  expect(font.faces.length,'font unavailable: actual Manrope700 required').toBeGreaterThan(0);
  expect(font.faces.every(f=>f.family==='Manrope'&&f.status==='loaded')).toBe(true);
  expect(font.faces.some(f=>{const w=f.weight.split(/\s+/).map(Number);return w.length===1?w[0]===700:w.length===2&&w[0]<=700&&w[1]>=700;})).toBe(true);
  return font;
}
async function bonus077Identity(original,focused=false) {
  expect(await original.evaluate((e,wantsFocus)=>e.isConnected&&e===document.querySelector('#rewards-history .payment-history-bonus-link')&&(!wantsFocus||document.activeElement===e),focused)).toBe(true);
}
async function bonus077TabTo(page,original) {
  for(let n=0;n<100;n++){
    if(await original.evaluate(e=>e===document.activeElement))return;
    await page.keyboard.press('Tab');
  }
  throw Error('Native Tab did not reach the original History bonus link');
}
async function bonus077Arm(page,original,key,hash) {
  // Listen only on the currently focused control. No global focus hook or
  // focus/scroll override; the trusted key starts the unchanged strict clock.
  await original.evaluate((target,{source,key,hash})=>{
    const from=document.activeElement;let resolve;
    const state=window.__bonus077Proof={promise:new Promise(r=>{resolve=r;})};
    const begin=event=>{
      if(!event.isTrusted||event.key!=='Tab'||event.shiftKey!==(key==='Shift+Tab'))return;
      from.removeEventListener('keydown',begin,true);state.began=performance.now();
      state.trigger={type:event.type,key:event.key,shiftKey:event.shiftKey,trusted:event.isTrusted};
      (new Function('return ('+source+')')())(target,{hash}).then(proof=>resolve({proof,trigger:state.trigger,began:state.began,ended:performance.now(),connected:target.isConnected,active:document.activeElement===target}));
    };
    from.addEventListener('keydown',begin,true);
  },{source:observeBonus077Control.toString(),key,hash});
}
async function bonus077Focus(page,original,hash,evidence) {
  await bonus077TabTo(page,original);
  // The next native stop is the existing Search control. Shift+Tab returns to
  // the original link; the reverse path checks forward Tab into it as well.
  await page.keyboard.press('Tab');await expect(page.locator('#payment-history-search')).toBeFocused();
  await bonus077Arm(page,original,'Shift+Tab',hash);await page.keyboard.press('Shift+Tab');
  evidence.push(await page.evaluate(()=>window.__bonus077Proof.promise));
  await page.keyboard.press('Shift+Tab');expect(await original.evaluate(e=>e===document.activeElement)).toBe(false);
  await bonus077Arm(page,original,'Tab',hash);await page.keyboard.press('Tab');
  evidence.push(await page.evaluate(()=>window.__bonus077Proof.promise));
  for(const value of evidence){expect(value.trigger.trusted&&value.connected&&value.active).toBe(true);expect(value.proof.pass,JSON.stringify(value)).toBe(true);expect(value.ended-value.began).toBeLessThanOrEqual(1000);expect(value.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);}
}
async function bonus077Geometry(original) {
  const g=await original.evaluate(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right,pageWidth:document.documentElement.scrollWidth,viewport:innerWidth};});
  expect(g.width).toBeGreaterThanOrEqual(44);expect(g.height).toBeGreaterThanOrEqual(44);expect(g.pageWidth).toBeLessThanOrEqual(g.viewport);
  return g;
}
async function bonus077Copy(page,original) {
  const link=page.locator(bonus077Selector);await expect(link).toHaveCount(1);await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href','#bonuses');await expect(link).toHaveAccessibleName('Browse Daily bonus payout history →');
  await expect(link.locator('..').locator(':scope > p').nth(0)).toHaveText('Looking for a Daily bonus receipt?');
  await expect(link.locator('..').locator(':scope > p').nth(1)).toHaveText('Daily bonus history has its own filters.');
  await expect(page.locator('#rewards-history h2')).toHaveText('Payment history');
  await expect(page.locator('#rewards-history .panel-heading > div > p').nth(1)).toHaveText('Confirmed SOL payments across funded.vip.');
  await bonus077Identity(original);
}
async function bonus077Criteria(page,query) {
  await page.locator('#payment-history-search').click();await page.keyboard.insertText(query);
  await page.locator('#payment-history-type').selectOption('creator');
  // Date fills are fixture preconditions, not a claimed native date edit.
  await page.locator('#payment-history-from').fill('2026-10-20');await page.locator('#payment-history-to').fill('2026-10-20');
  return {query,type:'creator',from:'2026-10-20',to:'2026-10-20'};
}
async function bonus077Back(page,original,criteria,hash) {
  await page.goBack();await expect(page).toHaveURL(new RegExp('/'+hash.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$'));
  await expect(page.locator('#rewards-history')).toBeVisible();await expect(page.getByRole('tab',{name:'History',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#payment-history-search')).toHaveValue(criteria.query);await expect(page.locator('#payment-history-type')).toHaveValue(criteria.type);
  await expect(page.locator('#payment-history-from')).toHaveValue(criteria.from);await expect(page.locator('#payment-history-to')).toHaveValue(criteria.to);
  await bonus077Copy(page,original);
  return await page.evaluate(()=>({activeTag:document.activeElement.tagName,activeId:document.activeElement.id,connected:document.activeElement.isConnected,hash:location.hash}));
}
for(const width of [360,390,1440])test.describe('FQA-077 separate bonus source '+width,()=>{
  test.use({viewport:{width,height:width<700?844:900},hasTouch:width<700,isMobile:width<700,locale:'en-US'});
  for(const available of [true,false])test(`FQA-077 History to separate Daily bonus ${available?'availableBack':'unavailableRecovery'} at ${width}px (mocked read-only sources)`,async({page},info)=>{
    const x=await bonus077Fixture(page,available),proofs=[],states=[],destinations=[];let original,font,geometry,criteria,back;
    const hash=available?'#payments':'#payments/history';
    try{
      if(available)await ready(page,width);
      else{await page.goto('/#payments/history');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await expect(page.locator('#rewards-history')).toBeVisible();}
      await state(page,loading,'Waiting for the current payment history check to finish.');expect(x.f.requests()).toBe(1);expect(x.f.completed()).toBe(0);states.push({state:'loading',provenance:'Original loader request held before its transport response'});
      original=await page.locator(bonus077Selector).elementHandle();expect(original).not.toBeNull();await bonus077Copy(page,original);
      font=await bonus077Font(page.locator(bonus077Selector));await bonus077Focus(page,original,hash,proofs);geometry=await bonus077Geometry(original);
      // This original pending loader response completes while the new link has
      // native keyboard focus. No renderer call or synthetic event causes it.
      await x.f.release(available?data('partial'):null);
      await state(page,available?incomplete:unavailable,available?'Available history is incomplete. No confirmed payments are available in this response.':'Payment history could not be fully checked. Try again shortly.');
      await bonus077Identity(original,true);states.push({state:available?'partial-zero':'unavailable-zero',provenance:'Original held transport response completed while original native link focused'});
      await expect.poll(()=>x.reads.filter(r=>r.path==='/api/evidence/payment-history'&&r.state==='complete').length).toBe(1);
      for(const [value,message,caption] of [[data('onchain-indexed'),empty,'No confirmed payments are available.'],[data('onchain-indexed',receipts),null,'2 of 2 confirmed payments · fees in details']]){
        // Reuse the original suite's explicitly modeled route-read trigger.
        // These updates are not described as native background events.
        await refresh(page,x.f,value);
        if(message)await state(page,message,caption);else{await expect(list(page).locator('.payment-history-row')).toHaveCount(2);await expect(note(page)).toHaveText(caption);}
        await bonus077Identity(original,true);await bonus077Copy(page,original);states.push({state:message?'complete-empty':'populated-recovery',provenance:'Existing modeled funded:route-change stimulus; original request/loader/renderer'});
      }
      const rawRows=await rows(page),beforeFilters=x.f.requests();
      await page.locator('#payment-history-type').selectOption('x');await expect(list(page).locator('.empty-state')).toHaveText('No confirmed payments match these filters.');
      await expect(note(page)).toHaveText('0 of 2 confirmed payments · fees in details');await bonus077Copy(page,original);states.push({state:'no-match',provenance:'Existing native selectOption local filter; no source inference'});
      await page.locator('#payment-history-clear').click();expect(await rows(page)).toEqual(rawRows);expect(x.f.requests()).toBe(beforeFilters);
      criteria=await bonus077Criteria(page,available?receipts[0].to:receipts[0].signature);
      await expect(list(page).locator('.payment-history-row')).toHaveCount(1);expect(x.f.requests()).toBe(beforeFilters);
      if(available){await refresh(page,x.f,data('partial'));await state(page,incomplete,'Available history is incomplete. No confirmed payments are available in this response.');}
      else{await refresh(page,x.f,data('partial',receipts));await expect(note(page)).toHaveText('1 of 2 confirmed payments · dates in UTC · fees in details · some history is missing');states.push({state:'partial-populated',provenance:'Existing modeled route-read trigger; native filters retained'});}
      await bonus077Focus(page,original,hash,proofs);await bonus077Copy(page,original);
      const beforeEntry=x.requests.filter(r=>r.path===bonus077Path).length;expect(beforeEntry).toBe(0);
      destinations.push(await bonus077Read(page,()=>available?page.keyboard.press('Enter'):width<700?page.locator(bonus077Selector).tap():page.locator(bonus077Selector).click(),available));
      await expect(page).toHaveURL(/\/#bonuses$/);expect(x.requests.filter(r=>r.path===bonus077Path).length).toBe(1);
      if(!available){x.setBonus(true);destinations.push(await bonus077Read(page,()=>width<700?page.locator('#bonuses [data-bonus-history-refresh]').tap():page.locator('#bonuses [data-bonus-history-refresh]').click(),true));expect(x.requests.filter(r=>r.path===bonus077Path).length).toBe(2);}
      back=await bonus077Back(page,original,criteria,hash);expect(back.connected).toBe(true);geometry=await bonus077Geometry(original);
      expect(x.f.writes).toEqual([]);expect(x.f.errors).toEqual([]);expect(x.requests.some(r=>r.path.startsWith('/api/wallets/'))).toBe(false);
      await expect.poll(()=>x.pending.size).toBe(0);expect(x.reads.every(r=>r.state==='complete'&&r.finishedError===null)).toBe(true);
      await page.screenshot({path:info.outputPath(`history-bonus-${width}-${available?'available':'recovery'}.png`)});
    }finally{
      // Attach original state/provenance even when the first assertion fails.
      // The built-in Playwright fixture owns close; no replacement teardown.
      try{await info.attach('history-bonus-native-evidence',{body:JSON.stringify({width,available,hash,font,geometry,criteria,back,proofs,states,destinations,reads:x.reads,requests:x.requests,errors:x.f.errors,writes:x.f.writes,qualification:'Deterministic mocked APIs. Datefills/modelled route events explicitly qualified; sourcegroup has no handler/API/storage logic. No actual payment or on-chain proof.'},null,2),contentType:'application/json'});}catch(error){console.error('FQA077 evidence attachment unavailable: '+String(error));}
      x.detach();
    }
  });
});

function observeBonus077Control(original, readiness = {}) {
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

const range079Message='Choose a From date on or before the To date.';
const range079Instruction='Correct the date range to view matching payments.';
const range079Ids=['payment-history-search','payment-history-type','payment-history-from','payment-history-to','payment-history-clear'];
async function range079Observe(page) {
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
async function range079Finish({context,watch,release,info,evidence,name,primary,hasPrimary}) {
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
  if(errors.length)throw new AggregateError(errors.map(({error})=>error),'Date-range verification cleanup or completed-response check failed');
}
async function range079Setup(page) {
  const fonts=await page.evaluate(async()=>{
    await document.fonts.ready;const faces=await document.fonts.load('600 16px "Manrope"','2026 Choose From To');
    await document.fonts.ready;return faces.map(f=>({family:f.family,weight:f.weight,status:f.status}));
  });
  expect(fonts.length).toBeGreaterThan(0);expect(fonts.every(f=>f.family==='Manrope'&&f.status==='loaded')).toBe(true);
  await page.evaluate(ids=>{
    const controls=ids.map(id=>document.getElementById(id)),error=document.getElementById('payment-history-range-error');
    // Controlled accessibility preconditions only; no focus, value, scroll or style replacement.
    controls[2].setAttribute('aria-describedby','payment-history-search-help');
    controls[3].setAttribute('aria-invalid','false');
    const baseline=controls.slice(2,4).map(e=>({invalid:e.getAttribute('aria-invalid'),description:e.getAttribute('aria-describedby')}));
    window.__range079={controls,error,baseline,announcements:[],nativeEvents:[]};
    new MutationObserver(()=>{const text=error.textContent;if(text)window.__range079.announcements.push(text);})
      .observe(error,{childList:true,subtree:true,characterData:true});
    for(const input of controls.slice(2,4))for(const type of ['input','change'])input.addEventListener(type,event=>{
      window.__range079.nativeEvents.push({type,trusted:event.isTrusted,id:input.id,value:input.value});
    });
  },range079Ids);
  return fonts;
}
async function range079TabTo(page,target) {
  for(let n=0;n<100;n++){
    if(await target.evaluate(e=>document.activeElement===e))return;
    await page.keyboard.press('Tab');
  }
  throw Error('Native Tab did not reach original date/Clear control');
}
async function range079Focus(page,target,evidence) {
  await range079TabTo(page,target);await page.keyboard.press('Shift+Tab');
  const hash=new URL(page.url()).hash;
  await target.evaluate((element,{source,hash})=>{
    let resolve;window.__range079Proof=new Promise(r=>resolve=r);
    const from=document.activeElement;
    const begin=event=>{
      if(!event.isTrusted||event.key!=='Tab'||event.shiftKey)return;
      from.removeEventListener('keydown',begin,true);const began=performance.now();
      (new Function('return ('+source+')')())(element,{hash}).then(proof=>resolve({proof,began,ended:performance.now(),
        trusted:event.isTrusted,active:element===document.activeElement,connected:element.isConnected}));
    };
    from.addEventListener('keydown',begin,true);
  },{source:observeBonus077Control.toString(),hash});
  await page.keyboard.press('Tab');const value=await page.evaluate(()=>window.__range079Proof);evidence.push(value);
  expect(value.proof.pass,JSON.stringify(value)).toBe(true);expect(value.ended-value.began).toBeLessThanOrEqual(1000);
  expect(value.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);
  expect(value.trusted&&value.active&&value.connected).toBe(true);
}
async function range079Conflict(page) {
  // Date fills establish the contradiction, not claimed native date-picker entry.
  await page.locator('#payment-history-from').fill('2026-10-21');
  await page.locator('#payment-history-to').fill('2026-10-20');
  await expect(page.locator('#payment-history-to')).toBeFocused();
  const error=page.locator('#payment-history-range-error');await expect(error).toBeVisible();await expect(error).toHaveText(range079Message);
  await expect(error).toHaveAttribute('role','status');await expect(error).toHaveAttribute('aria-live','polite');
  for(const id of ['payment-history-from','payment-history-to']){
    const input=page.locator('#'+id);await expect(input).toHaveAttribute('aria-invalid','true');
    expect((await input.getAttribute('aria-describedby')).split(/\s+/)).toContain('payment-history-range-error');
  }
  expect((await page.locator('#payment-history-from').getAttribute('aria-describedby')).split(/\s+/)).toContain('payment-history-search-help');
  await expect(list(page).locator('.empty-state')).toHaveText(range079Instruction);
  await expect(note(page)).not.toContainText(/\b0 of\b/);
  expect(await page.evaluate(()=>window.__range079.controls.every(e=>e.isConnected&&e===document.getElementById(e.id)))).toBe(true);
}
async function range079Restored(page) {
  await expect(page.locator('#payment-history-range-error')).toBeHidden();
  expect(await page.evaluate(()=>window.__range079.controls.slice(2,4).map(e=>({invalid:e.getAttribute('aria-invalid'),description:e.getAttribute('aria-describedby')}))))
    .toEqual(await page.evaluate(()=>window.__range079.baseline));
}
async function range079ReadMessage(page) {
  const clear=await page.locator('#payment-history-clear').elementHandle();await range079TabTo(page,clear);
  // Arrow keys scroll normally from a button; never use them to scroll a focused date segment.
  for(let n=0;n<100;n++){
    const value=await page.locator('#payment-history-range-error').evaluate(e=>{
      const r=e.getBoundingClientRect(),s=getComputedStyle(e),nav=document.querySelector('.mobile-workspace-nav'),header=document.querySelector('.topbar');
      const top=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0;
      const bottom=nav?.getClientRects().length?nav.getBoundingClientRect().top:innerHeight;
      const range=document.createRange();range.selectNodeContents(e);
      return {top:r.top,bottom:r.bottom,bounds:{top,bottom},full:r.top>=top&&r.bottom<=bottom&&r.left>=0&&r.right<=innerWidth,
        overflow:document.documentElement.scrollWidth>innerWidth,textOverflow:s.textOverflow,whiteSpace:s.whiteSpace,
        textContained:[...range.getClientRects()].every(q=>q.left>=r.left-1&&q.right<=r.right+1&&q.top>=r.top-1&&q.bottom<=r.bottom+1)};
    });
    if(value.full){expect(value.overflow).toBe(false);expect(value.textOverflow).not.toBe('ellipsis');expect(value.whiteSpace).not.toBe('nowrap');expect(value.textContained).toBe(true);return value;}
    await page.keyboard.press(value.top<value.bounds.top?'ArrowUp':'ArrowDown');await page.evaluate(()=>new Promise(requestAnimationFrame));
  }
  throw Error('Native reading did not reveal complete date guidance');
}
async function range079NativeCorrection(page,width) {
  const from=page.locator('#payment-history-from'),before=await from.inputValue();
  const position=await from.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{x:Math.min(r.width-24,Math.max(12,parseFloat(s.paddingLeft)+8)),y:r.height/2};});
  if(width<700)await from.tap({position});else await from.click({position});
  await expect(from).toBeFocused();await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');
  await expect(from).not.toHaveValue(before);await range079Restored(page);
  const after=await from.inputValue();expect(after<'2026-10-20'||after==='2026-10-20').toBe(true);
  const events=await page.evaluate(()=>window.__range079.nativeEvents);
  expect(events.some(e=>e.type==='change'&&e.trusted&&e.id==='payment-history-from'&&e.value===after)).toBe(true);
  return {before,after,events,qualification:'ArrowDown native segment edit and Tab commit after qualified fills; mobile touch is emulated.'};
}
for(const width of [360,390,1440]){
  test(`FQA-079 native inverted dates correct and Clear at ${width}px`,async({browser},info)=>{
    test.setTimeout(60_000);
    const context=await browser.newContext({viewport:{width,height:width<700?844:900},hasTouch:width<700,isMobile:width<700,locale:'en-US'});
    let page,f,watch,primary,hasPrimary=false;const evidence={width,proofs:[]};
    try{
      page=await context.newPage(); // Existing Playwright trace:on owns tracing and artifact retention.
      f=await fixture(page,{history:data('onchain-indexed',receipts)});await searchFonts(page);
      await page.route('**/api/rewards/automatic',r=>r.fulfill({json:{status:'unavailable',schedules:[],serverTime:'2026-10-21T00:00:00Z'}}));
      watch=await range079Observe(page);await ready(page,width);await expect(list(page).locator('.payment-history-row')).toHaveCount(2);await watch.settle();
      evidence.fonts=await range079Setup(page);const baseline=await rows(page),kpi=await page.locator('[data-analytics-metric="payouts"] strong').innerText(),before=watch.requests.length;
      const storage=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));
      await range079Conflict(page);await expect(note(page)).toHaveText('Payment history check is complete.');
      evidence.reading=await range079ReadMessage(page);await page.screenshot({path:info.outputPath('range-guidance-'+width+'.png')});
      evidence.correction=await range079NativeCorrection(page,width);expect(await rows(page)).toEqual(baseline);
      await range079Conflict(page);const original=await page.locator('#payment-history-clear').elementHandle();
      await range079Focus(page,original,evidence.proofs);await page.keyboard.press('Enter');await expect(page.locator('#payment-history-clear')).toBeFocused();
      await range079Restored(page);expect(await rows(page)).toEqual(baseline);
      for(const selector of ['#payment-history-search','#payment-history-from','#payment-history-to'])await expect(page.locator(selector)).toHaveValue('');
      await expect(page.locator('#payment-history-type')).toHaveValue('all');
      expect(await page.locator('[data-analytics-metric="payouts"] strong').innerText()).toBe(kpi);
      expect(watch.requests.length).toBe(before);expect(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]))).toBe(storage);
      expect(await page.evaluate(()=>window.__range079.announcements)).toEqual([range079Message,range079Message]);
      expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(watch.requests.filter(r=>r.path.startsWith('/api/wallets/'))).toEqual([]);
    }catch(error){primary=error;hasPrimary=true;}finally{
      await range079Finish({context,watch,info,evidence,name:'range-native-'+width,primary,hasPrimary});
    }
  });
  test(`FQA-079 date guidance survives independent coverage states at ${width}px`,async({browser},info)=>{
    test.setTimeout(60_000);
    const context=await browser.newContext({viewport:{width,height:width<700?844:900},hasTouch:width<700,isMobile:width<700,locale:'en-US'});
    let page,f,watch,primary,released=false,hasPrimary=false;const evidence={width,states:[],proofs:[]};
    try{
      page=await context.newPage(); // Existing Playwright trace:on owns tracing and artifact retention.
      f=await fixture(page,{held:true});await searchFonts(page);
      await page.route('**/api/rewards/automatic',r=>r.fulfill({json:{status:'unavailable',schedules:[],serverTime:'2026-10-21T00:00:00Z'}}));
      watch=await range079Observe(page);await ready(page,width);await expect.poll(()=>f.requests()).toBe(1);
      evidence.fonts=await range079Setup(page);const original=await page.locator('#payment-history-to').elementHandle();
      await range079Conflict(page);await expect(note(page)).toHaveText('Waiting for the current payment history check to finish.');
      expect(f.requests()).toBe(1);expect(f.completed()).toBe(0);
      await f.release(null);released=true;await expect(note(page)).toHaveText('Payment history could not be fully checked. Try again shortly.');
      for(const [history,caption] of [[data('partial'),'Available history is incomplete.'],[data('partial',receipts),'Available history is incomplete.'],
        [data('onchain-indexed'),'Payment history check is complete.'],[data('onchain-indexed',receipts),'Payment history check is complete.']]){
        const announcements=await page.evaluate(()=>window.__range079.announcements.length);
        await refresh(page,f,history);await expect(note(page)).toHaveText(caption);await expect(list(page).locator('.empty-state')).toHaveText(range079Instruction);
        expect(await original.evaluate(e=>e.isConnected&&e===document.activeElement)).toBe(true);
        expect(await page.evaluate(()=>window.__range079.announcements.length)).toBe(announcements);
        evidence.states.push({source:history.status,sourceRows:history.verifiedPayouts.length,caption});
      }
      const before=watch.requests.length;await page.locator('#payment-history-from').fill('2026-10-20');await range079Restored(page);
      await expect(list(page).locator('.payment-history-row')).toHaveCount(2);
      await page.locator('#payment-history-from').fill('');await range079Restored(page);await expect(list(page).locator('.payment-history-row')).toHaveCount(2);
      await range079Conflict(page);const clear=page.locator('#payment-history-clear');
      if(width<700)await clear.tap();else await clear.click();await expect(clear).toBeFocused();await range079Restored(page);
      await expect(list(page).locator('.payment-history-row')).toHaveCount(2);expect(watch.requests.length).toBe(before);
      await range079Focus(page,await clear.elementHandle(),evidence.proofs);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);await page.screenshot({path:info.outputPath('range-states-'+width+'.png')});
    }catch(error){primary=error;hasPrimary=true;}finally{
      await range079Finish({context,watch,release:f&&!released?()=>f.release(null):null,info,evidence,name:'range-states-'+width,primary,hasPrimary});
    }
  });
}
