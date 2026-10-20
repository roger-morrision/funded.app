import{test,expect}from'@playwright/test';
import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';

const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const receipts=Array.from({length:23},(_,i)=>({source:i===22?'automatic-holder':'v3-creator-wallet',to:'8'.repeat(44),signature:alphabet[i].repeat(88),amountLamports:100000+i,actualReceivedLamports:95000+i,feeLamports:5000,feePayer:'7'.repeat(44),blockTime:1792454400+i,slot:512479000+i}));
const key=row=>`${row.signature}:${row.to}:${row.source}`;

for(const width of[390,1440])test(`FQA-021 / UX-020 receipt controls survive read-only refresh at ${width}px (mocked evidence)`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:width===390?844:900});let rows=structuredClone(receipts),version=0;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Offline receipt focus fixture'}}));
  await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/evidence/payment-history',r=>r.fulfill({json:{cluster:'devnet',status:'onchain-indexed',generatedAt:`2026-10-20T00:${String(++version).padStart(2,'0')}:00Z`,verifiedPayouts:rows}}));
  await page.goto('/#payments');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.locator('[data-reward-open="history"]').click();
  await expect(page.locator('#payment-list .payment-history-row')).toHaveCount(23);
  const rowFor=receiptKey=>page.locator('#payment-list .payment-history-row').filter({has:page.locator(`details[data-receipt-key="${receiptKey}"]`)});
  const focused=()=>page.evaluate(()=>{const e=document.activeElement,r=e.getBoundingClientRect(),n=document.querySelector('.mobile-workspace-nav'),h=document.querySelector('.topbar'),s=getComputedStyle(e),margin=(parseFloat(s.outlineWidth)||0)+Math.max(0,parseFloat(s.outlineOffset)||0);return{key:e.closest('.payment-history-row')?.querySelector('details')?.dataset.receiptKey,tag:e.tagName,classes:e.className,scrollY,outline:s.outlineStyle,focusVisible:e.matches(':focus-visible'),visible:r.top-margin>=(h?.getClientRects().length?Math.max(0,h.getBoundingClientRect().bottom):0)&&r.bottom+margin<=(n?.getClientRects().length?n.getBoundingClientRect().top:innerHeight)}});
  const refresh=async()=>{
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/evidence/payment-history');
    await page.evaluate(()=>window.dispatchEvent(new Event('funded:route-change')));
    await(await response).finished();const minute=String(version).padStart(2,'0');
    await expect(page.locator('[data-analytics-metric="payouts"] small')).toContainText(`checked 00:${minute} UTC`);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  const check=async(receiptKey,selector)=>{
    await expect(rowFor(receiptKey).locator(selector)).toBeFocused();
    // Native keyboard focus can start a smooth scroll. Capture the settled
    // position before comparing refreshes; visibility alone can occur mid-scroll.
    await expect.poll(async()=>{
      const before=await focused();await page.waitForTimeout(100);const after=await focused();
      return before.visible&&after.visible&&before.scrollY===after.scrollY;
    },{timeout:1000}).toBe(true);
    const state=await focused();
    expect(state,JSON.stringify(state)).toMatchObject({key:receiptKey,focusVisible:true,visible:true});return state;
  };
  await page.locator('#payment-history-clear').click();for(let i=0;i<4;i++)await page.keyboard.press('Tab');
  const first=key(receipts[0]),second=key(receipts[1]);await check(first,'summary');await page.keyboard.press('Enter');await expect(rowFor(first).locator('details')).toHaveAttribute('open','');
  await rowFor(second).locator('summary').click();await rowFor(first).locator('.payment-history-wallet').focus();for(let i=0;i<3;i++)await page.keyboard.press('Tab');
  const stable=await check(first,'summary');await refresh();expect((await check(first,'summary')).scrollY).toBe(stable.scrollY);await expect(rowFor(second).locator('details')).toHaveAttribute('open','');
  await page.keyboard.press('Space');await expect(rowFor(first).locator('details')).not.toHaveAttribute('open','');await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');await check(first,'.payment-receipt-link');await refresh();await check(first,'.payment-receipt-link');
  await page.keyboard.press('Shift+Tab');await check(first,'.payment-copy-receiver');rows[0]={...rows[0],amountLamports:200000,actualReceivedLamports:195000};await refresh();await check(first,'.payment-copy-receiver');await expect(rowFor(first).locator('.payment-history-gross')).toContainText('0.0002 SOL');await expect(rowFor(first).locator('.payment-receipt-link')).toHaveAttribute('href',new RegExp(receipts[0].signature));
  await page.keyboard.press('Shift+Tab');await check(first,'.payment-history-wallet');[rows[0],rows[1]]=[rows[1],rows[0]];await refresh();await check(first,'.payment-history-wallet');await expect(rowFor(first).locator('details')).toHaveAttribute('open','');
  await page.locator('#payment-history-type').selectOption('creator');const pages=page.locator('nav[aria-label="Payment history pages"]');const next=pages.getByRole('button',{name:'Next payment history page'});await next.click();await expect(pages).toContainText('Page 2 of 3');
  // Existing pagination nodes must remain connected without a redundant DOM
  // move, preserving both Previous and Next focus during a background refresh.
  for(const button of[next,pages.getByRole('button',{name:'Previous payment history page'})]){
    await button.focus();await page.waitForTimeout(750);const oldButton=await button.elementHandle(),before=await focused();await refresh();await expect(button).toBeFocused();expect(await oldButton.evaluate(e=>e===document.activeElement)).toBe(true);expect((await focused()).scrollY).toBe(before.scrollY);await expect(pages).toContainText('Page 2 of 3');
  }
  const pageKey=key(receipts[10]);await rowFor(pageKey).locator('.payment-history-wallet').focus();for(let i=0;i<3;i++)await page.keyboard.press('Tab');await page.keyboard.press('Enter');const paged=await check(pageKey,'summary');await refresh();expect((await check(pageKey,'summary')).scrollY).toBe(paged.scrollY);await expect(pages).toContainText('Page 2 of 3');await expect(page.locator('#payment-history-type')).toHaveValue('creator');
  await page.screenshot({path:testInfo.outputPath('receipt-focus-retained.png')});
  // A genuine removal must use the stable visible filter control, never BODY
  // or a hidden receipt on another page. No receipt action is activated.
  rows=rows.filter(r=>key(r)!==pageKey);await refresh();await expect(page.locator('#payment-history-clear')).toBeFocused();expect((await focused()).visible).toBe(true);await expect(page.locator('#payment-history-type')).toHaveValue('creator');await expect(pages).toContainText('Page 2 of 3');
  // If the user is outside the list, refreshing must not steal focus or scroll.
  const outside=await page.locator('#payment-history-type').evaluate(e=>{e.focus({preventScroll:true});return scrollY});await refresh();await expect(page.locator('#payment-history-type')).toBeFocused();expect(await page.evaluate(()=>scrollY)).toBe(outside);
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});
