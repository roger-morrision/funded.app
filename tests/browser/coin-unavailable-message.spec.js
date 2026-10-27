import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

for(const width of [360,390,1440]) test(`token error recovery and fee records remain usable at ${width}px`,async({page})=>{
  const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z',signature='3'.repeat(64);
  const variants=[
    ['502 : <!DOCTYPE html><footer>Fixture gateway 192.0.2.1<script>fixture()</script></footer>','We could not load verified token details. Try Refresh in a moment.'],
    ['503 : Fixture upstream diagnostic from https://rpc.example.invalid/private','We could not load verified token details. Try Refresh in a moment.'],
    ['429 Too Many Requests','Solana is rate limited. Wait a moment, then select Refresh.'],
    ['Mint RPC request timed out','Solana timed out. Check your connection and select Refresh.'],
  ];
  await page.setViewportSize({width,height:900});
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline token error fixture'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route(`**/api/tokens/${mint}/fee-activity`,route=>route.fulfill({json:{mint,cluster:'devnet',overview:{available:true,scope:'per-mint-v3'},collections:[{signature,collectedLamports:'25887'}],claims:[{claimSignature:signature,asset:'SOL',grossCreatorFees:'0.000025887',status:'finalized'}]}}));
  await page.route('https://**/*',route=>route.abort());
  for(const [i,[body,expected]] of variants.entries()) {
    let release;
    const held=new Promise(resolve=>release=resolve);
    await page.route('**/api/solana/rpc',async route=>{await held;await route.fulfill({status:503,contentType:'text/plain',body});});
    await page.goto(`/token/${mint}`);
    await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    const holders=page.getByRole('tab',{name:/^Holders/});
    await holders.click();
    await expect(holders).toBeFocused();
    release();
    await expect(page.locator('#coin-description')).toHaveText(expected);
    await expect(page.locator('#coin-activity-list')).toContainText(expected);
    await expect(holders).toBeFocused();
    await expect(holders).toHaveAttribute('aria-selected','true');
    await expect(page.getByRole('button',{name:'Refresh token data'})).toBeEnabled();
    const errorText=await page.locator('#coin-description').innerText();
    expect(errorText.length).toBeLessThan(120);
    expect(errorText).not.toMatch(/DOCTYPE|footer|script|192\.0\.2\.1|rpc\.example|diagnostic/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    if(i===0)await page.screenshot({path:test.info().outputPath(`bounded-error-${width}-mocked.png`),fullPage:true});
    await page.getByRole('tab',{name:/^Fee collections/}).click();
    await expect(page.locator('#coin-activity-list')).toContainText('0.000025887 SOL');
    await page.getByRole('tab',{name:/^Allocations/}).click();
    await expect(page.locator('#coin-activity-list')).toContainText('0.000025887 SOL');
    await expect(page.locator('#coin-activity-list')).toContainText('These amounts may not have been paid yet.');
    await page.unroute('**/api/solana/rpc');
  }
});

// FQA-063 / UX-046: actual bootstrap with deterministic read-only local transport fixtures.
const fallbackMint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z';
const fallbackDescription='Coin details confirmed on Solana.';
function fallbackGate(id){let resolve;const gate={id,promise:new Promise(r=>resolve=r)};gate.release=()=>{gate.record&&(gate.record.releasedAt??=Date.now());resolve();};return gate;}
async function serveTokenFallbackRead(f,route,kind,next,value){
  const sequence=kind==='market'?++f.marketCount:++f.metadataCount,record={id:next?.gate.id||kind+'-unheld-'+sequence,kind,sequence,url:route.request().url(),method:route.request().method(),startedAt:Date.now()};
  f.reads.push(record);if(next?.gate){next.gate.request=route.request();next.gate.record=record;await next.gate.promise;}
  const response=next?next.response:value,payload=response||{error:kind==='market'?'Fixture market unavailable':'No custom metadata fixture'};
  record.status=response?200:404;record.payload=payload;
  await route.fulfill({status:record.status,json:payload});record.fulfilledAt=Date.now();
}
async function tokenFallbackFixture(page,width,{curve=false,pool=false,metadata=false}={}){
  const [{PublicKey},{PUMP_SDK,bondingCurvePda},{PUMP_AMM_SDK,canonicalPumpPoolPda,GLOBAL_CONFIG_PDA},{default:BN}]=await Promise.all([import('@solana/web3.js'),import('@pump-fun/pump-sdk'),import('@pump-fun/pump-swap-sdk'),import('bn.js')]);
  const mint=new PublicKey(fallbackMint),native=new PublicKey('So11111111111111111111111111111111111111112'),tokenProgram='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',key=n=>new PublicKey(new Uint8Array(32).fill(n));
  const account=(data,owner=tokenProgram)=>({data:[data.toString('base64'),'base64'],owner,lamports:1000000,executable:false,rentEpoch:0});
  const mintBytes=Buffer.alloc(82);mintBytes.writeBigUInt64LE(1000000000000000n,36);mintBytes[44]=6;mintBytes[45]=1;
  const accounts=new Map([[fallbackMint,account(mintBytes)],[native.toBase58(),account(mintBytes)]]),curveKey=bondingCurvePda(mint).toBase58();
  if(curve||pool)accounts.set(curveKey,account(await PUMP_SDK.offlinePumpProgram.coder.accounts.encode('bondingCurve',{virtualTokenReserves:new BN('1000000000000'),virtualQuoteReserves:new BN('30000000000'),realTokenReserves:new BN('700000000000'),realQuoteReserves:new BN('1000000000'),tokenTotalSupply:new BN('1000000000000000'),complete:pool,creator:key(7),isMayhemMode:false,isCashbackCoin:false,quoteMint:native,creatorFeeBps:new BN(0),canEditCreatorFee:false,isHolderReward:false}),PUMP_SDK.offlinePumpProgram.programId.toBase58()));
  if(pool){
    const coder=PUMP_AMM_SDK.offlineProgram.coder.accounts,poolKey=canonicalPumpPoolPda(mint,native),baseVault=key(8),quoteVault=key(9);
    const fieldDefault=type=>typeof type==='object'&&type.array?Array.from({length:type.array[1]},()=>fieldDefault(type.array[0])):type==='pubkey'?key(7):type==='bool'?false:['u8','u16','u32'].includes(type)?0:new BN(0);
    const values=name=>Object.fromEntries(PUMP_AMM_SDK.offlineProgram.idl.types.find(t=>t.name===name).type.fields.map(f=>[f.name,fieldDefault(f.type)]));
    accounts.set(GLOBAL_CONFIG_PDA.toBase58(),account(await coder.encode('globalConfig',values('globalConfig')),PUMP_AMM_SDK.offlineProgram.programId.toBase58()));
    accounts.set(poolKey.toBase58(),account(await coder.encode('pool',{...values('pool'),baseMint:mint,quoteMint:native,poolBaseTokenAccount:baseVault,poolQuoteTokenAccount:quoteVault}),PUMP_AMM_SDK.offlineProgram.programId.toBase58()));
    for(const[v,m,amount]of[[baseVault,mint,1000000000000n],[quoteVault,native,30000000000n]]){const data=Buffer.alloc(165);m.toBuffer().copy(data,0);poolKey.toBuffer().copy(data,32);data.writeBigUInt64LE(amount,64);data[108]=1;accounts.set(v.toBase58(),account(data));}
  }
  const metadataProgram=new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'),[metadataPda]=PublicKey.findProgramAddressSync([Buffer.from('metadata'),metadataProgram.toBuffer(),mint.toBuffer()],metadataProgram);
  if(metadata){const string=s=>{const b=Buffer.from(s),n=Buffer.alloc(4);n.writeUInt32LE(b.length);return Buffer.concat([n,b]);};accounts.set(metadataPda.toBase58(),account(Buffer.concat([Buffer.alloc(65),string('Fixture metadata token'),string('META')]),metadataProgram.toBase58()));}
  const f={reads:[],forbidden:[],errors:[],gates:[],market:undefined,metadata:undefined,marketReplies:[],metadataReplies:[],marketCount:0,metadataCount:0};
  f.holdMarket=response=>{const gate=fallbackGate('market-held-'+(f.gates.length+1));f.gates.push(gate);f.marketReplies.push({gate,response});return gate;};
  f.holdMetadata=response=>{const gate=fallbackGate('metadata-held-'+(f.gates.length+1));f.gates.push(gate);f.metadataReplies.push({gate,response});return gate;};
  await page.setViewportSize({width,height:width<700?844:900});
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  page.on('pageerror',e=>f.errors.push(e.message));
  const safeRpc=new Set(['getAccountInfo','getMultipleAccounts','getSlot','getGenesisHash','getProgramAccounts','getTokenLargestAccounts','getTokenAccountsByOwner','getBalance']);
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method(),local=url.origin===new URL(test.info().project.use.baseURL).origin;
    if(!local){if(method==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))return route.continue();f.forbidden.push({method,url:url.origin+url.pathname});return route.abort();}
    if(url.pathname==='/api/solana/rpc'){
      let body;try{body=request.postDataJSON();}catch{}const calls=Array.isArray(body)?body:[body];
      if(method!=='POST'||!calls.length||!calls.every(c=>c&&safeRpc.has(c.method))){f.forbidden.push({method,path:url.pathname,calls});return route.fulfill({status:403,json:{error:'Unknown or mutating RPC blocked'}});}
      f.reads.push({path:url.pathname,calls,at:Date.now()});
      const responses=calls.map(c=>{let result;if(c.method==='getAccountInfo'){
        let value=accounts.get(c.params[0])||null;if(c.params[0]===fallbackMint&&c.params[1]?.encoding==='jsonParsed')value={...value,data:{program:'spl-token',space:82,parsed:{type:'mint',info:{decimals:6,supply:'1000000000000000',isInitialized:true,mintAuthority:null,freezeAuthority:null}}}};
        result={context:{slot:100},value};
      }else if(c.method==='getMultipleAccounts')result={context:{slot:100},value:c.params[0].map(k=>accounts.get(k)||null)};
      else if(c.method==='getSlot')result=100;else if(c.method==='getGenesisHash')result='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';else if(c.method==='getProgramAccounts')result=[];else if(c.method==='getTokenLargestAccounts'||c.method==='getTokenAccountsByOwner')result={context:{slot:100},value:[]};else result={context:{slot:100},value:0};return{jsonrpc:'2.0',id:c.id,result};});
      return route.fulfill({json:Array.isArray(body)?responses:responses[0]});
    }
    if(!['GET','HEAD','OPTIONS'].includes(method)){f.forbidden.push({method,path:url.pathname});return route.fulfill({status:403,json:{error:'No writes admitted'}});}
    if(url.pathname===`/devnet-metadata/${fallbackMint}`)return serveTokenFallbackRead(f,route,'metadata',f.metadataReplies.shift(),f.metadata);
    if(!url.pathname.startsWith('/api/'))return route.continue();
    f.reads.push({path:url.pathname,method,at:Date.now()});
    if(url.pathname===`/api/tokens/${fallbackMint}/market-activity`)return serveTokenFallbackRead(f,route,'market',f.marketReplies.shift(),f.market);
    if(url.pathname==='/api/fee-policy')return route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}});
    if(url.pathname==='/api/x/me')return route.fulfill({json:{authenticated:false,configured:true}});
    if(url.pathname==='/api/market/sol-usd')return route.fulfill({json:{priceUsd:100}});
    if(url.pathname==='/api/launches')return route.fulfill({json:[]});
    if(url.pathname==='/api/pump/explore')return route.fulfill({json:{cluster:'devnet',items:[]}});
    if(url.pathname==='/api/airdrops/reserves')return route.fulfill({json:{cluster:'devnet',reserves:[]}});
    return route.fulfill({status:503,json:{error:'Controlled unavailable read; no provider forwarded'}});
  });
  f.open=async()=>{await page.goto('/token/'+fallbackMint,{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveClass(/workspace-ready/);await expect(page.locator('#coin-page-title')).not.toHaveText('Loading token…');const fonts=await page.evaluate(async()=>{await document.fonts.load('600 14px Manrope');await document.fonts.ready;return [...document.fonts].filter(f=>f.family.includes('Manrope')&&f.status==='loaded').map(f=>({family:f.family,weight:f.weight}));});expect(fonts.length).toBeGreaterThan(0);await test.info().attach('actual-fonts',{body:JSON.stringify(fonts),contentType:'application/json'});};
  f.finish=async()=>{const continuity=await page.evaluate(()=>window.__tokenFallbackContinuity?.watching?window.__tokenFallbackContinuity.finish():null);f.gates.forEach(g=>g.release());await test.info().attach('token-fallback-read-lineage',{body:JSON.stringify({reads:f.reads,marketCount:f.marketCount,metadataCount:f.metadataCount,forbidden:f.forbidden,errors:f.errors,unfinishedBoundary:continuity,qualification:'Finally gate release is cleanup only and does not prove request body or callback completion.'},null,2),contentType:'application/json'});expect(f.forbidden).toEqual([]);expect(f.errors).toEqual([]);};return f;
}
function fallbackMarket(populated=false,pool=false){return{cluster:'devnet',coverage:'complete',volume24hSol:populated?3:0,buyVolume24hSol:populated?1:0,sellVolume24hSol:populated?2:0,tradeCount24h:populated?2:0,buyCount24h:populated?1:0,sellCount24h:populated?1:0,poolTradeCount24h:pool?(populated?2:0):undefined,poolHistoryCoverage:pool?'complete':undefined,solUsdPrice:100,recentTrades:populated?[{signature:'3'.repeat(64),trader:fallbackMint,side:'buy',blockTime:Math.floor(Date.now()/1000)-120,solLamports:'1000000000',tokenAmountRaw:'1000000',priceRatio:0.02},{signature:'4'.repeat(64),trader:fallbackMint,side:'sell',blockTime:Math.floor(Date.now()/1000)-60,solLamports:'2000000000',tokenAmountRaw:'1000000',priceRatio:0.03}]:[]};}

function observeTokenFallbackFocus(original, readiness = {}) {
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
      const observation=window.__tokenFallbackFocus;
      const matches=(selector,text)=>text==null||document.querySelector(selector)?.textContent.includes(text);
      const ready=(!readiness.startedId||observation.startedId===readiness.startedId)
        && (!readiness.transportId||observation.transport?.id===readiness.transportId&&observation.transport.bodyComplete)
        && (!readiness.description||document.querySelector('#coin-description')?.textContent===readiness.description)
        && matches('#coin-price-path',readiness.chartText)&&matches('#coin-activity-list',readiness.activityText)
        && (readiness.tradeTabText==null||document.querySelector('[data-coin-tab="trades"]')?.textContent.trim()===readiness.tradeTabText)
        && (readiness.metadataStatus==null||document.querySelector('#coin-metadata-status')?.textContent.trim()===readiness.metadataStatus)
        && (!readiness.chartSvg||Boolean(document.querySelector('#coin-price-path svg')))
        && (readiness.tradeRows==null||document.querySelectorAll('#coin-activity-list .coin-transaction-row').length===readiness.tradeRows)
        && (readiness.buyRows==null||document.querySelectorAll('#coin-activity-list .coin-transaction-row.is-buy').length===readiness.buyRows)
        && (readiness.sellRows==null||document.querySelectorAll('#coin-activity-list .coin-transaction-row.is-sell').length===readiness.sellRows)
        && !window.__tokenFallbackContinuity?.removed&&!window.__tokenFallbackContinuity?.obsoleteSeen;
      const clear = Boolean(ready && element.isConnected && rect && cornersClear && element === document.activeElement && element.matches(':focus-visible')
        && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
        && rect.left - edge >= bounds.left && rect.right + edge <= bounds.right
        && rect.top - edge >= bounds.top && rect.bottom + edge <= bounds.bottom);
      const now = performance.now(), geometry = JSON.stringify([position, scrollX, scrollY, bounds]);
      if (clear) { if (stationaryAt === null || previous !== geometry) stationaryAt = now; }
      else stationaryAt = null;
      previous = geometry;
      samples.push({ at:now - began, clear, ready, startedId:observation.startedId, transport:observation.transport, position, edge, bounds, clips, root, cornersClear,
        stationaryMs:stationaryAt === null ? 0 : now - stationaryAt });
      if (now - began > 1000) return finish(false);
      if (clear && now - stationaryAt >= 100) return finish(true);
      frame = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => finish(false), 1000);
    frame = requestAnimationFrame(tick);
  });
}


