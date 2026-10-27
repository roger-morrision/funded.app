import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

for(const width of [390,1440])test(`FQA-026 coherent Analytics recipient states at ${width}px (mocked read-only history)`,async({page},info)=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:width===390?844:900});await page.clock.install();
  let history=null,requests=0,release,held=true;const errors=[],writes=[],states=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',r=>{const q=r.request();if(!['GET','HEAD','OPTIONS'].includes(q.method())){if(!(new URL(q.url()).pathname==='/api/solana/rpc'&&['getSlot','getMultipleAccounts','getAccountInfo'].includes(q.postDataJSON()?.method)))writes.push(q.url());return r.abort()}return new URL(q.url()).pathname==='/api/fee-policy'?r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}):r.fulfill({status:503,json:{error:'Offline Analytics fixture'}})});
  await page.route('**/api/evidence/payment-history',async r=>{requests++;if(held)await new Promise(resolve=>release=resolve);return history?r.fulfill({json:history}):r.fulfill({status:503,json:{error:'History unavailable fixture'}})});
  await page.goto('/#analytics-detail');await page.locator('body.workspace-ready.product-experience-ready').waitFor();
  const panel=page.locator('.recipients-panel'),count=panel.locator('.panel-count'),empty=panel.locator('.empty-state'),outside=page.locator('#connect-button');
  await expect.poll(()=>Boolean(release)).toBe(true);await expect(count).toHaveText('Checking payments');await expect(empty).toHaveText('Checking finalized payment history.');
  await expect(panel).not.toContainText('No finalized');await expect(panel).not.toContainText('No verified');
  await outside.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(outside).toBeFocused();
  const check=async(label,body)=>{await expect(count).toHaveText(label);if(body)await expect(empty).toHaveText(body);await expect(outside).toBeFocused();await expect(panel.locator('[data-payment-scope] a')).toHaveAttribute('href','#bonuses');expect(await panel.locator('[tabindex="0"], [role="status"], [aria-live]').count()).toBe(0);const tree=await panel.ariaSnapshot();expect(tree).toContain(label);if(body)expect(tree).toContain(body);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);states.push({label,tree})};
  held=false;release();await check('Payment history unavailable','Payment history is temporarily unavailable.');
  const refresh=async data=>{history=data;const before=requests;await page.clock.fastForward(60001);await expect.poll(()=>requests).toBeGreaterThan(before);await page.clock.runFor(100)};
  const data=(status,coverage,rows=[])=>({cluster:'devnet',status,...(coverage?{payoutCoverage:{scope:'v3-sol-recipient-receipts',status:coverage,recorded:coverage==="verified"?rows.length:110,verified:rows.length}}:{}),verifiedPayouts:rows});
  await refresh(data('unavailable','unavailable'));await check('Payment history unavailable','Payment history is temporarily unavailable.');
  await refresh(data('onchain-indexed','verified'));await check('No finalized payments','No finalized payout receipts are available yet.');
  await refresh(data('onchain-indexed'));await check('No finalized payments','No finalized payout receipts are available yet.');
  const partialBody='Verification coverage is incomplete. Verified recipient rows are not available in this response.';
  for(const [status,coverage] of [['partial','partial'],['onchain-indexed','partial'],['partial','verified']]){await refresh(data(status,coverage));await check('Partial payment history',partialBody);await expect(panel).not.toContainText('Checking');await expect(panel).not.toContainText('No finalized');}
  await refresh(data('unknown','verified'));await check('Payment history unavailable','Payment history is temporarily unavailable.');
  // Unknown coverage cannot become a definitive empty result despite indexed status.
  await refresh(data('onchain-indexed','unknown'));await check('Payment history unavailable','Payment history is temporarily unavailable.');
  await refresh({...data('onchain-indexed'),payoutCoverage:null});await check('Payment history unavailable','Payment history is temporarily unavailable.');
  const rows=Array.from({length:6},(_,i)=>({source:i===0?'daily-bonus':'v3-creator-wallet',to:'1'.repeat(32),signature:String(i+2).repeat(64),amountLamports:String(1000+i),actualReceivedLamports:900+i,recipientRentLamports:0,blockTime:1792274400+i}));
  await refresh(data('onchain-indexed','verified',rows));await check('Latest 5 of 6 finalized payments');await expect(panel.locator('.payment-row')).toHaveCount(5);
  const snapshot=async()=>panel.locator('.payment-row').evaluateAll(list=>list.map(e=>({text:e.textContent,href:e.querySelector('a').getAttribute('href'),time:e.querySelector('time').dateTime,accessibleName:e.querySelector('a').getAttribute('aria-label')})));
  const completeRows=await snapshot();expect(completeRows.map(x=>x.href)).toEqual(rows.slice(0,5).map(x=>`https://explorer.solana.com/tx/${x.signature}?cluster=devnet`));expect(completeRows[0].text).toContain('Daily bonus');expect(completeRows[0].text).toContain('0.0000009 SOL received');
  await refresh(data('partial','partial',rows));await check('Latest 5 of 6 finalized payments · partial coverage');expect(await snapshot()).toEqual(completeRows);
  await refresh(data('partial','unavailable',rows));await check('Latest 5 of 6 finalized payments · coverage unavailable');expect(await snapshot()).toEqual(completeRows);
  await refresh(data('partial','partial'));await check('Partial payment history',partialBody);await expect(panel.locator('.payment-row')).toHaveCount(0);
  await panel.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('partial-history.png')});expect(errors).toEqual([]);expect(writes).toEqual([]);
  await info.attach('recipient-states',{body:JSON.stringify({label:'Actual full-app renderer and60s poll; mocked read-only history and clock. No financial proof.',width,states,completeRows,errors,writes},null,2),contentType:'application/json'});
});

