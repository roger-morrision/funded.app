import{test,expect}from'@playwright/test';
import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';

// Fully synthetic provider/RPC responses. No key, signing or external network.
const wallet='ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC',mint='HdGmAbwR1ng3VTQkQ6Gw3QYhJGebWNFf5voktjCKwhvL';
const classic='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
for(const width of[360,390,1440])test(`native Portfolio holdings partial coverage and Refresh at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:width<700?844:900});
 const errors=[],reads=[],writes=[];let mode='classic-fails';page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.abort());
 await page.route('**/api/**',r=>{if(r.request().method()!=='GET')writes.push({method:r.request().method(),path:new URL(r.request().url()).pathname});return r.fulfill({status:503,json:{error:'Controlled offline API'}})});
 await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
 await page.route(`**/api/wallets/${wallet}/trades`,r=>r.fulfill({json:{wallet,cluster:'devnet',source:'finalized-wallet-pump-trades',coverage:'complete',signatureLimit:50,rowLimit:100,scannedSignatures:0,trades:[]}}));
 await page.route('**/api/solana/rpc*',r=>{
  const q=r.request().postDataJSON(),ok=result=>r.fulfill({json:{jsonrpc:'2.0',id:q.id,result}}),fail=()=>r.fulfill({json:{jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'Controlled unavailable token program'}}});
  if(q.method==='getTokenAccountsByOwner'){
   const isClassic=q.params[1]?.programId===classic;reads.push({owner:q.params[0],program:q.params[1]?.programId,mode});
   if(mode==='both-fail'||mode==='classic-fails'&&isClassic||['token2022-fails','partial-nonempty'].includes(mode)&&!isClassic)return fail();
   const value=mode==='partial-nonempty'&&isClassic?[{pubkey:mint,account:{data:{parsed:{info:{owner:wallet,mint,tokenAmount:{amount:'2000000',decimals:6,uiAmount:2,uiAmountString:'2'}}},program:'spl-token',space:165},executable:false,lamports:2039280,owner:classic,rentEpoch:0}}]:[];
   return ok({context:{slot:1},value});
  }
  if(q.method==='getMultipleAccounts')return ok({context:{slot:1},value:q.params[0].map(()=>null)});
  if(q.method==='getBalance')return ok({context:{slot:1},value:0});
  if(q.method==='getAccountInfo')return ok({context:{slot:1},value:null});
  if(q.method==='getSlot')return ok(1);return fail();
 });
 await page.addInitScript(address=>{
  const events=new Map(),provider={isPhantom:true,isConnected:false,publicKey:null,on(name,fn){events.set(name,[...(events.get(name)||[]),fn])},
   async connect(options={}){if(options.onlyIfTrusted)throw Error('Synthetic provider is not trusted');provider.publicKey={toBase58:()=>address};provider.isConnected=true;for(const fn of events.get('connect')||[])fn(provider.publicKey);return{publicKey:provider.publicKey}},
   async disconnect(){provider.publicKey=null;provider.isConnected=false;for(const fn of events.get('disconnect')||[])fn()},async signTransaction(){throw Error('Fixture forbids signing')}};
  window.phantom={solana:provider};window.solana=provider;
 },wallet);
 await page.goto('/#my-launches');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.evaluate(()=>document.fonts.ready);
 expect(reads).toEqual([]);await page.locator('#connect-button').click();await page.locator('[data-wallet-choice="phantom"]').click();
 const value=page.locator('#portfolio-total-value'),status=page.locator('#portfolio-holdings-status'),rows=page.locator('#portfolio-holding-rows'),refresh=page.locator('#portfolio-refresh');
 await expect(status).toContainText('Partial token-program coverage');await expect(value).toHaveText('—');await expect(rows).toContainText('Some token balances could not be checked. Select Refresh to retry.');await expect(rows).not.toContainText('No SPL token holdings');await page.waitForLoadState('networkidle');
 const focusClear=async()=>{await expect(refresh).toBeFocused();await expect.poll(()=>refresh.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),m=parseFloat(s.outlineWidth)+Math.max(0,parseFloat(s.outlineOffset)||0),h=document.querySelector('.topbar'),n=document.querySelector('.mobile-workspace-nav'),top=h?.getClientRects().length?h.getBoundingClientRect().bottom:0,bottom=n?.getClientRects().length?n.getBoundingClientRect().top:innerHeight;return r.top-m>=top-1&&r.bottom+m<=bottom+1&&r.left-m>=-1&&r.right+m<=innerWidth+1})).toBe(true)};
 const recover=async(next,expected)=>{mode=next;const before=reads.length;await refresh.focus();await page.keyboard.press('Enter');await expect(value).toHaveText(expected);await expect.poll(()=>reads.length-before).toBe(2);await focusClear();};
 await recover('complete','$0.00');await expect(rows).toContainText('No SPL token holdings');
 await recover('token2022-fails','—');await expect(rows).toContainText('Some token balances could not be checked');await expect(status).toContainText('0 observed tokens');
 await page.screenshot({path:info.outputPath(`partial-empty-${width}.png`)});
 await recover('partial-nonempty','—');await expect(rows.locator('.portfolio-holding-row')).toHaveCount(1);await expect(status).toContainText('1 observed token ·');await expect(rows).toContainText('2');
 await recover('both-fail','—');await expect(rows).toContainText('unavailable from Solana RPC. Select Refresh to retry.');
 await recover('complete','$0.00');await expect(rows).toContainText('No SPL token holdings');
 for(const tab of['trades','holdings']){await page.locator(`[data-portfolio-tab="${tab}"]`).click();await expect(page.locator(`[data-portfolio-tab="${tab}"]`)).toHaveAttribute('aria-selected','true')}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('#connect-button').click();await page.locator('#wallet-popover-disconnect').click();const before=reads.length;await expect(page.locator('#portfolio-holdings-disconnected')).toBeVisible();await expect(refresh).toBeHidden();await expect(rows.locator('.portfolio-holding-row')).toHaveCount(0);await expect(value).toHaveText('—');expect(reads.length).toBe(before);
 // Disconnect intentionally invokes the existing session logout. It too is
 // intercepted above; assert its exact identity rather than permitting writes.
 expect(writes).toEqual([{method:'POST',path:'/api/referrals/session/logout'}]);expect(errors).toEqual([]);
 await info.attach('synthetic-program-reads',{body:JSON.stringify(reads),contentType:'application/json'});
});
