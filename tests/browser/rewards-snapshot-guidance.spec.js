import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

for(const width of [360,390,1440])test(`per-coin snapshot guidance and native Airdrops navigation at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:width<700?844:900});
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline rewards guidance fixture'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('https://**/*',route=>route.abort());
  await page.goto('/#payments');
  await page.locator('body.workspace-ready.product-experience-ready').waitFor();
  const summary=page.getByText('How to qualify for upcoming rewards',{exact:true});
  const details=summary.locator('..');
  await expect(details).not.toHaveAttribute('open','');
  await summary.focus();await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open','');await expect(summary).toBeFocused();
  const link=page.getByRole('link',{name:'See snapshots and claim deadlines →',exact:true});
  const article=link.locator('..');
  await expect(article.getByRole('heading')).toHaveText('Check each coin’s snapshot and deadline');
  await expect(article).toContainText('verified snapshot and published claim deadline');
  await expect(article).toContainText('Devnet QA cutoffs are separate');
  await expect(article).not.toContainText(/90 days|at migration/);
  await expect(link).toHaveAttribute('href','#airdrops');
  await expect(page.locator('.reward-upcoming-grid article').first()).toContainText('An hourly payout needs finalized holdings');
  await expect(page.locator('.reward-upcoming-note')).toHaveText('Creator, X, and referral SOL depend on collected fees. X rewards require a claim; referral payouts are creator signed and appear after confirmation.');
  await link.focus();await expect(link).toBeFocused();
  await expect.poll(()=>link.evaluate(element=>{
    const r=element.getBoundingClientRect(),style=getComputedStyle(element),m=(parseFloat(style.outlineWidth)||0)+Math.max(0,parseFloat(style.outlineOffset)||0);
    const header=document.querySelector('.topbar'),nav=document.querySelector('.mobile-workspace-nav');
    const top=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0,bottom=nav?.getClientRects().length?Math.min(innerHeight,nav.getBoundingClientRect().top):innerHeight;
    return r.top-m>=top-1&&r.bottom+m<=bottom+1;
  })).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`rewards-guidance-${width}-mocked.png`)});
  await page.keyboard.press('Enter');await expect(page).toHaveURL(/#airdrops$/);await expect(page.locator('#airdrops')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>!!document.activeElement?.getClientRects().length&&!document.activeElement?.closest('[hidden]'))).toBe(true);
});

for(const width of [360,390,1440])for(const partition of [0,1])test(`holder cutoff boundary and schedule states part ${partition+1}/2 with native guidance at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:width<700?844:900});
  const now='2026-10-22T12:00:00.000Z',mint='So11111111111111111111111111111111111111112';
  await page.clock.setFixedTime(new Date(now));
  let current;const requests=[],errors=[],focus=[];
  const rpcReads=new Set(['getAccountInfo','getMultipleAccounts','getBalance','getSlot','getGenesisHash','getLatestBlockhash','getBlockHeight','getMinimumBalanceForRentExemption','getFeeForMessage','getRecentPrioritizationFees','getTokenSupply','getTokenAccountBalance','getTokenLargestAccounts','getTokenAccountsByOwner','getSignaturesForAddress','getSignatureStatuses','getTransaction','getBlockTime','getProgramAccounts']);
  const observe=selector=>new Promise(resolve=>{
    const start=performance.now(),samples=[];let stable=null,last=null,frame,done=false;
    const finish=pass=>{if(done)return;done=true;cancelAnimationFrame(frame);clearTimeout(timer);resolve({pass,elapsedMs:performance.now()-start,stableMs:stable===null?0:performance.now()-stable,samples});};
    const tick=()=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e),m=s?(parseFloat(s.outlineWidth)||0)+Math.max(0,parseFloat(s.outlineOffset)||0):0,h=document.querySelector('.topbar'),n=document.querySelector('.mobile-workspace-nav'),top=h?.getClientRects().length?Math.max(0,h.getBoundingClientRect().bottom):0,bottom=n?.getClientRects().length?Math.min(innerHeight,n.getBoundingClientRect().top):innerHeight;
      const x={at:performance.now()-start,y:scrollY,focused:e===document.activeElement,clear:Boolean(r&&m>0&&e.matches(':focus-visible')&&s.outlineStyle!=='none'&&r.top-m>=top&&r.bottom+m<=bottom&&r.left-m>=0&&r.right+m<=innerWidth),rect:r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null};samples.push(x);if(x.at>1000)return finish(false);const position=JSON.stringify([x.y,x.rect]);if(x.focused&&x.clear){if(stable===null||last!==position)stable=performance.now();last=position;if(performance.now()-stable>=100)return finish(true);}else stable=null;frame=requestAnimationFrame(tick);};
    const timer=setTimeout(()=>finish(false),1000);frame=requestAnimationFrame(tick);
  });
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    let rpcMethods=[];if(path==='/api/solana/rpc'){const data=request.postDataJSON();rpcMethods=(Array.isArray(data)?data:[data]).map(x=>x?.method);}
    requests.push({path,method:request.method(),rpcMethods});
    if(path==='/api/fee-policy')return route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}});
    if(path==='/api/launches')return route.fulfill({json:[{mint,symbol:'CUTQA',name:'Cutoff QA',onchainVerified:true,cluster:'devnet'}]});
    if(path==='/api/rewards/automatic')return route.fulfill({json:{serverTime:now,status:current.service||'active',reason:'Controlled schedule source note',schedules:current.service==='unavailable'?[]:[{kind:'holder',asset:'SOL',mint,status:current.status,cutoffAt:current.cutoff,payoutAt:current.payout,periodStart:1}]}});
    return route.fulfill({status:503,json:{error:'Controlled unavailable supporting service'}});
  });
  const states=[
    {name:'future',status:'scheduled',cutoff:'2026-10-22T12:05:00Z',payout:'2026-10-22T12:06:00Z',label:'Reward period closes in',countdown:'00:05:00'},
    {name:'reached',status:'scheduled',label:'Calculating allocations · next payout',countdown:'00:01:00'},
    {name:'indexing',status:'indexing',label:'Cutoff reached · finalizing holder history',countdown:'00:01:00'},
    {name:'prepared',status:'prepared',label:'Distribution prepared · payout in',countdown:'00:01:00'},
    {name:'paid',status:'paid',label:'Paid'},
    {name:'blocked',status:'blocked',label:'Distribution blocked',service:'degraded'},
    {name:'delayed',status:'delayed',label:'Delayed',service:'degraded'},
    {name:'deferred',status:'deferred',label:'Reward funding carries forward'},
    {name:'late-confirmation',status:'scheduled',payout:'2026-10-22T11:59:30Z',label:'Delayed · awaiting payment confirmation'},
    {name:'unavailable',status:'unavailable',service:'unavailable',label:'Not scheduled'},
  ];
  const observations=[];let guideIdentity=null;
  for(const state of states.slice(partition*5,partition*5+5)){
    current={cutoff:'2026-10-22T11:59:00Z',payout:'2026-10-22T12:01:00Z',...state};
    if(observations.length)await page.reload();else await page.goto('/#payments');
    await page.locator('body.workspace-ready.product-experience-ready').waitFor();
    const tab=page.locator('#rewards-holder-tab');await tab.click();await expect(tab).toBeFocused();
    const panel=page.locator('#rewards-holder [data-automatic-rewards]'),dates=panel.locator('[data-clock-dates]'),clock=panel.locator('[data-clock]'),coin=panel.locator('[data-clock-coin]');
    await expect(panel.locator('[data-clock-label]')).toHaveText(current.label);
    await expect(panel.locator('.auto-rewards-fineprint')).toHaveText('Target time is not payment. Each cycle checks funding and eligibility.');
    await expect(panel.locator('[data-auto-status]')).toHaveText('Controlled schedule source note');
    await expect(panel.locator('[data-auto-status]')).toHaveJSProperty('hidden',(current.service||'active')==='active');
    await expect(panel.locator('.preview-chip')).toHaveText(current.service==='unavailable'?'Schedule unavailable':current.service==='degraded'?'Schedule needs attention':'Schedule active');
    if(current.service==='unavailable'){
      await expect(dates).toBeHidden();await expect(clock).toBeHidden();await expect(coin).toBeHidden();
    }else{
      // Existing degraded-service CSS hides the card, while retaining its schedule data.
      if(current.service==='degraded'){await expect(dates).toBeHidden();await expect(coin).toBeHidden();await expect(panel.locator('.auto-rewards-fineprint')).toBeHidden();}
      else await expect(dates).toBeVisible();
      await expect(dates.locator('span').first()).toHaveText(`Holdings cutoff Oct 22, ${current.cutoff.slice(11,16)} UTC`);
      await expect(dates.locator('span').last()).toHaveText(`Target payout Oct 22, ${current.payout.slice(11,16)} UTC`);
      await expect(coin).toHaveText('CUTQA · view coin →');await expect(coin).toHaveAttribute('href',`/token/${mint}`);
      if(current.countdown){await expect(clock).toBeVisible();await expect(clock).toHaveText(current.countdown);}else await expect(clock).toBeHidden();
      expect(await dates.locator('a,button,input,select,[tabindex],[aria-live],[role="status"]').count()).toBe(0);
      if(state.name==='future'){
        // Observe before the native tabpanel→existing guide→coin traversal.
        const watching=page.evaluate(observe,'#rewards-holder [data-clock-coin]');
        await page.keyboard.press('Tab');await expect(page.locator('#rewards-holder')).toBeFocused();
        await page.keyboard.press('Tab');await expect(page.locator('#rewards-holder summary')).toBeFocused();
        await page.keyboard.press('Tab');await expect(coin).toBeFocused();
        const f=await watching;focus.push(f);expect(f.pass,JSON.stringify(f.samples.at(-1))).toBe(true);expect(f.elapsedMs).toBeLessThanOrEqual(1000);expect(f.stableMs).toBeGreaterThanOrEqual(100);
        await page.screenshot({path:testInfo.outputPath(`cutoff-future-${width}-mocked.png`)});
      }
    }
    await expect(panel).not.toContainText('Holdings checked at');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    observations.push({state:state.name,label:await panel.locator('[data-clock-label]').innerText(),datesHidden:await dates.getAttribute('hidden'),cutoff:current.cutoff,payout:current.payout,countdown:current.countdown||null});
  }
  if(partition===1){
  await page.locator('#rewards-overview-tab').click();
  const summary=page.getByText('How to qualify for upcoming rewards',{exact:true});
  // Native pointer entry followed by native keyboard disclosure and its next link.
  await summary.click();await expect(summary.locator('..')).toHaveAttribute('open','');
  await page.keyboard.press('Space');await expect(summary.locator('..')).not.toHaveAttribute('open','');
  await page.keyboard.press('Enter');await expect(summary.locator('..')).toHaveAttribute('open','');
  const guide=page.getByRole('link',{name:'See snapshots and claim deadlines →',exact:true});
  await expect(guide).toBeVisible();
  guideIdentity=await guide.evaluate(e=>({sameTarget:e===document.querySelector('.reward-upcoming-grid a[href="#airdrops"]'),matchingTargets:document.querySelectorAll('.reward-upcoming-grid a[href="#airdrops"]').length,tag:e.tagName,text:e.textContent,href:e.getAttribute('href')}));
  expect(guideIdentity.sameTarget).toBe(true);expect(guideIdentity.matchingTargets).toBe(1);
  const guideWatching=page.evaluate(observe,'.reward-upcoming-grid a[href="#airdrops"]');
  for(let i=0;i<4&&!await guide.evaluate(e=>e===document.activeElement);i++)await page.keyboard.press('Tab');
  const guideFocus=await guideWatching;focus.push(guideFocus);expect(guideFocus.pass,JSON.stringify(guideFocus.samples.at(-1))).toBe(true);expect(guideFocus.elapsedMs).toBeLessThanOrEqual(1000);expect(guideFocus.stableMs).toBeGreaterThanOrEqual(100);
  await expect(guide).toBeFocused();await expect(guide).toHaveAttribute('href','#airdrops');
  await page.keyboard.press('Enter');await expect(page).toHaveURL(/#airdrops$/);await expect(page.locator('#airdrops')).toBeVisible();
  }
  await testInfo.attach('cutoff-schedule-evidence',{body:JSON.stringify({width,partition:partition+1,qualification:'Controlled API payloads and fixed Date, real application bootstrap/renderer and native interactions; mocked read RPC503, no payment/chain proof. Degraded hidden DOM is underlying data only.',observations,focus,guideIdentity,requests,errors}),contentType:'application/json'});
  expect(errors).toEqual([]);expect(requests.filter(x=>x.path.startsWith('/api/wallets/')||(x.method!=='GET'&&!(x.method==='POST'&&x.path==='/api/solana/rpc'&&x.rpcMethods.length&&x.rpcMethods.every(m=>rpcReads.has(m)))))).toEqual([]);
});