// FQA-062: real bootstrap and native navigation; API payloads are read-only fixtures.
function observeHistoryDestination({selector,hash='#payments/history'}) {
  window.__historyMotion = new Promise(resolve=>{
    const start=performance.now(),samples=[];let stable=null,last=null,frame,done=false;
    const finish=pass=>{if(done)return;done=true;cancelAnimationFrame(frame);clearTimeout(timer);resolve({pass,elapsedMs:performance.now()-start,stableMs:stable===null?0:performance.now()-stable,samples});};
    const tick=()=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e),m=s?(parseFloat(s.outlineWidth)||0)+Math.max(0,parseFloat(s.outlineOffset)||0):0,h=document.querySelector('.topbar'),n=document.querySelector('.mobile-workspace-nav'),top=h?.getClientRects().length?Math.max(0,h.getBoundingClientRect().bottom):0,bottom=n?.getClientRects().length?Math.min(innerHeight,n.getBoundingClientRect().top):innerHeight;
      const x={at:performance.now()-start,y:scrollY,focused:document.activeElement===e,current:location.hash===hash&&(hash!=='#payments/history'||(e?.getAttribute('aria-selected')==='true'&&!document.querySelector('#rewards-history')?.hidden)),clear:Boolean(r&&m>0&&e.matches(':focus-visible')&&s.outlineStyle!=='none'&&r.top-m>=top&&r.bottom+m<=bottom&&r.left-m>=0&&r.right+m<=innerWidth),rect:r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null};samples.push(x);if(x.at>1000)return finish(false);const position=JSON.stringify([x.y,x.rect]);if(x.focused&&x.current&&x.clear){if(stable===null||last!==position)stable=performance.now();last=position;if(performance.now()-stable>=100)return finish(true);}else stable=null;frame=requestAnimationFrame(tick);};
    const timer=setTimeout(()=>finish(false),1000);frame=requestAnimationFrame(tick);
  });
}
const historyAlphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const navigationReceipts=Array.from({length:23},(_,i)=>({source:i===22?'automatic-holder':'v3-creator-wallet',to:'8'.repeat(44),signature:historyAlphabet[i].repeat(88),amountLamports:100000+i,actualReceivedLamports:95000+i,feeLamports:5000,feePayer:'7'.repeat(44),blockTime:1792454400+i,slot:512479000+i}));
const navigationHistory=(status='onchain-indexed',coverage='verified',rows=navigationReceipts)=>({cluster:'devnet',status,payoutCoverage:{scope:'v3-sol-recipient-receipts',status:coverage,recorded:rows.length+ (coverage==='partial'?5:0),verified:rows.length},verifiedPayouts:rows});
async function analyticsHistoryFixture(page) {
  let value=navigationHistory(),held=false,release=[],requests=0,completed=0;const errors=[],writes=[],calls=[];
  const readMethods=new Set(['getSlot','getMultipleAccounts','getAccountInfo','getBalance','getGenesisHash','getLatestBlockhash','getBlockHeight','getMinimumBalanceForRentExemption','getFeeForMessage','getRecentPrioritizationFees','getTokenSupply','getTokenAccountBalance','getTokenLargestAccounts','getTokenAccountsByOwner','getSignaturesForAddress','getSignatureStatuses','getTransaction','getBlockTime','getProgramAccounts']);
  page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',r=>{const q=r.request(),path=new URL(q.url()).pathname;let methods=[];if(path==='/api/solana/rpc'&&q.method()==='POST'){const d=q.postDataJSON();methods=(Array.isArray(d)?d:[d]).map(x=>x?.method);}calls.push({path,method:q.method(),methods});if(!['GET','HEAD','OPTIONS'].includes(q.method())&&!(path==='/api/solana/rpc'&&methods.length&&methods.every(x=>readMethods.has(x))))writes.push({path,method:q.method()});return path==='/api/fee-policy'?r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}):r.fulfill({status:503,json:{error:'Controlled unavailable supporting service'}});});
  await page.route('**/api/evidence/payment-history',async r=>{requests++;if(held)await new Promise(resolve=>release.push(resolve));await(value?r.fulfill({json:value}):r.fulfill({status:503,json:{error:'Controlled History unavailable'}}));completed++;});
  return {errors,writes,calls,set:v=>value=v,hold:()=>held=true,release:()=>{held=false;for(const fn of release)fn();release=[];},requests:()=>requests,completed:()=>completed};
}
async function nativeTabTo(page,selector) {
  for(let i=0;i<90;i++){if(await page.locator(selector).evaluate(e=>e===document.activeElement))return;await page.keyboard.press('Tab');}
  throw Error('Native tab path did not reach '+selector);
}
for(const width of [360,390,1440])test('FQA-062 native Analytics to History, retained filters and traversal at '+width+'px',async({page},info)=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:width<700?844:900});const f=await analyticsHistoryFixture(page),motions=[];
  const refresh=async()=>{const completed=f.completed();await page.evaluate(()=>window.dispatchEvent(new Event('funded:route-change')));await expect.poll(()=>f.completed()).toBeGreaterThan(completed);};
  const strictTransition=async(action,selector='#rewards-history-tab',hash='#payments/history')=>{await page.evaluate(observeHistoryDestination,{selector,hash});await action();const result=await page.evaluate(()=>window.__historyMotion);motions.push(result);expect(result.pass,JSON.stringify(result)).toBe(true);expect(result.elapsedMs).toBeLessThanOrEqual(1000);expect(result.stableMs).toBeGreaterThanOrEqual(100);};
  await page.goto('/#analytics-detail');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.evaluate(()=>document.fonts.ready);
  const cta=page.getByRole('link',{name:'View payment history',exact:true}),panel=page.locator('.recipients-panel'),history=page.locator('#rewards-history-tab'),search=page.getByRole('searchbox',{name:'Search wallet or transaction',exact:true});
  await expect(cta).toHaveCount(1);await expect(cta).toHaveAttribute('href','#payments/history');await expect(panel.locator('.payment-row')).toHaveCount(5);await expect(panel.locator('.panel-count')).toHaveText('Latest 5 of 23 finalized payments');
  const rowSnapshot=()=>panel.locator('.payment-row').evaluateAll(list=>list.map(e=>({text:e.textContent,href:e.querySelector('a').getAttribute('href'),time:e.querySelector('time').dateTime})));const rows=await rowSnapshot();
  expect(rows.map(r=>r.href)).toEqual(navigationReceipts.slice(0,5).map(r=>'https://explorer.solana.com/tx/'+r.signature+'?cluster=devnet'));await expect(panel.locator('[data-payment-scope] a')).toHaveAttribute('href','#bonuses');
  const geometry=await cta.evaluate(e=>{const r=e.getBoundingClientRect(),h=e.parentElement.querySelector('.panel-count').getBoundingClientRect(),s=getComputedStyle(e);return{height:r.height,font:parseFloat(s.fontSize),gap:r.top-h.bottom,overflow:document.documentElement.scrollWidth>innerWidth};});expect(geometry.overflow).toBe(false);if(width<700){expect(geometry.height).toBeGreaterThanOrEqual(44);expect(geometry.font).toBeGreaterThanOrEqual(14);expect(geometry.gap).toBeGreaterThanOrEqual(8);}
  expect(await page.evaluate(()=>document.activeElement===document.body)).toBe(true);await nativeTabTo(page,'#analytics-collection-history-summary');await strictTransition(()=>page.keyboard.press('Tab'),'#analytics-payment-history','#analytics-detail');await expect(cta).toBeFocused();const ctaNode=await cta.elementHandle(),ctaScroll=await page.evaluate(()=>scrollY);await refresh();expect(await page.evaluate(()=>scrollY)).toBe(ctaScroll);expect(await ctaNode.evaluate(e=>e===document.activeElement&&e.isConnected)).toBe(true);expect(await rowSnapshot()).toEqual(rows);
  await page.screenshot({path:info.outputPath('analytics-history-cta.png')});const initialLength=await page.evaluate(()=>history.length);await strictTransition(()=>page.keyboard.press('Enter'));await expect(page).toHaveURL(/#payments[/]history$/);await expect(history).toBeFocused();await expect(history).toHaveAttribute('aria-controls','rewards-history');await expect(page.locator('#rewards-history')).toHaveAttribute('aria-labelledby','rewards-history-tab');await expect(page).toHaveTitle('Rewards · funded.vip');await expect(page.locator('.nav-item[href="#payments"]')).toHaveAttribute('aria-current','page');if(width<700)await expect(page.locator('.mobile-workspace-nav a[href="#payments"]')).toHaveAttribute('aria-current','page');expect(await page.evaluate(()=>history.length)).toBe(initialLength+1);
  await nativeTabTo(page,'#payment-history-search');await expect(search).toHaveAccessibleDescription('Filters available confirmed records. Wallet addresses and transaction signatures are case-sensitive.');const beforeLocal=f.requests();await page.keyboard.type(navigationReceipts[11].signature);await expect(page.locator('#payment-list .payment-history-row:visible')).toHaveCount(1);await expect(page.locator('#payment-list .payment-receipt-link:visible')).toHaveAttribute('href',new RegExp(navigationReceipts[11].signature));expect(f.requests()).toBe(beforeLocal);
  await page.keyboard.press('ArrowLeft');const retained=await search.elementHandle(),caret=await search.evaluate(e=>e.selectionStart);await refresh();expect(await retained.evaluate(e=>e===document.activeElement&&e.isConnected)).toBe(true);expect(await search.evaluate(e=>e.selectionStart)).toBe(caret);await expect(search).toHaveValue(navigationReceipts[11].signature);
  await page.keyboard.press('Escape');await expect(search).toHaveValue('');await page.keyboard.press('Tab');await page.keyboard.press('h');await expect(page.locator('#payment-history-type')).toHaveValue('holder');await nativeTabTo(page,'#payment-history-clear');await page.keyboard.press('Enter');await expect(page.locator('#payment-history-type')).toHaveValue('all');await expect(search).toHaveValue('');
  await history.click();await page.keyboard.press('Home');await expect(page.locator('#rewards-overview-tab')).toHaveAttribute('aria-selected','true');await refresh();await expect(page.locator('#rewards-overview-tab')).toHaveAttribute('aria-selected','true');await page.keyboard.press('End');await expect(history).toHaveAttribute('aria-selected','true');
  await search.click();await page.keyboard.type(navigationReceipts[0].to);await page.locator('#payment-history-type').selectOption('creator');await page.locator('#payment-history-from').fill('2026-10-20');await page.locator('#payment-history-to').fill('2026-10-20');await page.getByRole('button',{name:'Next payment history page',exact:true}).click();await expect(page.locator('nav[aria-label="Payment history pages"]')).toContainText('Page 2 of 3');const filterState={query:navigationReceipts[0].to,type:'creator',from:'2026-10-20',to:'2026-10-20',page:'Page 2 of 3'};const details=page.locator('#payment-list .payment-history-row:visible details').first();await details.locator('summary').click();const key=await details.getAttribute('data-receipt-key'),receipt=await details.textContent();await refresh();await expect(page.locator('details[data-receipt-key="'+key+'"]').first()).toHaveAttribute('open','');expect(await page.locator('details[data-receipt-key="'+key+'"]').first().textContent()).toBe(receipt);
  await page.keyboard.press('Shift+Tab');await strictTransition(()=>page.goBack(),'#route-guide-title','#analytics-detail');await expect(page).toHaveURL(/#analytics-detail$/);await expect(panel).toBeVisible();expect(await page.evaluate(()=>!!document.activeElement?.getClientRects().length&&!document.activeElement.closest('[hidden]'))).toBe(true);expect(await rowSnapshot()).toEqual(rows);await strictTransition(()=>page.goForward());await expect(history).toHaveAttribute('aria-selected','true');expect(await page.evaluate(()=>history.length)).toBe(initialLength+1);await expect(page.locator('details[data-receipt-key="'+key+'"]').first()).toHaveAttribute('open','');await expect(search).toHaveValue(filterState.query);await expect(page.locator('#payment-history-type')).toHaveValue(filterState.type);await expect(page.locator('#payment-history-from')).toHaveValue(filterState.from);await expect(page.locator('#payment-history-to')).toHaveValue(filterState.to);await expect(page.locator('nav[aria-label="Payment history pages"]')).toContainText(filterState.page);
  await page.goBack();await nativeTabTo(page,'#analytics-payment-history');await strictTransition(()=>page.keyboard.press('Enter'));expect(await page.evaluate(()=>history.length)).toBe(initialLength+1);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('analytics-history-native.png')});await info.attach('navigation-evidence',{body:JSON.stringify({width,qualification:'Actual bootstrap, native keyboard entry/control path and browser protocol Back/Forward; deterministic read-only history. Date/type retained-state preconditions use supported input actions, not proof of native date-widget entry. No public/on-chain proof.',geometry,motions,rows,calls:f.calls,errors:f.errors,writes:f.writes},null,2),contentType:'application/json'});
});
for(const width of [360,390,1440])test.describe('FQA-062 pointer context '+width,()=>{test.use({hasTouch:width<700});test('FQA-062 direct alias and contextual History source states at '+width+'px',async({page},info)=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:width<700?844:900});const f=await analyticsHistoryFixture(page),states=[];
  await page.goto('/#payments/history');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await expect(page.locator('#rewards-history-tab')).toHaveAttribute('aria-selected','true');const length=await page.evaluate(()=>history.length);await page.reload();await page.locator('body.workspace-ready.product-experience-ready').waitFor();await expect(page.locator('#rewards-history')).toBeVisible();expect(await page.evaluate(()=>history.length)).toBe(length);await expect(page).toHaveTitle('Rewards · funded.vip');
  await page.goto('/#payments');await page.reload();await page.locator('body.workspace-ready.product-experience-ready').waitFor();await expect(page.locator('#rewards-overview-tab')).toHaveAttribute('aria-selected','true');
  for(const state of [{name:'loading',data:null,count:'Checking payments'},{name:'empty',data:navigationHistory('onchain-indexed','verified',[]),count:'No finalized payments'},{name:'partial-empty',data:navigationHistory('partial','partial',[]),count:'Partial payment history'},{name:'partial-rows',data:navigationHistory('partial','partial'),count:'Latest 5 of 23 finalized payments · partial coverage'},{name:'loaded',data:navigationHistory(),count:'Latest 5 of 23 finalized payments'},{name:'unavailable',data:null,count:'Payment history unavailable'}]){
    f.set(state.data);if(state.name==='loading')f.hold();await page.goto('/#analytics-detail');await page.reload();await page.locator('body.workspace-ready.product-experience-ready').waitFor();const panel=page.locator('.recipients-panel'),cta=page.getByRole('link',{name:'View payment history',exact:true});await expect(cta).toHaveCount(1);await expect(panel.locator('.panel-count')).toHaveText(state.count);const caption=await panel.locator('.panel-count').textContent(),scope=await panel.locator('[data-payment-scope]').textContent().catch(()=>null);if(width<700)await cta.tap();else await cta.click();await expect(page.locator('#rewards-history-tab')).toHaveAttribute('aria-selected','true');await expect(page.locator('#rewards-history-tab')).toBeFocused();await expect(page.locator('#rewards-history')).toBeVisible();
    if(state.name==='loading'){await expect(page.locator('#payment-history-footnote')).toHaveText('Waiting for the current payment history check to finish.');f.set(navigationHistory());f.release();await expect(page.locator('#payment-list .payment-history-row')).toHaveCount(23);}else if(['empty','partial-empty','unavailable'].includes(state.name)){await expect(page.locator('#payment-list .payment-history-row')).toHaveCount(0);await expect(page.locator('#payment-history-footnote')).toContainText(state.name==='empty'?/No|0 of 0/:state.name==='partial-empty'?/partial|incomplete/i:/Payment history could not be fully checked. Try again shortly./);}else await expect(page.locator('#payment-list .payment-history-row')).toHaveCount(23);
    states.push({name:state.name,caption,scope,history:await page.locator('#rewards-history').innerText()});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);await info.attach('contextual-history-states',{body:JSON.stringify({width,qualification:'Actual full bootstrap and native pointer activations; controlled source states; no real wallet/chain/financial action. Pointer focus is ownership evidence, keyboard strict outline proof is in separate native journey.',states,calls:f.calls},null,2),contentType:'application/json'});
});});

