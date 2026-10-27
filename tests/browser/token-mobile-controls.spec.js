import {test,expect} from '@playwright/test';
import {PublicKey} from '@solana/web3.js';
import {PUMP_SDK,bondingCurvePda} from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z',tokenProgram='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const controls='[data-coin-chart-period],[data-coin-chart-metric],[data-coin-chart-unit],[data-coin-pulse-period]';
async function fixture(page){
  const errors=[],writes=[],reads=[];let state='loading',release;const gate=new Promise(r=>release=r);
  const curve=await PUMP_SDK.offlinePumpProgram.coder.accounts.encode('bondingCurve',{virtualTokenReserves:new BN('1000000000000'),virtualQuoteReserves:new BN('30000000000'),realTokenReserves:new BN('700000000000'),realQuoteReserves:new BN('1000000000'),tokenTotalSupply:new BN('1000000000000000'),complete:false,creator:new PublicKey(mint),isMayhemMode:false,isCashbackCoin:false,quoteMint:PublicKey.default,creatorFeeBps:new BN(0),canEditCreatorFee:false,isHolderReward:false});
  const curveAddress=bondingCurvePda(new PublicKey(mint)).toBase58();
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',r=>{const q=r.request(),u=new URL(q.url());return q.method()==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname)?r.continue():r.abort();});
  await page.route('**/api/**',async r=>{
    const q=r.request(),u=new URL(q.url());reads.push({path:u.pathname,method:q.method()});
    if(u.pathname==='/api/fee-policy')return r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}});
    if(u.pathname.endsWith('/market-activity')){
      if(state==='loading')await gate;
      if(state==='unavailable')return r.fulfill({status:400,json:{error:'Deterministic unavailable market read'}});
      const now=Math.floor(Date.now()/1000),trades=[{signature:'3'.repeat(64),trader:mint,side:'buy',priceRatio:2,blockTime:now-1800,solLamports:100000000},{signature:'4'.repeat(64),trader:mint,side:'sell',priceRatio:1,blockTime:now-2400,solLamports:200000000}];
      const partial=state==='partial',rows=state==='empty'||partial?[]:state==='one'?trades.slice(0,1):trades;
      const pulse=n=>({tradeCount:n,traderCount:n?1:0,volumeSol:n*.1,buyVolumeSol:n*.1,sellVolumeSol:0,buyCount:n,sellCount:0,largestTradeSol:n?.1:0,coverage:partial?'partial':'complete'});
      return r.fulfill({json:{cluster:'devnet',coverage:partial?'partial':'complete',recentTrades:rows,activityWindows:{'5m':pulse(0),'1h':pulse(rows.length),'6h':pulse(rows.length),'24h':pulse(rows.length)},tradeCount24h:rows.length,buyCount24h:rows.length,sellCount24h:0,volume24hSol:rows.length*.1,buyVolume24hSol:rows.length*.1,sellVolume24hSol:0,solUsdPrice:100}});
    }
    if(u.pathname==='/api/solana/rpc'){
      const body=q.postDataJSON(),calls=Array.isArray(body)?body:[body];
      const responses=calls.map(c=>{let result=null;
        if(c.method==='getSlot')result=100;
        else if(c.method==='getAccountInfo'){
          const address=c.params?.[0];let value=null;
          if(address===mint)value={lamports:1000000,executable:false,owner:tokenProgram,rentEpoch:0,data:{program:'spl-token',parsed:{type:'mint',info:{decimals:6,supply:'1000000000000000',isInitialized:true,mintAuthority:null,freezeAuthority:null}},space:82}};
          if(address===curveAddress)value={lamports:1000000,executable:false,owner:PUMP_SDK.offlinePumpProgram.programId.toBase58(),rentEpoch:0,data:[curve.toString('base64'),'base64']};
          result={context:{slot:100},value};
        }else if(c.method==='getTokenLargestAccounts')result={context:{slot:100},value:[]};
        else if(c.method==='getMultipleAccounts')result={context:{slot:100},value:c.params[0].map(()=>null)};
        else if(!['getProgramAccounts','getTokenAccountsByOwner'].includes(c.method))writes.push({rpc:c.method});
        else result=c.method==='getProgramAccounts'?[]:{context:{slot:100},value:[]};
        return{jsonrpc:'2.0',id:c.id,result};});
      return r.fulfill({json:Array.isArray(body)?responses:responses[0]});
    }
    if(!['GET','HEAD','OPTIONS'].includes(q.method()))writes.push({path:u.pathname,method:q.method()});
    return r.fulfill({status:503,json:{error:'Offline read fixture'}});
  });
  return{errors,writes,reads,set:s=>{state=s;release();},marketReads:()=>reads.filter(x=>x.path.endsWith('/market-activity')).length};
}

