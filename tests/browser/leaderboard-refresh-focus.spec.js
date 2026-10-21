import{test,expect}from'@playwright/test';import{readFileSync}from'node:fs';import{resolve}from'node:path';
const wallet='7'.repeat(32),other='6'.repeat(32),mint='8'.repeat(32),signature='9'.repeat(88);
const policy={revision:3,split:{operationsPercent:40,referralLevelPercents:[10,3,2],communityPercent:20,buybackPercent:25}};
for(const width of[360,390,1440])test(`FQA-034 real leaderboard renderer preserves logical focus through async refresh at ${width}px`,async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',r=>r.fulfill(new URL(r.request().url()).pathname==='/api/fee-policy'?{json:policy}:{status:503,json:{error:'Unavailable fixture'}}));await page.route('https://**/*',r=>r.abort());
 await page.goto('/#leaderboard');await page.locator('body.workspace-ready.product-experience-ready').waitFor();const table=page.locator('#leaderboard-table');
 const files={'board-view.js':new URL('../../src/features/leaderboard/board-view.js',import.meta.url),'display.js':new URL('../../src/features/shared/display.js',import.meta.url),'market-intelligence.js':new URL('../../market-intelligence.js',import.meta.url)};
 await page.route('**/__qa-refresh/**',r=>{const n=new URL(r.request().url()).pathname.split('/').pop();return files[n]?r.fulfill({contentType:'text/javascript',body:readFileSync(process.env.FUNDED_LEADERBOARD_MODULE_DIR?resolve(process.env.FUNDED_LEADERBOARD_MODULE_DIR,n):files[n],'utf8').replace('../shared/display.js','/__qa-refresh/display.js')}):r.abort()});
 await page.evaluate(async({wallet,other,mint,signature})=>{
  const board=await import('/__qa-refresh/board-view.js'),model=await import('/__qa-refresh/market-intelligence.js');
  window.renderRefreshFixture=(view,mode='populated')=>{
   const empty=['empty','loading','unavailable'].includes(mode),reverse=mode==='reordered',changed=mode==='changed-target';
   let wallets=[{wallet,burnedTokens:12,receiptCount:1,latestSignature:changed?'5'.repeat(88):signature},{wallet:other,burnedTokens:4,receiptCount:1,latestSignature:signature}];
   let assets=[{address:mint,name:'Fixture one',symbol:'ONE',curveCapSol:100,createdTimestamp:1767225600,recentTrades:[{trader:wallet,signature:changed?'5'.repeat(88):signature,blockTime:1790000000,side:'buy',solLamports:reverse?'100000000':'2000000000'},{trader:other,signature,blockTime:1790000001,side:'sell',solLamports:reverse?'2000000000':'100000000'}]},{address:other,name:'Fixture two',symbol:'TWO',curveCapSol:reverse?200:20,createdTimestamp:1767225601}];
   if(mode==='removed'){wallets=wallets.slice(1);assets=assets.slice(1);}else if(reverse)wallets.reverse();
   const ready=!['loading','unavailable'].includes(mode),s={leaderboardView:view,burnersBoardState:{status:ready?'ready':mode,wallets:empty?[]:wallets},burnBoardState:{status:ready?'ready':mode,projects:empty?[]:wallets.map(w=>({...w,mint:w.wallet===wallet?mint:other,name:'Fixture project',symbol:'QA',burnerCount:1}))},verifiedLaunchPoliciesStatus:ready?'ready':mode,exploreFeedAvailable:ready,EXPLORE_CLUSTER:'devnet',coinSolUsdPrice:25,assets:empty?[]:assets,verifiedLaunchPolicies:assets.map(a=>({mint:a.address,cluster:'devnet',onchainVerified:true,creatorWallet:changed&&a.address===mint?other:wallet}))};
   const deps={formatOnchainAge:()=> 'fixture age',exploreExplorer:p=>`https://explorer.solana.com/${p}?cluster=devnet`,launchBurnersFallback:()=>[],launchBurnBoardFallback:()=>[],rankObservedTraders:(a,p)=>model.rankObservedTraders(a,p,{nowSeconds:1790000002}),loadWalletBurnBoard:()=>{}};deps.renderWalletBurnersBoard=()=>board.renderWalletBurnersBoard(s,deps);deps.renderProjectBurnBoard=()=>board.renderProjectBurnBoard(s,deps);board.renderLeaderboard(s,deps);
  };
 },{wallet,other,mint,signature});
 const render=(view,mode)=>page.evaluate(({view,mode})=>window.renderRefreshFixture(view,mode),{view,mode});
 const observations=[];
 async function focusSecond(){await table.focus();await page.keyboard.press('Tab');await page.keyboard.press('Tab');await expect(table.locator('.leaderboard-row').first().locator('a').last()).toBeFocused();return page.evaluate(()=>{const a=document.activeElement;window.oldLeaderboardAnchor=a;return{href:a.getAttribute('href'),name:a.textContent,row:a.closest('.leaderboard-row').querySelector('a').getAttribute('href'),rank:a.closest('.leaderboard-row').children[0].textContent}});}
 async function same(old,label){await expect.poll(()=>page.evaluate(()=>document.activeElement.getAttribute('href'))).toBe(old.href);const next=await page.evaluate(()=>{const a=document.activeElement;return{href:a.getAttribute('href'),name:a.textContent,row:a.closest('.leaderboard-row')?.querySelector('a').getAttribute('href'),rank:a.closest('.leaderboard-row')?.children[0].textContent,visible:a.matches(':focus-visible'),connected:a.isConnected}});expect(next.name,label).toBe(old.name);expect(next.row,label).toBe(old.row);expect(next.visible&&next.connected,label).toBe(true);observations.push({label,old,next});return next;}
 for(const view of['burners','burn-board','creators','traders']){
  await render(view);await expect(table.locator('.leaderboard-row')).toHaveCount(2);const old=await focusSecond();
  // Actual asynchronous task boundary, actual renderer, no synthetic focus event.
  await page.evaluate(view=>new Promise(done=>setTimeout(()=>{window.renderRefreshFixture(view);done()},25)),view);await same(old,`${view} unchanged async rows`);
  await render(view,'reordered');const reordered=await same(old,`${view} reordered same row and link, not ordinal`);expect(reordered.rank).not.toBe(old.rank);
  await render(view,'changed-target');await expect(table).toBeFocused();await render(view);await expect(table).toBeFocused();
  await focusSecond();await render(view,'removed');await expect(table).toBeFocused();
  for(const mode of['loading','empty','unavailable']){await render(view);await focusSecond();await render(view,mode);await expect(table).toBeFocused();await expect(table.getByRole('columnheader')).toHaveCount(5);await expect(table.locator('.empty-state').getByRole('cell')).toHaveAttribute('aria-colspan','5');await expect(table.locator('a')).toHaveCount(0);await render(view);await expect(table).toBeFocused();}
  await focusSecond();await page.evaluate(()=>{window.pendingLeaderboardRefresh=()=>window.renderRefreshFixture(document.querySelector('#leaderboard-table').dataset.view,'reordered')});await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');const guide=page.locator('#leaderboard-panel a.text-button');await expect(guide).toBeFocused();await page.evaluate(()=>window.pendingLeaderboardRefresh());await expect(guide).toBeFocused();
  await page.evaluate(()=>document.activeElement.blur());await render(view);expect(await page.evaluate(()=>document.activeElement===document.body)).toBe(true);
 }
 expect(errors).toEqual([]);await info.attach('controlled-refresh-focus',{body:JSON.stringify({width,label:'Actual app startup and canonical renderer/model with synthetic deterministic rows and asynchronous task/response controls, not natural public refresh or financial proof. Fallback is existing table tabstop; outside focus and BODY remain untouched.',observations},null,2),contentType:'application/json'});
});