// FQA-076 / UX-057: native disclosure in the real bootstrap; synthetic read-only evidence.
const collectionSummary = '#analytics-collection-history-summary';
const collectionBody = '#analytics-collection-history-body';
const collectionRows = [
  {signature:'1'.repeat(63)+'2',mint:'1'.repeat(31)+'2',slot:101,blockTime:1792627200,collectedLamports:'9007199254740993'},
  {signature:'1'.repeat(63)+'3',mint:'1'.repeat(31)+'2',slot:102,blockTime:1792540800,collectedLamports:'7'},
  {signature:'1'.repeat(63)+'4',mint:'1'.repeat(31)+'2',slot:103,blockTime:null,collectedLamports:'11'}
];
const collectionPayload = (rows, patch = {}) => ({cluster:'devnet',scope:'verified-v3-collections',commitment:'finalized',
  status:'partial',generatedAt:'2026-10-23T04:00:00Z',verifiedCollections:rows,
  coverage:{recordedCollections:12,verifiedCollections:rows.length},...patch});

function observeCollectionHistoryControl(original, readiness = {}) {
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

async function collectionArm(page, original, key) {
  await original.evaluate((element,{source,key})=>{
    let resolve;
    const state=window.__collectionHistoryProof={promise:new Promise(r=>resolve=r),events:[]};
    const focus=event=>state.events.push({original:event.target===element,id:event.target.id});
    document.addEventListener('focusin',focus,true);
    const begin=event=>{
      if(!event.isTrusted||event.key!==key)return;
      window.removeEventListener('keydown',begin,true);
      state.began=performance.now();state.trigger={type:event.type,key:event.key,trusted:event.isTrusted};
      (new Function('return ('+source+')')())(element,{hash:'#analytics-detail'}).then(proof=>{
        document.removeEventListener('focusin',focus,true);
        resolve({proof,trigger:state.trigger,events:state.events,began:state.began,ended:performance.now(),
          active:document.activeElement===element,connected:element.isConnected});
      });
    };
    window.addEventListener('keydown',begin,true);
  },{source:observeCollectionHistoryControl.toString(),key});
}
async function collectionProof(page,original,key,phase,focusEntry=false) {
  await collectionArm(page,original,key);await page.keyboard.press(key===' '?'Space':key);
  const value=await page.evaluate(()=>window.__collectionHistoryProof.promise);
  await test.info().attach('collection-native-'+phase,{body:JSON.stringify(value),contentType:'application/json'});
  expect(value.proof.pass,JSON.stringify(value)).toBe(true);expect(value.ended-value.began).toBeLessThanOrEqual(1000);
  expect(value.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);
  expect(value.active&&value.connected&&value.trigger.trusted).toBe(true);expect(value.events.every(e=>e.original)).toBe(true);
  if(focusEntry)expect(value.events.some(e=>e.original)).toBe(true);
}
async function collectionRead(page,locator,label) {
  const inspect=async()=>{
    const handle=await locator.elementHandle();
    if(!handle)throw Error('Collection reading element unavailable');
    try {
      return await handle.evaluate(e=>{
    const r=e.getBoundingClientRect(),bounds={left:0,right:innerWidth,top:0,bottom:innerHeight},clips=[];
    const root=getComputedStyle(document.documentElement);
    for(const chrome of document.querySelectorAll('.topbar,.mobile-workspace-nav')) {
      if(!chrome.getClientRects().length)continue;const box=chrome.getBoundingClientRect();
      if(chrome.matches('.topbar'))bounds.top=Math.max(bounds.top,box.bottom);else bounds.bottom=Math.min(bounds.bottom,box.top);
    }
    for(let a=e.parentElement;a;a=a.parentElement) {
      const s=getComputedStyle(a),box=a.getBoundingClientRect(),x=/^(hidden|clip|auto|scroll)$/.test(s.overflowX),y=/^(hidden|clip|auto|scroll)$/.test(s.overflowY);
      const viewport=a===document.documentElement||(a===document.body&&root.overflowX==='visible'&&root.overflowY==='visible'&&root.contain==='none'&&s.contain==='none');
      if((x||y)&&!viewport) {
        const clip={id:a.id,x,y,left:box.left+a.clientLeft,top:box.top+a.clientTop,right:box.left+a.clientLeft+a.clientWidth,bottom:box.top+a.clientTop+a.clientHeight};clips.push(clip);
        if(x){bounds.left=Math.max(bounds.left,clip.left);bounds.right=Math.min(bounds.right,clip.right);}
        if(y){bounds.top=Math.max(bounds.top,clip.top);bounds.bottom=Math.min(bounds.bottom,clip.bottom);}
      }
    }
    const nodes=[e,...e.querySelectorAll('th,td,p,caption')],textStyles=nodes.map(n=>{
      const css=getComputedStyle(n),box=n.getBoundingClientRect();const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let t,lines=[];
      while(t=walker.nextNode()){if(!t.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(t);lines.push(...[...range.getClientRects()].map(q=>({left:q.left,right:q.right,top:q.top,bottom:q.bottom})));}
      return{text:n.textContent,textOverflow:css.textOverflow,whiteSpace:css.whiteSpace,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,
        textContained:lines.every(q=>q.left>=box.left-1&&q.right<=box.right+1&&q.top>=box.top-1&&q.bottom<=box.bottom+1)};
    });
    return{label:null,text:e.textContent,top:r.top,bottom:r.bottom,left:r.left,right:r.right,bounds,clips,textStyles,
      full:r.top>=bounds.top&&r.bottom<=bounds.bottom&&r.left>=bounds.left&&r.right<=bounds.right,
      overflow:document.documentElement.scrollWidth>innerWidth};
  });
    } finally {
      await handle.dispose();
    }
  };
  for(let i=0;i<180;i++) {
    const value=await inspect();if(value.full) {
      expect(value.overflow).toBe(false);expect(value.textStyles.every(s=>s.textOverflow!=='ellipsis'&&s.whiteSpace!=='nowrap'&&s.scrollWidth<=s.clientWidth+1&&s.textContained),JSON.stringify(value)).toBe(true);
      return{...value,label,arrows:i};
    }
    await page.keyboard.press(value.top<value.bounds.top?'ArrowUp':'ArrowDown');await page.evaluate(()=>new Promise(requestAnimationFrame));
  }
  throw Error('Native reading could not reveal '+label+': '+JSON.stringify(await inspect()));
}
async function collectionFixture(page,width,mode) {
  const origin=new URL(test.info().project.use.baseURL).origin;
  const f={api:[],rpc:[],errors:[],failed:[],forbidden:[],responses:[],finishedTasks:[],receiptRequests:0,release:null,receiptFixturePhase:'initial',receiptGeneration:0,receiptPhaseArms:[]};
  f.armReceiptPhase=phase=>{
    if(!['invalid','recovery'].includes(phase)||f.receiptGeneration!==0)throw Error('Exactly one explicit receipt phase transition required');
    f.receiptPhaseArms.push({from:f.receiptFixturePhase,to:phase,generation:++f.receiptGeneration,at:new Date().toISOString(),started:f.receiptRequests,finished:f.responses.filter(r=>r.path==='/api/evidence/receipts').length});
    f.receiptFixturePhase=phase;
  };
  const records=new WeakMap(),receiptDispatchPhases=new WeakMap();let next=0;
  page.on('request',q=>{if(new URL(q.url()).pathname==='/api/evidence/receipts')receiptDispatchPhases.set(q,{phase:f.receiptFixturePhase,generation:f.receiptGeneration,startedAt:new Date().toISOString()});});
  page.on('pageerror',e=>f.errors.push(e.message));page.on('requestfailed',q=>f.failed.push({url:q.url(),method:q.method(),error:q.failure()?.errorText}));
  page.on('requestfinished',q=>{const record=records.get(q);if(!record)return;
    f.finishedTasks.push((async()=>{const response=await q.response();record.finishedError=await response.finished();
      record.actualStatus=response.status();record.actualHeaders=await response.allHeaders();record.actualBody=await response.text();record.finishedAt=new Date().toISOString();f.responses.push(record);})().catch(error=>{f.errors.push('Response lifecycle: '+error.message);}));
  });
  await page.setViewportSize({width,height:width<700?844:900});
  await page.route('**/*',async route=>{
    const q=route.request(),u=new URL(q.url()),method=q.method();
    if(u.origin!==origin){if(method==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return route.continue();f.forbidden.push({url:q.url(),method});return route.abort();}
    if(!u.pathname.startsWith('/api/')){if(!['GET','HEAD','OPTIONS'].includes(method))f.forbidden.push({url:q.url(),method});return route.continue();}
    const record={id:'fqa076-'+(++next),url:q.url(),path:u.pathname,method,startedAt:new Date().toISOString(),postData:q.postData(),fulfilled:false};
    records.set(q,record);f.api.push(record);
    const fulfill=async(status,json)=>{record.expectedStatus=status;record.expectedBody=JSON.stringify(json);await route.fulfill({status,contentType:'application/json',headers:{'x-fqa076-read-id':record.id},body:record.expectedBody});record.fulfilled=true;};
    if(u.pathname==='/api/solana/rpc') {
      let payload;try{payload=q.postDataJSON();}catch{}const calls=Array.isArray(payload)?payload:[payload];
      if(method!=='POST'||!calls.length||!calls.every(c=>c&&['getSlot','getGenesisHash','getAccountInfo','getMultipleAccounts'].includes(c.method))){f.forbidden.push(record);return fulfill(403,{error:'Read-only collection fixture'});}
      f.rpc.push(...calls);const rows=calls.map(c=>({jsonrpc:'2.0',id:c.id,result:c.method==='getSlot'?100:c.method==='getGenesisHash'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG':{context:{slot:100},value:c.method==='getMultipleAccounts'?(c.params?.[0]||[]).map(()=>null):null}}));
      return fulfill(200,Array.isArray(payload)?rows:rows[0]);
    }
    if(!['GET','HEAD','OPTIONS'].includes(method)){f.forbidden.push(record);return fulfill(403,{error:'No writes'});}
    if(u.pathname==='/api/fee-policy')return fulfill(200,{split:PROTOCOL_FEE_SPLIT});
    if(u.pathname==='/api/rewards/automatic')return fulfill(200,{status:'unavailable',reason:'Offline collection fixture',schedules:[],serverTime:'2026-10-23T04:00:00.000Z'});
    if(u.pathname==='/api/evidence/receipts') {
      const dispatch=receiptDispatchPhases.get(q);if(!dispatch)throw Error('Original receipt request dispatch phase unavailable');
      record.receiptPhase=++f.receiptRequests;record.receiptFixturePhase=dispatch.phase;record.receiptGeneration=dispatch.generation;record.receiptDispatchedAt=dispatch.startedAt;
      if(mode==='recovery'&&record.receiptFixturePhase==='initial'&&record.receiptPhase===1){await new Promise(resolve=>f.release=resolve);return fulfill(503,{error:'Controlled initial collection evidence unavailable'});}
      if(mode==='populated'&&record.receiptFixturePhase==='initial')return fulfill(200,collectionPayload(collectionRows));
      if(record.receiptFixturePhase==='invalid')return fulfill(200,collectionPayload([collectionRows[0],{...collectionRows[0],collectedLamports:'1'}]));
      if(record.receiptFixturePhase==='initial')return fulfill(503,{error:'Controlled initial collection evidence unavailable'});
      return fulfill(200,collectionPayload(collectionRows.map(row=>({...row,blockTime:null}))));
    }
    return fulfill(503,{error:'Controlled unavailable collection supporting service'});
  });
  return f;
}
async function collectionFont(page) {
  const value=await page.evaluate(async()=>{
    const requests=['700 14px "Manrope"','500 12px "DM Mono"'],loaded=[];
    for(const request of requests){const faces=await document.fonts.load(request,'Available 9007199.254740993');loaded.push({request,available:document.fonts.check(request),faces:faces.map(f=>({family:f.family,weight:f.weight,style:f.style,status:f.status}))});}
    await document.fonts.ready;return loaded;
  });
  await test.info().attach('collection-loaded-fonts',{body:JSON.stringify(value),contentType:'application/json'});
  expect(value.every(v=>v.available&&v.faces.length&&v.faces.every(f=>f.status==='loaded'))).toBe(true);
}
async function collectionNoDisclosureIo(page,f,action) {
  const before={requests:f.api.length,storage:await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)])),hash:new URL(page.url()).hash};
  await action();expect(f.api.length).toBe(before.requests);expect(new URL(page.url()).hash).toBe(before.hash);
  expect(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]))).toBe(before.storage);
}
async function collectionFinish(f,info) {
  await expect.poll(()=>f.api.filter(r=>!r.finishedAt).length).toBe(0);
  await Promise.all(f.finishedTasks);
  await info.attach('collection-read-only-lifecycle',{body:JSON.stringify({...f,release:undefined,finishedTasks:undefined,
    qualification:'Instrumented local synthetic API fixtures, actual completed Request/Response bodies and unique response markers. No chain outcome or passive public receipt claim.'},null,2),contentType:'application/json'});
  expect(f.errors).toEqual([]);expect(f.failed).toEqual([]);expect(f.forbidden).toEqual([]);
  expect(f.responses.length).toBe(f.api.length);
  for(const r of f.responses){expect(r.finishedError).toBeNull();expect(r.fulfilled).toBe(true);expect(r.actualStatus).toBe(r.expectedStatus);expect(r.actualBody).toBe(r.expectedBody);expect(r.actualHeaders['x-fqa076-read-id']).toBe(r.id);}
}
async function collectionRefreshProof(page,original,details,f,phase) {
  const generation=f.receiptGeneration;expect(generation).toBe(1);
  const completed=()=>f.responses.filter(r=>r.path==='/api/evidence/receipts'&&r.receiptGeneration===generation);
  const prior=completed().length;
  const focus=await original.evaluate(e=>{
    window.__collectionRefreshFocus=[];const listener=event=>window.__collectionRefreshFocus.push({original:event.target===e,id:event.target.id});
    document.addEventListener('focusin',listener,true);window.__collectionRefreshFocusCleanup=()=>document.removeEventListener('focusin',listener,true);
    return{active:document.activeElement===e,open:e.parentElement.open};
  });
  expect(focus.active).toBe(true);
  // The app already polls every60000ms. No clock manipulation, synthetic route event or extra request.
  await expect.poll(()=>completed().length,{timeout:70000}).toBeGreaterThan(prior);
  expect(completed().every(r=>r.fulfilled&&r.finishedError===null&&r.actualHeaders['x-fqa076-read-id']===r.id)).toBe(true);
  expect(await original.evaluate(e=>e.isConnected&&e===document.getElementById('analytics-collection-history-summary')&&document.activeElement===e)).toBe(true);
  expect(await details.evaluate(e=>e.isConnected&&e===document.getElementById('analytics-collection-history'))).toBe(true);
  expect(await details.evaluate(e=>e.open)).toBe(focus.open);
  const proof=await original.evaluate(observeCollectionHistoryControl,{hash:'#analytics-detail'});
  const events=await page.evaluate(()=>{window.__collectionRefreshFocusCleanup();return window.__collectionRefreshFocus;});
  await test.info().attach('collection-refresh-'+phase,{body:JSON.stringify({proof,events,focus,receiptRequests:f.receiptRequests}),contentType:'application/json'});
  expect(proof.pass,JSON.stringify(proof)).toBe(true);expect(events).toEqual([]);
}
for(const width of [360,390,1440]) {
  test(`FQA-076 native collection dates reading and invalid-refresh clearing at ${width}px`,async({page},info)=>{
    test.setTimeout(90000);const f=await collectionFixture(page,width,'populated'),reading=[];
    try {
      await page.goto('/#analytics-detail');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await collectionFont(page);
      const summary=page.locator(collectionSummary),body=page.locator(collectionBody),details=await page.locator('#analytics-collection-history').elementHandle(),original=await summary.elementHandle();
      expect(await details.evaluate(e=>e.open)).toBe(false);await expect(summary).toHaveText('Available collection history');await expect(body).toHaveAttribute('data-state','partial');
      expect(await page.evaluate(()=>document.activeElement===document.body)).toBe(true);
      await collectionProof(page,original,'Tab','initial-entry',true);expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
      for(const [key,open,label] of [['Enter',true,'enter-open'],['Enter',false,'enter-close'],[' ',true,'space-open'],[' ',false,'space-close'],['Enter',true,'read-open']]) {
        await collectionNoDisclosureIo(page,f,()=>collectionProof(page,original,key,label));expect(await details.evaluate(e=>e.open)).toBe(open);
      }
      await expect(body.locator('[data-collection-coverage]')).toHaveText('3 of 12 recorded collections verified · partial coverage');
      await expect(body.locator('time')).toHaveAttribute('datetime','2026-10-23T04:00:00.000Z');
      await expect(body.locator('thead th')).toHaveText(['Date (UTC)','Collected (SOL)','Receipts']);
      await expect(body.locator('tbody th')).toHaveText(['2026-10-22','2026-10-21','Date unavailable']);
      await expect(body.locator('tbody tr').first().locator('td').first()).toHaveText('9007199.254740993');
      await expect(body.locator('[data-collection-total]')).toHaveText('9007199.254741011');
      expect(await body.locator('th[scope="col"]').count()).toBe(3);expect(await body.locator('tbody th[scope="row"]').count()).toBe(3);await expect(body.locator('caption')).toBeVisible();
      for(const [selector,label] of [['h3','heading'],['[data-collection-scope]','coverage-and-checked-time'],['[data-collection-context]','basis-and-caveats'],['table','sparse-table-exact-and-undated']])reading.push(await collectionRead(page,body.locator(selector),label));
      await info.attach('collection-native-reading',{body:JSON.stringify(reading),contentType:'application/json'});await page.screenshot({path:info.outputPath(`collection-reading-${width}.png`)});
      await collectionRead(page,summary,'return-to-original-summary');
      f.armReceiptPhase('invalid');await collectionRefreshProof(page,original,details,f,'open-invalid');await expect(body).toHaveAttribute('data-state','unavailable');
      await expect(body.locator('table')).toBeHidden();await expect(body.locator('tbody tr')).toHaveCount(0);await expect(body.locator('[data-collection-total]')).toBeEmpty();
      await expect(body.locator('[data-collection-coverage]')).toHaveText('Collection coverage unavailable.');
      await collectionNoDisclosureIo(page,f,()=>collectionProof(page,original,' ','close-after-invalid'));expect(await details.evaluate(e=>e.open)).toBe(false);
      await collectionNoDisclosureIo(page,f,()=>summary.click());expect(await details.evaluate(e=>e.open)).toBe(true);
      await collectionNoDisclosureIo(page,f,()=>summary.click());expect(await details.evaluate(e=>e.open)).toBe(false);
      await info.attach('collection-semantic-tree',{body:await page.locator('#analytics-collection-history').ariaSnapshot(),contentType:'text/plain'});
    } finally {if(f.release)f.release();await collectionFinish(f,info);}
  });
  test(`FQA-076 native loading unavailable and closed-refresh all-undated recovery at ${width}px`,async({page},info)=>{
    test.setTimeout(90000);const f=await collectionFixture(page,width,'recovery');
    try {
      await page.goto('/#analytics-detail');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await collectionFont(page);
      const summary=page.locator(collectionSummary),body=page.locator(collectionBody),details=await page.locator('#analytics-collection-history').elementHandle(),original=await summary.elementHandle();
      await expect.poll(()=>Boolean(f.release)).toBe(true);await expect(body).toHaveAttribute('data-state','loading');expect(await details.evaluate(e=>e.open)).toBe(false);
      expect(await page.evaluate(()=>document.activeElement===document.body)).toBe(true);await collectionProof(page,original,'Tab','loading-entry',true);
      await collectionNoDisclosureIo(page,f,()=>collectionProof(page,original,'Enter','loading-open'));await expect(body.locator('table')).toBeHidden();
      await expect(body.locator('[data-collection-message]')).toHaveText('Checking collection history.');await expect(body.locator('[data-collection-total]')).toBeEmpty();
      f.release();await expect(body).toHaveAttribute('data-state','unavailable');await expect(body.locator('tbody tr')).toHaveCount(0);await expect(summary).toBeFocused();
      await collectionProof(page,original,' ','unavailable-close');expect(await details.evaluate(e=>e.open)).toBe(false);
      await expect.poll(()=>f.responses.filter(r=>r.path==='/api/evidence/receipts').length).toBe(1);
      f.armReceiptPhase('recovery');await collectionRefreshProof(page,original,details,f,'closed-recovery');await expect(body).toHaveAttribute('data-state','partial');
      expect(await details.evaluate(e=>e.open)).toBe(false);await collectionNoDisclosureIo(page,f,()=>collectionProof(page,original,'Enter','recovery-open'));
      await expect(body.locator('tbody th')).toHaveText('Date unavailable');await expect(body.locator('tbody td')).toHaveText(['9007199.254741011','3']);
      await expect(body.locator('[data-collection-coverage]')).toHaveText('3 of 12 recorded collections verified · partial coverage');
      const reading=[];for(const [selector,label] of [['h3','heading'],['[data-collection-scope]','coverage-and-checked-time'],['[data-collection-context]','basis-and-caveats'],['table','all-undated-exact-table']])reading.push(await collectionRead(page,body.locator(selector),label));
      await info.attach('collection-recovery-reading',{body:JSON.stringify(reading),contentType:'application/json'});await page.screenshot({path:info.outputPath(`collection-recovery-${width}.png`)});
      await collectionRead(page,summary,'return-to-original-summary');await collectionProof(page,original,' ','recovery-close');expect(await details.evaluate(e=>e.open)).toBe(false);
      await collectionNoDisclosureIo(page,f,()=>summary.click());expect(await details.evaluate(e=>e.open)).toBe(true);await collectionNoDisclosureIo(page,f,()=>summary.click());expect(await details.evaluate(e=>e.open)).toBe(false);
    } finally {if(f.release)f.release();await collectionFinish(f,info);}
  });
}