// Native focus observation uses browser frames, a strict 1s deadline and 100ms
// continuous visibility/stationary scroll. No test scroll or focus workaround.
function stableFocus(target){return new Promise(resolve=>{const start=performance.now();let stable=null,last=null,frame,done=false;const samples=[];const finish=pass=>{if(done)return;done=true;cancelAnimationFrame(frame);clearTimeout(timer);resolve({pass,elapsedMs:performance.now()-start,stableMs:stable===null?0:performance.now()-stable,samples});};const tick=()=>{const r=target.getBoundingClientRect(),s=getComputedStyle(target),m=parseFloat(s.outlineWidth)+Math.max(0,parseFloat(s.outlineOffset)),header=document.querySelector('.topbar'),nav=document.querySelector('.mobile-workspace-nav'),top=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0,bottom=nav?.getClientRects().length?Math.min(innerHeight,nav.getBoundingClientRect().top):innerHeight;const sample={at:performance.now()-start,y:scrollY,focused:document.activeElement===target,visible:document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2)===target&&target.matches(':focus-visible')&&r.top-m>=top&&r.bottom+m<=bottom&&r.left-m>=0&&r.right+m<=innerWidth,outline:s.outlineStyle,rect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},top,bottom};samples.push(sample);if(sample.at>1000)return finish(false);if(sample.focused&&sample.visible&&m>0&&s.outlineStyle!=='none'){if(stable===null||last!==scrollY)stable=performance.now();last=scrollY;if(performance.now()-stable>=100)return finish(true);}else stable=null;frame=requestAnimationFrame(tick);};const timer=setTimeout(()=>finish(false),1000);frame=requestAnimationFrame(tick);});}