async function beginTokenFallbackContinuity(original){await original.evaluate(element=>{
  if(window.__tokenFallbackContinuity?.watching)return;
  const state=window.__tokenFallbackContinuity={watching:true,began:performance.now(),events:[],removed:false,obsoleteSeen:false,descriptions:[]};
  const sample=text=>{if(text){state.descriptions.push({at:performance.now(),text});if(text.includes('Obsolete response must be ignored.')||text.includes('Wrong token description.'))state.obsoleteSeen=true;}};
  const observer=new MutationObserver(records=>{for(const record of records){for(const node of record.removedNodes)if(node===element||node.contains?.(element))state.removed=true;if(record.target===document.querySelector('#coin-description')||record.target.parentElement===document.querySelector('#coin-description')){sample(record.oldValue);for(const node of [...record.addedNodes,...record.removedNodes])sample(node.textContent);sample(document.querySelector('#coin-description')?.textContent);}}});observer.observe(document.body,{childList:true,subtree:true,characterData:true,characterDataOldValue:true});
  const changed=e=>state.events.push({at:performance.now(),original:e.target===element,id:e.target.id});document.addEventListener('focusin',changed,true);state.finish=()=>{observer.disconnect();document.removeEventListener('focusin',changed,true);state.watching=false;return{began:state.began,ended:performance.now(),events:state.events,removed:state.removed,obsoleteSeen:state.obsoleteSeen,descriptions:state.descriptions,connected:element.isConnected,active:document.activeElement===element};};
});}
async function armTokenFallback(original,readiness={}){await original.evaluate((element,{source,readiness})=>{
  const state=window.__tokenFallbackFocus={original:element,began:performance.now(),events:[],removed:false,readiness};
  const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===element||node.contains?.(element))state.removed=true;});observer.observe(document.body,{childList:true,subtree:true});
  const changed=e=>state.events.push({original:e.target===element,id:e.target.id});document.addEventListener('focusin',changed,true);
  const key=e=>state.key={key:e.key,trusted:e.isTrusted};document.addEventListener('keydown',key,{capture:true,once:true});
  state.promise=(new Function('return ('+source+')')())(element,readiness).then(proof=>{observer.disconnect();document.removeEventListener('focusin',changed,true);document.removeEventListener('keydown',key,true);return{proof,readiness,transport:state.transport,events:state.events,key:state.key,removed:state.removed,connected:element.isConnected,active:document.activeElement===element,began:state.began,ended:performance.now()};});
},{source:observeTokenFallbackFocus.toString(),readiness});}
async function tokenFallbackProof(page,label,nativeKey){const result=await page.evaluate(()=>window.__tokenFallbackFocus.promise);await test.info().attach(label,{body:JSON.stringify(result,null,2),contentType:'application/json'});expect(result.proof.pass,JSON.stringify(result)).toBe(true);expect(result.ended-result.began).toBeLessThanOrEqual(1000);expect(result.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);expect(result.active&&result.connected&&!result.removed).toBe(true);expect(result.events.every(e=>e.original)).toBe(true);if(nativeKey)expect(result.key).toEqual({key:nativeKey===true?'Tab':nativeKey,trusted:true});return result;}
async function startTokenFallbackReload(page,original,gate,readiness){
  await beginTokenFallbackContinuity(original);await armTokenFallback(original,{...readiness,startedId:gate.id});await page.keyboard.press('Enter');await expect.poll(()=>Boolean(gate.request),{timeout:15000}).toBe(true);
  await original.evaluate((element,id)=>{window.__tokenFallbackFocus.startedId=id;},gate.id);await tokenFallbackProof(page,'native-reload-to-held-read-'+gate.id,'Enter');
}
async function nativeTokenFallback(page){const original=await page.locator('#coin-refresh').elementHandle();expect(original).not.toBeNull();await page.locator('#coin-page-title').click();let next=false;for(let n=0;n<120;n++){next=await original.evaluate(e=>{const nodes=[...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')].filter(n=>n.tabIndex>=0&&!n.disabled&&!n.closest('[hidden],[inert]')&&n.getClientRects().length&&getComputedStyle(n).visibility==='visible');return nodes[nodes.indexOf(document.activeElement)+1]===e;});if(next)break;await page.keyboard.press('Tab');}expect(next).toBe(true);await armTokenFallback(original);await page.keyboard.press('Tab');await tokenFallbackProof(page,'native-refresh-entry',true);return original;}
async function fallbackSurface(page,expected){await expect(page.locator('#coin-description')).toHaveText(expected);await expect(page.locator('#coin-description')).not.toContainText('Checking recent trades');expect(await page.locator('#coin-description').evaluate(e=>e.tagName==='P'&&e.tabIndex===-1&&!e.hasAttribute('role')&&!e.hasAttribute('aria-live'))).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
async function finishFallbackRead(page,original,gate,expected,settled={}){
  expect(gate.request).toBeTruthy();expect(gate.record.id).toBe(gate.id);await beginTokenFallbackContinuity(original);
  await armTokenFallback(original,{...settled,description:expected,transportId:gate.id});
  const responsePromise=page.waitForResponse(r=>r.request()===gate.request,{timeout:15000});gate.release();
  const response=await responsePromise;expect(response.request()).toBe(gate.request);let timer;const body=await Promise.race([(async()=>{expect(await response.finished()).toBeNull();return response.body();})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Exact held response body did not finish within15000ms')),15000);})]).finally(()=>clearTimeout(timer));expect(response.status()).toBe(gate.record.status);expect(JSON.parse(body.toString())).toEqual(gate.record.payload);
  gate.record.bodyCompleteAt=Date.now();gate.record.bodyBytes=body.length;gate.record.bodyComplete=true;
  await original.evaluate((element,transport)=>{window.__tokenFallbackFocus.transport=transport;},{id:gate.id,sequence:gate.record.sequence,status:response.status(),bodyComplete:true,bodyBytes:body.length});
  await tokenFallbackProof(page,'held-read-settled-'+gate.id);await fallbackSurface(page,expected);
  const continuity=await original.evaluate(()=>window.__tokenFallbackContinuity.finish());await test.info().attach('read-continuity-'+gate.id,{body:JSON.stringify({request:gate.record,continuity,qualification:'Exact request/body completion plus observed settled DOM and >=100ms current-owner/whole-outline window. No application callback instrumentation; unchanged no-op/stale rejection callback completion is not directly proven.'},null,2),contentType:'application/json'});expect(continuity.active&&continuity.connected&&!continuity.removed&&!continuity.obsoleteSeen).toBe(true);expect(continuity.events.every(e=>e.original)).toBe(true);
}

test.describe('FQA-063 neutral token fallback lifecycle',()=>{
  test.describe.configure({timeout:60000});
  test.afterEach(async({page})=>{await page.close();});
  for(const width of[360,390,1440]){
    test(`parsed mint without curve settles unavailable without a pending About claim at${width}`,async({page})=>{
      const f=await tokenFallbackFixture(page,width);try{await f.open();await fallbackSurface(page,fallbackDescription);await expect(page.locator('#coin-stage')).toHaveText('Unverified');await expect(page.locator('#coin-fee-owner')).toHaveText('Unavailable');await expect(page.locator('#coin-metadata-status')).toHaveText('No verified name');await expect(page.locator('[data-coin-tab="trades"]')).toHaveText('Trades —');await expect(page.locator('#coin-pulse-trades')).toHaveText('Unavailable');await expect(page.locator('#coin-price-path')).toHaveText('Chart unavailableRecent trade prices could not be loaded. Try refreshing the token page.');await expect(page.locator('#coin-activity-list')).toContainText('Recent trades unavailable');expect(f.marketCount).toBe(0);expect(f.reads.some(r=>r.calls?.some(c=>c.method==='getAccountInfo'&&c.params[0]===fallbackMint&&c.params[1]?.encoding==='jsonParsed'))).toBe(true);await nativeTokenFallback(page);await page.screenshot({path:test.info().outputPath('no-curve-neutral-'+width+'.png')});expect(f.marketCount).toBe(0);}finally{await f.finish();}
    });
    test(`curve loading then unavailable empty and populated trades keep neutral About at${width}`,async({page})=>{
      const f=await tokenFallbackFixture(page,width,{curve:true});try{let original;
        for(const[state,response]of[['unavailable',null],['empty',fallbackMarket()],['populated',fallbackMarket(true)]]){
          const gate=f.holdMarket(response),target=f.marketCount+1;if(state==='unavailable')await f.open();else await startTokenFallbackReload(page,original,gate,{description:fallbackDescription,chartText:'Loading chart…',activityText:'Reading confirmed Pump trades…'});await expect.poll(()=>f.marketCount).toBe(target);await fallbackSurface(page,fallbackDescription);await expect(page.locator('#coin-stage')).toHaveText('On Pump curve');await expect(page.locator('#coin-price-path')).toContainText('Loading chart…');await expect(page.locator('#coin-activity-list')).toContainText('Reading confirmed Pump trades…');if(!original)original=await nativeTokenFallback(page);const settled=state==='unavailable'?{chartText:'Chart unavailable',activityText:'Recent trades unavailable',tradeTabText:'Trades —'}:state==='empty'?{chartText:'No recent prices',activityText:'No confirmed trades in the last 24 hours.',tradeTabText:'Trades 0'}:{chartSvg:true,tradeRows:2,tradeTabText:'Trades 2',buyRows:1,sellRows:1};await finishFallbackRead(page,original,gate,fallbackDescription,settled);
          if(state==='unavailable'){await expect(page.locator('#coin-price-path')).toContainText('Chart unavailable');await expect(page.locator('#coin-activity-list')).toContainText('Recent trades unavailable');}
          else if(state==='empty'){await expect(page.locator('#coin-price-path')).toContainText('No recent prices');await expect(page.locator('#coin-activity-list')).toContainText('No confirmed trades in the last 24 hours.');await expect(page.locator('[data-coin-tab="trades"]')).toHaveText('Trades 0');}
          else{await expect(page.locator('#coin-price-path svg')).toBeVisible();await expect(page.locator('#coin-activity-list .coin-transaction-row')).toHaveCount(2);await expect(page.locator('[data-coin-tab="trades"]')).toHaveText('Trades 2');await expect(page.locator('#coin-activity-list .coin-transaction-row.is-buy')).toHaveCount(1);await expect(page.locator('#coin-activity-list .coin-transaction-row.is-sell')).toHaveCount(1);}
        }await page.screenshot({path:test.info().outputPath('curve-populated-neutral-'+width+'.png')});
      }finally{await f.finish();}
    });
    test(`graduated pool neutral fallback yields to existing settled pool copy at${width}`,async({page})=>{
      const f=await tokenFallbackFixture(page,width,{pool:true});try{const gate=f.holdMarket(fallbackMarket(false,true));await f.open();await expect.poll(()=>f.marketCount).toBe(1);await fallbackSurface(page,'Trading pool confirmed.');await expect(page.locator('#coin-stage')).toHaveText('Migrated · PumpSwap');await expect(page.locator('#coin-price-path')).toContainText('Loading chart…');const original=await nativeTokenFallback(page);await finishFallbackRead(page,original,gate,'Trading pool confirmed. No trades in the last 24 hours.',{chartText:'No recent prices',activityText:'No confirmed trades in the last 24 hours.',tradeTabText:'Trades 0'});await expect(page.locator('#coin-price-path')).toContainText('No recent prices');await expect(page.locator('#coin-activity-list')).toContainText('No confirmed trades in the last 24 hours.');await expect(page.locator('[data-coin-tab="trades"]')).toHaveText('Trades 0');await page.screenshot({path:test.info().outputPath('pool-settled-'+width+'.png')});}finally{await f.finish();}
    });
    test(`metadata descriptions and stale-load guard preserve current token ownership at${width}`,async({page})=>{
      const f=await tokenFallbackFixture(page,width,{metadata:true});const details=description=>({name:'Fixture metadata token',symbol:'META',description}),pending={description:fallbackDescription,chartText:'Chart unavailable',activityText:'Recent trades unavailable',metadataStatus:'On-chain name / symbol'},matched={chartText:'Chart unavailable',activityText:'Recent trades unavailable',metadataStatus:'Name and symbol confirmed'},unmatched={chartText:'Chart unavailable',activityText:'Recent trades unavailable',metadataStatus:'On-chain name / symbol'};try{
        let gate=f.holdMetadata(details('Fixture project description.'));await f.open();await expect.poll(()=>f.metadataCount).toBe(1);await fallbackSurface(page,fallbackDescription);const original=await nativeTokenFallback(page);await finishFallbackRead(page,original,gate,'Fixture project description.',matched);
        gate=f.holdMetadata(details(''));await startTokenFallbackReload(page,original,gate,pending);await expect.poll(()=>f.metadataCount).toBe(2);await finishFallbackRead(page,original,gate,'Signed Solana metadata is available.',matched);
        gate=f.holdMetadata(null);await startTokenFallbackReload(page,original,gate,pending);await expect.poll(()=>f.metadataCount).toBe(3);await finishFallbackRead(page,original,gate,fallbackDescription,unmatched);
        gate=f.holdMetadata({...details('Wrong token description.'),name:'Mismatched metadata'});await startTokenFallbackReload(page,original,gate,pending);await expect.poll(()=>f.metadataCount).toBe(4);await finishFallbackRead(page,original,gate,fallbackDescription,unmatched);
        const stale=f.holdMetadata(details('Obsolete response must be ignored.'));await startTokenFallbackReload(page,original,stale,pending);await expect.poll(()=>f.metadataCount).toBe(5);await fallbackSurface(page,fallbackDescription);
        const current=f.holdMetadata(details('Current response owns this description.'));await startTokenFallbackReload(page,original,current,pending);await expect.poll(()=>f.metadataCount).toBe(6);await finishFallbackRead(page,original,current,'Current response owns this description.',matched);
        await finishFallbackRead(page,original,stale,'Current response owns this description.',matched);expect(stale.record.sequence).toBe(5);expect(current.record.sequence).toBe(6);expect(stale.request).not.toBe(current.request);expect(f.marketCount).toBe(0);await page.screenshot({path:test.info().outputPath('metadata-current-'+width+'.png')});
      }finally{await f.finish();}
    });
  }
});
