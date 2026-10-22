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
    await page.locator('#payment-history-from').fill('2026-10-21');await expect(list(page).locator('.empty-state')).toHaveText('No confirmed payments match this search and these filters.');await page.locator('#payment-history-from').fill('2026-10-20');await page.locator('#payment-history-type').selectOption('holder');await expect(list(page).locator('.empty-state')).toHaveText('No confirmed payments match this search and these filters.');await page.locator('#payment-history-type').selectOption('all');
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
