import{test,expect}from'@playwright/test';
import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';
import{DEFAULT_SERVICE_FEES}from'../../service-fees.js';
const mint='9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
const receipts=()=>['3','4','5'].map((letter,i)=>({mint,signature:letter.repeat(64),status:'finalized',vaultDebitVerified:true,burnInstructionVerified:true,burnedBaseUnits:String(1000+i),finalizedAt:'2026-10-31T00:00:00.000Z'}));
async function fixtures(page,baseURL){
  await page.addInitScript(()=>{sessionStorage.setItem('funded.app.wallet.manual-disconnect','1');window.activityRefreshes=0;window.addEventListener('funded:financial-center-data',()=>window.activityRefreshes++);});
  await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());return u.origin===new URL(baseURL).origin&&(q.method()==='GET'||u.pathname.startsWith('/api/'))?r.fallback():r.abort();});
  await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Offline UI refresh fixture'}}));
  await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
}
for(const width of[390,1440])for(const fallback of[false,true])test(`activity refresh retains native controls at ${width}px with ${fallback?'fallback':'native'} moves`,async({page,baseURL})=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'});await fixtures(page,baseURL);
  if(fallback)await page.addInitScript(()=>{Element.prototype.moveBefore=undefined;});
  let data=receipts(),hold=false;const releases=[];await page.route('**/api/buyback/status',async r=>{if(hold)await new Promise(resolve=>releases.push(resolve));await r.fulfill({json:{cluster:'devnet',pending:[],receipts:data}});});
  await page.clock.install();await page.goto('/#payments/activity');const center=page.locator('#financial-center'),rows=center.locator('.financial-record');await expect(rows).toHaveCount(3);await expect(center.locator('[data-flow-rows]')).toHaveAttribute('aria-busy','false');
  const refresh=async()=>{const before=await page.evaluate(()=>window.activityRefreshes);await page.clock.fastForward(60001);await expect.poll(()=>page.evaluate(()=>window.activityRefreshes)).toBeGreaterThan(before);await page.clock.runFor(80);};
  const summary=rows.first().locator('summary');await summary.focus();await page.keyboard.press('Enter');await expect(rows.first().locator('details')).toHaveAttribute('open','');const originalSummary=await summary.elementHandle();
  await refresh();expect(await originalSummary.evaluate(e=>e===document.activeElement)).toBe(true);await expect(rows.first().locator('details')).toHaveAttribute('open','');
  await rows.first().locator('.financial-record-meta a').focus();await page.keyboard.press('Tab');const original=await rows.first().locator('.financial-record-action').elementHandle();expect(await original.evaluate(e=>e===document.activeElement)).toBe(true);
  data[0]={...data[0],burnedBaseUnits:'9007199254740993123456789'};await refresh();expect(await original.evaluate(e=>e===document.activeElement)).toBe(true);await expect(rows.first()).toContainText('9,007,199,254,740,993,123,456,789');
  data.reverse();await refresh();expect(await original.evaluate(e=>e===document.activeElement)).toBe(true);expect(await original.getAttribute('href')).toContain('receipt='+'3'.repeat(64));
  expect(await original.evaluate(e=>{const r=e.getBoundingClientRect(),nav=document.querySelector('.mobile-workspace-nav');return r.top>=0&&r.bottom<=(nav?.getClientRects().length?nav.getBoundingClientRect().top:innerHeight);})).toBe(true);
  data=data.filter(row=>row.signature!=='3'.repeat(64));await refresh();await expect(center.locator('#financial-center-title')).toBeFocused();await expect(rows).toHaveCount(2);
  await rows.first().locator('.financial-record-action').focus();const before=await page.evaluate(()=>window.activityRefreshes);hold=true;await page.clock.fastForward(60001);await expect.poll(()=>releases.length).toBeGreaterThan(0);
  await page.locator('#connect-button').evaluate(e=>e.focus({preventScroll:true}));hold=false;for(const release of releases)release();await expect.poll(()=>page.evaluate(()=>window.activityRefreshes)).toBeGreaterThan(before);await expect(page.locator('#connect-button')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const width of[390,1440])test(`FAQ keeps its reading position through a service-fee refresh at ${width}px`,async({page,baseURL})=>{
  test.setTimeout(60000);await page.setViewportSize({width,height:900});await fixtures(page,baseURL);let release;
  await page.route('**/api/service-fees',async r=>{await new Promise(resolve=>release=resolve);await r.fulfill({json:{cluster:'devnet',revision:1,hash:'a'.repeat(64),recipient:mint,tradeRecipient:mint,policy:{...DEFAULT_SERVICE_FEES,launchLamports:'30000000'}}});});
  await page.goto('/#overview');await page.locator('body.product-flows-ready').waitFor();const faq=page.locator('[data-faq="service-prices"]'),summary=faq.locator('summary');await expect.poll(()=>Boolean(release)).toBe(true);
  if(!await faq.evaluate(e=>e.open))await summary.click();const original=await summary.elementHandle();
  const reading=width===390?summary:faq.getByRole('link');await reading.focus();release();await expect(faq).toContainText('0.03 SOL service fee');
  expect(await original.evaluate(e=>e===document.querySelector('[data-faq="service-prices"]>summary'))).toBe(true);await expect(reading).toBeFocused();await expect(faq).toHaveAttribute('open','');
  await page.evaluate(()=>window.dispatchEvent(new Event('funded:service-fees')));await expect(reading).toBeFocused();
  await page.goto('/#referrals');const rates=page.locator('[data-faq="referral-rates"]');await expect(rates).toContainText('saved on-chain policy');await expect(rates).not.toContainText('First-touch wallet attribution');
  await rates.getByRole('link',{name:'Read referral payout rules →'}).focus();await page.keyboard.press('Enter');await expect(page.locator('#docs-guide-article h1')).toHaveText('Referral network and Daily referrer bonus');
});