for(const {width,height} of[{width:360,height:740},{width:360,height:844},{width:390,height:844},{width:1440,height:900}])test(`Token actual-font mobile controls preserve native selection at ${width}x${height}`,async({page},info)=>{
  test.setTimeout(60_000);const f=await fixture(page);await page.setViewportSize({width,height});await page.goto(`/token/${mint}`);await page.locator('body.workspace-ready.product-experience-ready').waitFor();
  await expect.poll(f.marketReads).toBe(1);await expect(page.locator('#coin-price-path')).toContainText('Reading trade observations');await expect(page.locator('#coin-pulse-trades')).toHaveText('Loading…');
  const font=await page.evaluate(async()=>{await document.fonts.ready;const styles=[...document.querySelectorAll('[data-coin-chart-period],[data-coin-chart-metric],[data-coin-chart-unit],[data-coin-pulse-period],.coin-chart-range-label')].map(e=>({family:getComputedStyle(e).fontFamily,weight:getComputedStyle(e).fontWeight}));const requests=[...new Set(styles.map(s=>(s.family.includes('DM Mono')?'500':s.weight)+' 14px '+s.family.split(',')[0]))],loaded=[];for(const request of requests){const faces=await document.fonts.load(request,'Market cap Price RANGE USD SOL 24h');loaded.push({request,faces:faces.map(x=>({family:x.family,weight:x.weight,status:x.status}))});}await document.fonts.ready;return{styles,loaded};});
  await info.attach('actual-font',{body:JSON.stringify(font),contentType:'application/json'});
  for(const item of font.loaded){expect(item.faces.length,'Actual computed font must load: '+item.request).toBeGreaterThan(0);const weight=Number(item.request.split(' ')[0]);expect(item.faces.some(x=>{const range=x.weight.split(/\s+/).map(Number);return x.status==='loaded'&&(range.length===1?range[0]===weight:range[0]<=weight&&range[1]>=weight);}),'Loaded face must support computed weight: '+item.request).toBe(true);}
  const geometry=await page.locator(controls).evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);const parent=e.parentElement.getBoundingClientRect(),text=document.createRange();text.selectNodeContents(e);const textRect=text.getBoundingClientRect();return{text:e.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,size:parseFloat(s.fontSize),content:r.width-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth)-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),textWidth:textRect.width,parent:{left:parent.left,right:parent.right,top:parent.top,bottom:parent.bottom},before:getComputedStyle(e,'::before').content,after:getComputedStyle(e,'::after').content};}));
  await info.attach('actual-font-and-targets',{body:JSON.stringify({font,geometry},null,2),contentType:'application/json'});
  // DM Mono's unchanged 700 Range label synthesizes from the existing 500 face.
  for(const b of geometry){expect(b.content).toBeGreaterThanOrEqual(b.textWidth);expect(b.left).toBeGreaterThanOrEqual(b.parent.left);expect(b.right).toBeLessThanOrEqual(b.parent.right);if(width<=600){expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);expect(b.size).toBeGreaterThanOrEqual(14);expect(['none','normal']).toContain(b.before);expect(['none','normal']).toContain(b.after);}}
  if(width<=600){for(let i=0;i<geometry.length;i++)for(let j=i+1;j<geometry.length;j++){const a=geometry[i],b=geometry[j];if(a.top<b.bottom&&b.top<a.bottom)expect(Math.max(b.left-a.right,a.left-b.right),'Neighboring target horizontal gap').toBeGreaterThanOrEqual(8);else if(a.left<b.right&&b.left<a.right)expect(Math.max(b.top-a.bottom,a.top-b.bottom),'Neighboring target vertical gap').toBeGreaterThanOrEqual(8);}
    const layout=await page.evaluate(()=>({heading:document.querySelector('.coin-pulse-head h2').getBoundingClientRect().bottom,periods:document.querySelector('.coin-pulse-periods').getBoundingClientRect().top}));expect(layout.periods).toBeGreaterThanOrEqual(layout.heading+8);
  }else{expect(geometry.slice(0,8).every(x=>x.height===29&&x.size===10)).toBe(true);expect(geometry.slice(8).every(x=>Math.abs(x.height-19)<.1&&x.size===8)).toBe(true);}
  const target=selector=>page.locator(selector),focusLog=[];
  const check=async el=>{const x=await el.evaluate(stableFocus);focusLog.push(x);expect(x.pass,JSON.stringify(x)).toBe(true);expect(x.elapsedMs).toBeLessThanOrEqual(1000);expect(x.stableMs).toBeGreaterThanOrEqual(100);};
  const activate=async selector=>{const el=target(selector);await el.focus();await page.keyboard.press('Enter');await expect(el).toHaveAttribute('aria-pressed','true');await check(el);};
  // One entry focus, then native sequential order in both directions. Every
  // changed control is reached by Tab, rather than individually scrolling it.
  const order=await page.locator(controls).evaluateAll(es=>es.map(e=>Object.entries(e.dataset).find(([k])=>['coinChartPeriod','coinChartMetric','coinChartUnit','coinPulsePeriod'].includes(k)).join(':')));
  await page.locator(controls).first().focus();const visited=[];
  for(let i=0;i<80;i++){const active=await page.evaluate(()=>{const e=document.activeElement;return e.matches('[data-coin-chart-period],[data-coin-chart-metric],[data-coin-chart-unit],[data-coin-pulse-period]')?Object.entries(e.dataset).find(([k])=>['coinChartPeriod','coinChartMetric','coinChartUnit','coinPulsePeriod'].includes(k)).join(':'):null;});if(active){visited.push(active);await check(page.locator(controls).nth(order.indexOf(active)));await page.keyboard.press('Enter');await expect(page.locator(controls).nth(order.indexOf(active))).toHaveAttribute('aria-pressed','true');await check(page.locator(controls).nth(order.indexOf(active)));if(active===order.at(-1))break;}await page.keyboard.press('Tab');}
  expect(visited).toEqual(order);const reverse=[order.at(-1)];for(let i=0;i<80&&reverse.length<order.length;i++){await page.keyboard.press('Shift+Tab');const active=await page.evaluate(()=>{const e=document.activeElement;return e.matches('[data-coin-chart-period],[data-coin-chart-metric],[data-coin-chart-unit],[data-coin-pulse-period]')?Object.entries(e.dataset).find(([k])=>['coinChartPeriod','coinChartMetric','coinChartUnit','coinPulsePeriod'].includes(k)).join(':'):null;});if(active){reverse.push(active);await check(page.locator(controls).nth(order.indexOf(active)));}}expect(reverse).toEqual([...order].reverse());
  f.set('populated');await expect(page.locator('#coin-pulse-trades')).toHaveText('2');const before=f.marketReads();
  await activate('[data-coin-chart-metric="price"]');await activate('[data-coin-chart-unit="sol"]');await activate('[data-coin-chart-period="5m"]');await expect(page.locator('#coin-price-path')).toContainText('No recent prices · 5m');await expect(page.locator('#coin-price-path')).not.toContainText('history may be missing');await expect(page.locator('#coin-chart-heading')).toContainText('Price in SOL');
  await activate('[data-coin-chart-period="24h"]');await expect(page.locator('#coin-price-path svg')).toHaveAttribute('aria-label',/price in SOL from 2 confirmed.*24h/);const chart=await page.locator('#coin-price-path').innerHTML();
  await activate('[data-coin-pulse-period="5m"]');await expect(page.locator('#coin-pulse-trades')).toHaveText('0');expect(await page.locator('#coin-price-path').innerHTML()).toBe(chart);await expect(page.locator('[data-coin-chart-period="24h"]')).toHaveAttribute('aria-pressed','true');
  await activate('[data-coin-pulse-period="24h"]');await expect(page.locator('#coin-pulse-trades')).toHaveText('2');expect(f.marketReads()).toBe(before);
  for(const [state,text]of[['one','One recent price'],['empty','No recent prices'],['partial','history may be missing'],['unavailable','Chart unavailable']]){f.set(state);await page.locator('#coin-refresh').click();await expect(page.locator('#coin-price-path')).toContainText(text);await expect(page.locator('#coin-refresh')).toBeFocused();if(state==='partial')await expect(page.locator('#coin-pulse-note')).toContainText('Some trade history is missing');if(state==='unavailable')await expect(page.locator('#coin-pulse-trades')).toHaveText('Unavailable');}
  await info.attach('native-focus',{body:JSON.stringify({order,visited,reverse,focusLog,reads:f.reads},null,2),contentType:'application/json'});expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`controls-${width}x${height}.png`),fullPage:true});
});

