import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const wallet='7'.repeat(32), other='6'.repeat(32), mint='8'.repeat(32), signature='9'.repeat(88);
const wallets=[{wallet,burnedTokens:12,receiptCount:1,latestSignature:signature},{wallet:other,burnedTokens:4,receiptCount:1,latestSignature:signature}];
const policy={revision:3,split:{operationsPercent:40,referralLevelPercents:[10,3,2],communityPercent:20,buybackPercent:25}};

for(const width of [360,390,1440]) test(`FQA-032 native leaderboard link focus reveals only necessary horizontal distance at ${width}px`,async({page},info)=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>{const p=new URL(r.request().url()).pathname;return r.fulfill(p==='/api/fee-policy'?{json:policy}:p==='/api/leaderboard/burners'?{json:{cluster:'devnet',wallets}}:{status:503,json:{error:'Unavailable fixture'}});});
  await page.route('https://**/*',r=>r.abort());await page.goto('/#leaderboard');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.evaluate(()=>document.fonts.ready);
  const table=page.locator('#leaderboard-table');await expect(table.locator('.leaderboard-row')).toHaveCount(2);
  // Capture native focus before the table's bubbling listener. No focus/scroll override.
  await page.evaluate(()=>{
    window.focusObservations=[];
    document.addEventListener('focusin',e=>{
      const t=document.querySelector('#leaderboard-table'),a=e.target;
      if(!t.contains(a)||!a.matches('a[href]'))return;
      const rect=a.getBoundingClientRect(),box=t.getBoundingClientRect(),style=getComputedStyle(a),pad=parseFloat(style.outlineWidth)+Math.max(0,parseFloat(style.outlineOffset));
      const left=box.left+t.clientLeft,right=left+t.clientWidth;
      const delta=t.scrollWidth<=t.clientWidth?0:rect.left-pad<left?rect.left-pad-left:rect.right+pad>right?rect.right+pad-right:0;
      const ancestors=[];for(let n=t;n;n=n.parentElement)ancestors.push([n,n.scrollTop]);
      const nav=document.querySelector('.mobile-workspace-nav'),header=document.querySelector('.topbar');
      const clearTop=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0,clearBottom=nav?.getClientRects().length?nav.getBoundingClientRect().top:innerHeight;
      const record={node:a,text:a.textContent,href:a.getAttribute('href'),before:t.scrollLeft,delta,ancestors,verticalWasClear:rect.top-pad>=clearTop&&rect.bottom+pad<=clearBottom};window.focusObservations.push(record);
    },true);
  });
  const observations=[];
  async function checkFocus(label){
    await expect.poll(()=>table.locator('a:focus-visible').count()).toBe(1);
    const result=await table.evaluate(async t=>{
      await new Promise(requestAnimationFrame);const a=document.activeElement,r=a.getBoundingClientRect(),b=t.getBoundingClientRect(),s=getComputedStyle(a),pad=parseFloat(s.outlineWidth)+Math.max(0,parseFloat(s.outlineOffset)),o=window.focusObservations.at(-1);
      const nav=document.querySelector('.mobile-workspace-nav'),header=document.querySelector('.topbar'),top=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0,bottom=nav?.getClientRects().length?nav.getBoundingClientRect().top:innerHeight;
      return {text:a.textContent,href:a.getAttribute('href'),sameNode:o.node===a,sameName:o.text===a.textContent,sameHref:o.href===a.getAttribute('href'),left:r.left-pad,right:r.right+pad,boundLeft:b.left+t.clientLeft,boundRight:b.left+t.clientLeft+t.clientWidth,before:o.before,after:t.scrollLeft,expected:Math.max(0,Math.min(t.scrollWidth-t.clientWidth,o.before+o.delta)),verticalWasClear:o.verticalWasClear,verticalClear:r.top-pad>=top-1&&r.bottom+pad<=bottom+1,verticalUnchanged:o.ancestors.every(([n,top])=>n.scrollTop===top),cellTabstops:t.querySelectorAll('[role="cell"][tabindex]').length};
    });
    expect(result.sameNode&&result.sameName&&result.sameHref,label).toBe(true);expect(result.left,label).toBeGreaterThanOrEqual(result.boundLeft-1);expect(result.right,label).toBeLessThanOrEqual(result.boundRight+1);expect(result.after,label).toBeCloseTo(result.expected,0);expect(result.verticalClear,label).toBe(true);if(result.verticalWasClear)expect(result.verticalUnchanged,label).toBe(true);expect(result.cellTabstops).toBe(0);observations.push({label,...result});
  }
  await page.locator('[data-leaderboard-view="burners"]').focus();await page.keyboard.press('Tab');await expect(page.locator('#leaderboard-panel a.text-button')).toBeFocused();await page.keyboard.press('Tab');await expect(table).toBeFocused();
  if(width<700){for(let i=0;i<8;i++)await page.keyboard.press('ArrowRight',{delay:60});await page.keyboard.press('ArrowLeft',{delay:100});expect(await table.evaluate(t=>t.scrollLeft)).toBeGreaterThan(0);}
  await page.keyboard.press('Tab');await expect(table.locator('a').first()).toBeFocused();await checkFocus('Actual app mocked Burners: native right/left then Tab');

  // Canonical renderer in the already initialized app: deterministic populated
  // four-view fixtures, including Traders unavailable naturally on live Devnet.
  const files={'board-view.js':new URL('../../src/features/leaderboard/board-view.js',import.meta.url),'display.js':new URL('../../src/features/shared/display.js',import.meta.url),'market-intelligence.js':new URL('../../market-intelligence.js',import.meta.url)};
  await page.route('**/__qa-focus/**',r=>{const name=new URL(r.request().url()).pathname.split('/').pop();return files[name]?r.fulfill({contentType:'text/javascript',body:readFileSync(process.env.FUNDED_LEADERBOARD_MODULE_DIR?resolve(process.env.FUNDED_LEADERBOARD_MODULE_DIR,name):files[name],'utf8').replace('../shared/display.js','/__qa-focus/display.js')}):r.abort();});
  for(const view of ['burners','burn-board','creators','traders']){
    await page.evaluate(async({view,wallet,other,mint,signature,wallets})=>{
      const board=await import('/__qa-focus/board-view.js'),model=await import('/__qa-focus/market-intelligence.js');
      const assets=[{address:mint,name:'Fixture one',symbol:'ONE',curveCapSol:100,createdTimestamp:1767225600,recentTrades:[{trader:wallet,signature,blockTime:1790000000,side:'buy',solLamports:'1234500000'},{trader:other,signature:'5'.repeat(88),blockTime:1790000001,side:'sell',solLamports:'100000000'}]},{address:other,name:'Fixture two',symbol:'TWO',curveCapSol:20,createdTimestamp:1767225601}];
      const state={leaderboardView:view,burnersBoardState:{status:'ready',wallets},burnBoardState:{status:'ready',projects:wallets.map((w,i)=>({...w,mint:i?other:mint,name:'Fixture project',symbol:'QA',burnerCount:1}))},verifiedLaunchPoliciesStatus:'ready',exploreFeedAvailable:true,EXPLORE_CLUSTER:'devnet',coinSolUsdPrice:25,assets,verifiedLaunchPolicies:assets.map(a=>({mint:a.address,cluster:'devnet',onchainVerified:true,creatorWallet:wallet}))};
      const deps={formatOnchainAge:()=> 'fixture age',exploreExplorer:p=>`https://explorer.solana.com/${p}?cluster=devnet`,launchBurnersFallback:()=>[],launchBurnBoardFallback:()=>[],rankObservedTraders:(a,p)=>model.rankObservedTraders(a,p,{nowSeconds:1790000002}),loadWalletBurnBoard:()=>{}};
      deps.renderWalletBurnersBoard=()=>board.renderWalletBurnersBoard(state,deps);deps.renderProjectBurnBoard=()=>board.renderProjectBurnBoard(state,deps);board.renderLeaderboard(state,deps);
    },{view,wallet,other,mint,signature,wallets});
    await expect(table.getByRole('columnheader')).toHaveCount(5);await expect(table.locator('.leaderboard-row')).toHaveCount(2);for(const row of await table.locator('.leaderboard-row').all())await expect(row.getByRole('cell')).toHaveCount(5);
    await table.focus();await table.evaluate(t=>{t.scrollLeft=t.scrollWidth;});await page.keyboard.press('Tab');await expect(table.locator('a').first()).toBeFocused();await checkFocus(`${view}: first forward Tab from right`);
    // No-op for a visible link and native reverse navigation to that same link.
    await page.keyboard.press('Tab');await checkFocus(`${view}: next forward Tab`);await page.keyboard.press('Shift+Tab');await checkFocus(`${view}: first reverse ShiftTab`);
    // Native reverse entry to the final existing link, initially scrolled left.
    await table.evaluate(t=>{let after=document.querySelector('#qa-after-table');if(!after){after=document.createElement('button');after.id='qa-after-table';after.textContent='Fixture after table';t.after(after);}after.focus({preventScroll:true});t.scrollLeft=0;});
    await page.keyboard.press('Shift+Tab');await expect(table.locator('a').last()).toBeFocused();await checkFocus(`${view}: last reverse ShiftTab from left`);
    await table.focus();await table.evaluate(t=>{t.scrollLeft=0;});await page.keyboard.press('ArrowRight',{delay:120});if(width<700)expect(await table.evaluate(t=>t.scrollLeft)).toBeGreaterThan(0);else expect(await table.evaluate(t=>t.scrollLeft)).toBe(0);
    if(view==='traders'&&width<700){
      await table.evaluate(t=>{t.scrollLeft=0;});await table.scrollIntoViewIfNeeded();
      const box=await table.boundingBox(),session=await page.context().newCDPSession(page),y=box.y+20,start=box.x+box.width-30,end=box.x+30;
      await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});
      for(let i=1;i<=6;i++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start+(end-start)*i/6,y}]});await page.waitForTimeout(25);}
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(()=>table.evaluate(t=>t.scrollLeft)).toBeGreaterThan(50);await session.detach();
    }
  }
  // Native tablist keys remain independent of link reveal.
  const tabs=page.locator('[data-leaderboard-view]');await tabs.first().focus();await page.keyboard.press('End');await expect(tabs.last()).toBeFocused();await page.keyboard.press('Home');await expect(tabs.first()).toBeFocused();await page.keyboard.press('ArrowRight');await expect(page.locator('[data-leaderboard-view="burn-board"]')).toBeFocused();await page.keyboard.press('ArrowLeft');await expect(tabs.first()).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);expect(errors).toEqual([]);
  await info.attach('native-focus-geometry',{body:JSON.stringify({width,label:'Mocked HTTP Burners and canonical four-view renderer fixtures; no live financial or chain proof',observations},null,2),contentType:'application/json'});
});
