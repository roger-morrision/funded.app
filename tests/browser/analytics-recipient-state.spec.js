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
