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