// FQA-067: native keyboard entry with passive preaction motion evidence.
// Original four cases, fixture, geometry and strict predicates remain verbatim.
function observeTokenControlFocus(selector) {
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


async function tokenMotionFixture(page,viewport){
 const f=await fixture(page);await page.setViewportSize(viewport);
 await page.addInitScript(()=>{
  const trace={frames:[],keys:[],focus:[]};window.__tokenNativeMotion=trace;
  const point=e=>({at:performance.now(),y:scrollY,id:e?.id||'',data:{...e?.dataset}});
  document.addEventListener('keydown',e=>trace.keys.push({...point(document.activeElement),key:e.key,shift:e.shiftKey,trusted:e.isTrusted,prior:trace.frames.slice(-5)}),true);
  document.addEventListener('focusin',e=>{const item={...point(e.target),trusted:e.isTrusted};trace.focus.push(item);requestAnimationFrame(()=>{item.nextFrame={...point(document.activeElement)};});},true);
  const frame=()=>{trace.frames.push(point(document.activeElement));if(trace.frames.length<3000)requestAnimationFrame(frame);};requestAnimationFrame(frame);
 });
 await page.goto('/token/'+mint);await page.locator('body.workspace-ready.product-experience-ready.page-route-coin').waitFor();
 const font=await page.evaluate(async()=>{await document.fonts.ready;const loaded=[];for(const e of document.querySelectorAll('[data-coin-chart-period],[data-coin-chart-metric],[data-coin-chart-unit],[data-coin-pulse-period]')){const s=getComputedStyle(e),request=s.fontWeight+' 14px '+s.fontFamily.split(',')[0];loaded.push({request,faces:(await document.fonts.load(request)).map(x=>({status:x.status,weight:x.weight}))});}await document.fonts.ready;return loaded;});
 for(const x of font)expect(x.faces.some(y=>y.status==='loaded'),'Actual computed control font '+x.request).toBe(true);
 await expect.poll(f.marketReads).toBe(1);await page.locator('[data-coin-pulse-period="24h"]').click();return{f,font};
}
async function tokenNativePredecessor(page){
 const visited=[];let predecessor;
 for(let i=0;i<80;i++){
  const state=await page.evaluate(()=>{const goal=document.querySelector('[data-coin-chart-unit="sol"]'),all=[...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(x=>x.tabIndex>=0&&!x.disabled&&x.getClientRects().length),next=all[all.indexOf(goal)+1],active=document.activeElement;return{atPredecessor:active===next,active:{tag:active.tagName,id:active.id,data:{...active.dataset}},predecessor:{tag:next?.tagName,id:next?.id,data:{...next?.dataset}}};});
  visited.push(state.active);if(state.atPredecessor){predecessor=state.predecessor;break;}await page.keyboard.press('Shift+Tab');
 }
 expect(predecessor,'Actual next DOM tabbable after SOL reached through native reverse traversal').toBeTruthy();return{visited,predecessor};
}
for(const viewport of[{width:360,height:740},{width:360,height:844},{width:390,height:844},{width:1440,height:900}])test('FQA-067 native reverse entry keeps original SOL outline visible at '+viewport.width+'x'+viewport.height,async({page},info)=>{
 test.setTimeout(60000);const{f,font}=await tokenMotionFixture(page,viewport),selector='[data-coin-chart-unit="sol"]',original=await page.locator(selector).elementHandle(),pressed=await original.getAttribute('aria-pressed'),before=f.marketReads(),pred=await page.locator('[data-coin-tab="trades"]').elementHandle(),path=await tokenNativePredecessor(page);
 let focus,nativePageDown;if(viewport.width===1440){nativePageDown=await nativePageDownEntry(page,selector,pred);focus=nativePageDown.focus;}else{const watching=page.evaluate(observeTokenControlFocus,selector);await page.keyboard.press('Shift+Tab');focus=await watching;}
 const passive=await page.evaluate(()=>window.__tokenNativeMotion),key=passive.keys.at(-1),preactionMotion=key.prior.some(x=>Math.abs(x.y-key.y)>=1);
 await info.attach('native-entry-proof',{body:JSON.stringify({viewport,font,path,key,preactionMotion,focus,passive,nativePageDown,qualification:'1440: deliberate native PageDown entry; prior R2 remains failed. Mobile: no prior-motion claim.'},null,2),contentType:'application/json'});
 expect(key.trusted).toBe(true);expect(key.shift).toBe(true);expect(key.key).toBe('Tab');if(viewport.width===1440)expect(preactionMotion,'Desktop entry must occur during observed preceding native scroll').toBe(true);if(nativePageDown){const keys=passive.keys.filter(x=>x.key==='PageDown');expect(keys).toHaveLength(1);expect(keys[0].trusted).toBe(true);expect(nativePageDown.armed.acknowledgedAt).toBeLessThan(keys[0].at);}
 expect(focus.pass,JSON.stringify(focus)).toBe(true);expect(await original.evaluate(x=>x.isConnected&&document.activeElement===x)).toBe(true);expect(await original.getAttribute('aria-pressed')).toBe(pressed);expect(f.marketReads()).toBe(before);
 await page.keyboard.press('Enter');await expect(page.locator(selector)).toHaveAttribute('aria-pressed','true');expect(await original.evaluate(x=>document.activeElement===x&&x.isConnected)).toBe(true);expect(f.marketReads()).toBe(before);
 f.set('populated');await expect(page.locator('#coin-pulse-trades')).toHaveText('2');expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);await page.screenshot({path:info.outputPath('native-sol-'+viewport.width+'x'+viewport.height+'.png')});
});

async function tokenVm(){
 const [{default:vm},fs,{createHash}]=await Promise.all([import('node:vm'),import('node:fs'),import('node:crypto')]);
 const text=fs.readFileSync(new URL('../../src/app/startup/coin-navigation.js',import.meta.url),'utf8'),begin='function bindTokenControlFocus(',end='// Startup runs in the order declared in start.js.';
 expect(text.split(begin)).toHaveLength(2);expect(text.split(end)).toHaveLength(2);const binding=text.slice(text.indexOf(begin),text.indexOf(end));
 expect(createHash('sha256').update(binding.replaceAll('\r\n','\n')).digest('hex')).toBe('de0e889f3eba0ab0a6ee7a06028bb94b87510c8f92ac52f3257268704f937649');
 const ev=new Map(),pe={},q=new Map(),scroll=[],show=[];let id=0;
 const emit=name=>[...(ev.get(name)||[])].forEach(fn=>fn());
 const node=(owned=true)=>({isConnected:true,hidden:false,inert:false,parentElement:null,matches:()=>owned,getClientRects:()=>[{}],closest(){return this.hidden||this.inert?this:null;},getBoundingClientRect(){return{left:10,right:70,top:this.clip?-50:20,bottom:this.clip?-20:50};},scrollIntoView(o){show.push({node:this,o});emit('scroll');}});
 const a=node(),b=node(),other=node(false),page={contains:x=>[a,b,other].includes(x),addEventListener:(n,fn)=>pe[n]=fn};
 const doc={activeElement:a,documentElement:{},body:{},querySelector:()=>page,querySelectorAll:()=>[]};
 const ctx={document:doc,location:{href:'https://fixture.test/token/mint'},innerWidth:1440,innerHeight:900,scrollX:0,scrollY:700,appState:{coinRouteRequested:()=>true},getComputedStyle:()=>({outlineWidth:'2px',outlineOffset:'2px'}),requestAnimationFrame:fn=>{const k=++id;q.set(k,()=>{q.delete(k);fn();});return k;},cancelAnimationFrame:key=>q.delete(key)};
 ctx.window={addEventListener:(n,fn)=>{if(!ev.has(n))ev.set(n,new Set());ev.get(n).add(fn);},removeEventListener:(n,fn)=>ev.get(n)?.delete(fn),scrollTo:o=>scroll.push(o),get scrollX(){return ctx.scrollX;},get scrollY(){return ctx.scrollY;}};
 vm.runInNewContext(binding+';bindTokenControlFocus(appState);',ctx,{timeout:1000});
 return{a,b,other,doc,ctx,q,scroll,show,pe,ev,emit,focus:target=>{doc.activeElement=target;pe.focusin({target});},run:()=>{const work=[...q.values()];q.clear();work.forEach(fn=>fn());}};
}
const pending=f=>[...f.q.values()][0],late=f=>[...(f.ev.get('scroll')||[])][0];
function idle(f,c=[0,0]){expect([f.scroll.length,f.show.length]).toEqual(c);expect(f.q.size).toBe(0);for(const n of['keydown','pointerdown','wheel','touchstart','scroll'])expect(f.ev.get(n)?.size||0).toBe(0);}
test('FQA-067 isolated current owner cancels at current position and reveals only clipping',async()=>{
 for(const clip of[false,true]){const f=await tokenVm();f.a.clip=clip;f.focus(f.a);expect(f.q.size).toBe(1);f.ctx.scrollY=321;f.run();expect(f.scroll).toEqual([{top:321,left:0,behavior:'instant'}]);expect(f.show.length).toBe(clip?1:0);expect(f.doc.activeElement).toBe(f.a);expect(f.q.size).toBe(0);}
});
test('FQA-067 isolated superseded focus rejects stale delivered callback',async()=>{
 for(const ran of[false,true]){const f=await tokenVm();f.focus(f.a);if(ran)f.run();const old=ran?late(f):pending(f),c=[f.scroll.length,0];f.focus(f.b);old();expect([f.scroll.length,f.show.length]).toEqual(c);expect(f.q.size).toBe(1);f.run();expect(f.scroll.length).toBe(c[0]+1);expect(f.doc.activeElement).toBe(f.b);f.pe.focusout();old();idle(f,[c[0]+1,0]);}
});
test('FQA-067 isolated ordinary focusleave rejects stale delivered callback',async()=>{
 for(const ran of[false,true]){const f=await tokenVm();f.focus(f.a);if(ran)f.run();const old=ran?late(f):pending(f);f.doc.activeElement=f.other;f.pe.focusout();old();idle(f,[ran?1:0,0]);expect(f.doc.activeElement).toBe(f.other);}
});
const invalid=async change=>{for(const ran of[false,true]){const f=await tokenVm();f.focus(f.a);if(ran)f.run();const old=ran?late(f):pending(f);change(f);old();idle(f,[ran?1:0,0]);}};
test('FQA-067 isolated route change without event invalidates pending owner',()=>invalid(f=>f.ctx.location.href+='#docs'));
for(const state of['hidden','inert','detached'])test('FQA-067 isolated '+state+' control rejects pending owner',()=>invalid(f=>{if(state==='detached')f.a.isConnected=false;else f.a[state]=true;}));
test('FQA-067 isolated route event cancels even a stale delivered frame',async()=>{for(const n of['hashchange','popstate','pagehide'])await invalid(f=>f.emit(n));});
test('FQA-067 isolated next input cancels before and after RAF',async()=>{
 for(const n of['keydown','pointerdown','wheel','touchstart'])for(const ran of[false,true]){const f=await tokenVm();f.emit(n);f.focus(f.a);expect(f.q.size).toBe(1);if(ran)f.run();const old=ran?late(f):pending(f);f.emit(n);old();idle(f,[ran?1:0,0]);expect(f.doc.activeElement).toBe(f.a);}
});
test('FQA-067 isolated late clip corrects once without recursion',async()=>{
 const f=await tokenVm();f.focus(f.a);f.run();const old=late(f);f.emit('scroll');expect(f.show).toHaveLength(0);f.a.clip=true;f.emit('scroll');expect(f.show[0]).toEqual({node:f.a,o:{block:'center',inline:'nearest',behavior:'instant'}});old();f.emit('scroll');idle(f,[1,1]);expect(f.doc.activeElement).toBe(f.a);
});

async function nativeTokenKeyBatch(page,following=[]){
 const client=await page.context().newCDPSession(page),key=(type,modifiers)=>({type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers});
 // Trusted browser Input events, queued in protocol order without a renderer
 // script, synthetic DOM event, clock change, forced focus or scroll call.
 try{await Promise.all([client.send('Input.dispatchKeyEvent',key('rawKeyDown',8)),client.send('Input.dispatchKeyEvent',key('keyUp',8)),...following.map(([method,params])=>client.send(method,params))]);}finally{await client.detach();}
}
for(const viewport of[{width:390,height:844},{width:1440,height:900}])test('FQA-067 native rapid owned focus switches SOL to USD at '+viewport.width,async({page},info)=>{
 test.setTimeout(60000);const{f}=await tokenMotionFixture(page,viewport);await tokenNativePredecessor(page);const selector='[data-coin-chart-unit="usd"]',following=['rawKeyDown','keyUp'].map(type=>['Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers:8}]);
 const watching=page.evaluate(observeTokenControlFocus,selector);await nativeTokenKeyBatch(page,following);const focus=await watching,passive=await page.evaluate(()=>window.__tokenNativeMotion),sol=passive.focus.find(x=>x.data.coinChartUnit==='sol'),foreign=passive.focus.find(x=>x.at>sol?.at&&x.data.coinChartUnit==='usd');
 await info.attach('native-rapid-owner',{body:JSON.stringify({viewport,focus,passive,sol,foreign,qualification:'Native trusted Input, actualbootstrap; isolated VM cases separately prove stale callbacks. No actualpage RAF/scroll spy or DOM/clock/focus/scroll workaround.'},null,2),contentType:'application/json'});
 expect(sol?.trusted).toBe(true);expect(foreign?.trusted).toBe(true);expect(foreign.at).toBeLessThan(sol.nextFrame.at);expect(focus.pass,JSON.stringify(focus)).toBe(true);await expect(page.locator(selector)).toBeFocused();f.set('populated');await expect(page.locator('#coin-pulse-trades')).toHaveText('2');expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});
function observeTokenRouteLeave(){return new Promise(resolve=>{const start=performance.now(),samples=[];let stable=null,last=null,frame;const finish=pass=>{cancelAnimationFrame(frame);clearTimeout(timer);resolve({pass,samples});};const tick=()=>{const at=performance.now()-start,clear=document.body.classList.contains('page-route-docs')&&!document.activeElement?.closest('#coin-page'),position=JSON.stringify([scrollX,scrollY,document.activeElement?.id]);if(clear){if(stable===null||last!==position)stable=performance.now();}else stable=null;last=position;samples.push({at,clear,y:scrollY,active:document.activeElement?.id,stationaryMs:stable===null?0:performance.now()-stable});if(at>1000)return finish(false);if(clear&&performance.now()-stable>=100)return finish(true);frame=requestAnimationFrame(tick);};const timer=setTimeout(()=>finish(false),1000);frame=requestAnimationFrame(tick);});}
test('FQA-067 native routeleave keeps hidden token owner inactive',async({page},info)=>{
 test.setTimeout(60000);const{f}=await tokenMotionFixture(page,{width:1440,height:900});await page.locator('.sidebar .nav-more summary').click();await page.locator('[data-coin-pulse-period="24h"]').click();await tokenNativePredecessor(page);const docs=page.locator('.sidebar a.nav-item[href="#docs"]');await expect(docs).toBeVisible();
 const original=await page.locator('[data-coin-chart-unit="sol"]').elementHandle(),watching=page.evaluate(observeTokenRouteLeave);await page.keyboard.press('Shift+Tab');await docs.click();const result=await watching,passive=await page.evaluate(()=>window.__tokenNativeMotion);
 await info.attach('native-route-owner',{body:JSON.stringify({result,passive,qualification:'Ordinary native actionability-checked Docs click after native SOL entry; no route API/synthetic event/direct DOM mutation. This proves real routeleave; pending-frame cancellation is separately isolated, not inferred from native timing. Earlier closedmenu and unproven rawpointer attempts remain failed.'},null,2),contentType:'application/json'});expect(result.pass,JSON.stringify(result)).toBe(true);await expect(page.locator('#coin-page')).toBeHidden();expect(await original.evaluate(x=>document.activeElement!==x)).toBe(true);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);f.set('populated');
});

function observeForeignTokenOwnership(selector){return new Promise(resolve=>{
 const target=document.querySelector(selector),start=performance.now(),samples=[];let first=null,seen=false,frame;
 const finish=pass=>{cancelAnimationFrame(frame);clearTimeout(timer);resolve({pass,samples,qualification:'Connected original foreign focus only, NOforeignvisibility/position/stationary-scroll/callabsence claim.'});};
 const tick=()=>{const now=performance.now(),clear=target?.isConnected&&document.activeElement===target,r=target?.getBoundingClientRect();samples.push({at:now-start,clear,y:scrollY,position:r&&{top:r.top,bottom:r.bottom,left:r.left,right:r.right},selected:target?.getAttribute('aria-selected')});if(now-start>1000)return finish(false);if(seen&&!clear)return finish(false);if(clear){seen=true;first??=now;if(now-first>=100)return finish(true);}frame=requestAnimationFrame(tick);};
 const timer=setTimeout(()=>finish(false),1000);frame=requestAnimationFrame(tick);
});}
test('FQA-067 native ordinary focusleave keeps original foreign owner at 1440',async({page},info)=>{
 test.setTimeout(60000);const{f}=await tokenMotionFixture(page,{width:1440,height:900});await tokenNativePredecessor(page);const selector='[data-coin-tab="trades"]',original=await page.locator(selector).elementHandle(),selected=await original.getAttribute('aria-selected'),solPressed=await page.locator('[data-coin-chart-unit="sol"]').getAttribute('aria-pressed'),before=f.marketReads(),following=['rawKeyDown','keyUp'].map(type=>['Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers:0}]);
 const watching=page.evaluate(observeForeignTokenOwnership,selector),diagnostic=page.evaluate(observeTokenControlFocus,selector);await nativeTokenKeyBatch(page,following);const ownership=await watching,foreignOutlineDiagnostic=await diagnostic,passive=await page.evaluate(()=>window.__tokenNativeMotion),sol=passive.focus.find(x=>x.data.coinChartUnit==='sol'),foreign=passive.focus.find(x=>x.at>sol?.at&&x.data.coinTab==='trades');
 await info.attach('native-foreign-ownership',{body:JSON.stringify({ownership,foreignOutlineDiagnostic,passive,sol,foreign,beforeFirstFrame:foreign?.at<sol?.nextFrame?.at,qualification:'QA-approved ordinary native ownership-only contract, with NO pending-frame claim; exact isolatedVM separately proves pending cancellation. Raw foreignoutline samples retained diagnostically; no foreign visibilityPASS/correction/cause claim. Earlier complete03 foreign1440FAIL retained.'},null,2),contentType:'application/json'});
 expect(sol?.trusted).toBe(true);expect(foreign?.trusted).toBe(true);expect(ownership.pass,JSON.stringify(ownership)).toBe(true);expect(await original.evaluate(x=>x.isConnected&&document.activeElement===x)).toBe(true);expect(await original.getAttribute('aria-selected')).toBe(selected);await expect(page.locator('[data-coin-chart-unit="sol"]')).toHaveAttribute('aria-pressed',solPressed);expect(passive.focus.filter(x=>x.at>foreign.at&&x.data.coinChartUnit)).toEqual([]);expect(f.marketReads()).toBe(before);f.set('populated');await expect(page.locator('#coin-pulse-trades')).toHaveText('2');expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

async function nativePageDownEntry(page,selector,pred){
 const armed=await page.evaluate(({selector,observerSource})=>{
  const observer=new Function('return ('+observerSource+')')(),pred=document.querySelector('[data-coin-tab="trades"]'),state=window.__nativeEntry={measurementStart:performance.now()};
  state.focusPromise=observer(selector).then(focus=>({measurementStart:state.measurementStart,observerArmedAt:state.observerArmedAt,endedAt:performance.now(),focus}));state.observerArmedAt=performance.now();
  let frame=0,timer,resolveMotion;state.motionPromise=new Promise(resolve=>{resolveMotion=resolve;});
  const finish=result=>{cancelAnimationFrame(frame);clearTimeout(timer);document.removeEventListener('keydown',key,true);state.motion=result;resolveMotion(result);};
  const key=e=>{if(e.key!=='PageDown')return;document.removeEventListener('keydown',key,true);clearTimeout(timer);const began=performance.now(),initialY=scrollY,events=[],sameOwnerOnKey=pred.isConnected&&document.activeElement===pred;const tick=()=>{const sample={at:performance.now(),y:scrollY};events.push(sample);if(sample.at-began>200)return finish({available:false,began,initialY,events,reason:'NO_MOTION_200MS'});if(Math.abs(sample.y-initialY)>=1)return finish({available:true,began,initialY,first:sample,events,trusted:e.isTrusted,sameOwnerOnKey});frame=requestAnimationFrame(tick);};timer=setTimeout(()=>finish({available:false,began,initialY,events,reason:'NO_MOTION_200MS'}),200);frame=requestAnimationFrame(tick);};
  document.addEventListener('keydown',key,true);state.listenerArmedAt=performance.now();timer=setTimeout(()=>finish({available:false,armedAt:state.listenerArmedAt,reason:'NO_KEY_200MS'}),200);
  return{measurementStart:state.measurementStart,observerArmedAt:state.observerArmedAt,listenerArmedAt:state.listenerArmedAt,acknowledgedAt:performance.now(),same:pred.isConnected&&document.activeElement===pred,pred:{id:pred.id,data:{...pred.dataset}}};
 },{selector,observerSource:observeTokenControlFocus.toString()});expect(armed.same,'Original Trades ARMED before PageDown').toBe(true);
 await page.keyboard.press('PageDown');const motion=await page.evaluate(()=>window.__nativeEntry.motionPromise),beforeShift=await pred.evaluate(x=>({same:x.isConnected&&document.activeElement===x,at:performance.now(),y:scrollY}));
 expect(motion.available,JSON.stringify({armed,motion,beforeShift})).toBe(true);expect(motion.trusted).toBe(true);expect(motion.sameOwnerOnKey).toBe(true);expect(motion.first.at-motion.began).toBeLessThanOrEqual(200);expect(beforeShift.same).toBe(true);
 await page.keyboard.press('Shift+Tab');const observation=await page.evaluate(()=>window.__nativeEntry.focusPromise);expect(observation.endedAt-observation.measurementStart).toBeLessThanOrEqual(1000);return{...observation,armed,motion,beforeShift};
}
