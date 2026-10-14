import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await preview({ configLoader:'runner', preview:{ host:'127.0.0.1',port:0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : { channel:'chrome' }),
  headless:true,
});
const feePolicy = { split:{ operationsPercent:50,
  referralLevelPercents:[10,3,2],communityPercent:10,buybackPercent:25 } };
try {
  const context = await browser.newContext({ viewport:{ width:1280,height:800 } });
  await context.route('**/api/**', route => route.fulfill({ status:503,
    contentType:'application/json',body:'{"error":"fixture"}' }));
  await context.route('**/api/fee-policy', route => route.fulfill({ status:200,
    contentType:'application/json',body:JSON.stringify(feePolicy) }));
  let dashboardFixture = { status:'verified',collectedLamports:'447709',
    thresholdLamports:'5000000000',triggerReached:false,
    lastBurn:{ signature:'3'.repeat(64),burnedAt:'2026-10-13T12:25:09.000Z' } };
  const pending = [{ mint:'EtMFvbnLJMmp4PWqDVSqYzWfkWhZy3FznJQTN35rYWPc',
    amountLamports:'447709',status:'awaiting-v3-buyback-executor' }];
  const receipts = [{ mint:pending[0].mint,signature:'3'.repeat(64),
    status:'finalized',burnedBaseUnits:'1804874',
    vaultDebitVerified:true,burnInstructionVerified:true }];
  await context.route('**/api/buyback/status', route => route.fulfill({ status:200,
    contentType:'application/json',body:JSON.stringify({ cluster:'devnet',
      automationEnabled:true,pending,receipts,dashboard:dashboardFixture }) }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(`request ${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400 && !response.url().includes('/api/')) errors.push(`response ${response.status()} ${response.url()}`); });
  await page.goto(`${origin}/#overview`,{ waitUntil:'domcontentloaded' });
  await page.locator('body.product-experience-ready').waitFor({timeout:15_000});
  try { await page.waitForFunction(() => document.querySelector('#home-buyback-balance')?.textContent === '0.000447709 SOL',undefined,{ timeout:12_000 }); }
  catch (error) { throw new Error(`Buyback balance did not render: ${await page.locator('#home-buyback-balance').textContent()} · body=${await page.locator('body').getAttribute('class')} · bootstrap=${await page.locator('body').getAttribute('data-bootstrap-state')} · message=${await page.locator('[data-bootstrap-message]').textContent()} · errors=${errors.join('|')} · ${error.message}`); }
  assert.match(await page.locator('#home-buyback-status').textContent(),/awaiting 5 SOL/);
  assert.match(await page.locator('#home-buyback-last-time').textContent(),/2026/);
  assert.equal(await page.locator('#home-buyback-proof').isVisible(),true,
    JSON.stringify(await page.locator('#home-buyback-proof').evaluate(el=>({hidden:el.hidden,
      href:el.getAttribute('href'),display:getComputedStyle(el).display,
      parentDisplay:getComputedStyle(el.parentElement).display,
      hiddenAncestor:el.closest('[hidden]')?.id||el.closest('[hidden]')?.className||null,
      clientRects:el.getClientRects().length,
      sectionStyle:el.closest('.home-buyback-progress')?.getAttribute('style'),
      invisibleAncestors:[...function*(){let node=el;while(node){if(getComputedStyle(node).display==='none')yield node.tagName+'.'+node.className;node=node.parentElement}}()]}))));
  assert.match(await page.locator('#home-buyback-proof').getAttribute('href'),/cluster=devnet/);
  await mkdir('.tmp-ui-evidence',{recursive:true});
  await page.locator('.home-buyback-progress').first().screenshot({path:'.tmp-ui-evidence/buyback-progress.png'});
  await page.goto(`${origin}/#buybacks`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => document.querySelector('#buyback-route-balance')?.textContent === '0.000447709 SOL');
  await page.waitForFunction(() => document.querySelector('.reward-buyback-stats')?.textContent?.includes('0.000447709 SOL'));
  assert.match(await page.locator('.reward-buyback-stats').textContent(),/Completed buybacks1/);
  assert.match(await page.locator('.reward-buyback-list').textContent(),/awaiting the 5 SOL trigger/);
  assert.equal(await page.locator('.buyback-route-progress').isVisible(),true);
  assert.equal(await page.locator('#buyback-route-proof').isVisible(),true);
  dashboardFixture = { status:'verified',collectedLamports:'447709',
    unindexedStatus:'verified',unindexedLamports:'3477413',
    thresholdLamports:'5000000000',triggerReached:false,
    lastBurn:{ signature:'4'.repeat(64),burnedAt:'2026-10-14T13:05:20.000Z',
      source:'onchain-unindexed' } };
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => document.querySelector('#buyback-route-balance')?.textContent === '0.000447709 SOL');
  assert.match(await page.locator('#buyback-route-status').textContent(),/0.003477413 SOL in older vaults is excluded/);
  assert.equal(await page.locator('#buyback-route-track').getAttribute('aria-valuenow'),'0.000447709');
  assert.match(await page.locator('#buyback-route-track').getAttribute('aria-valuetext'),/0.000447709 SOL of 5 SOL eligible/);
  assert.match(await page.locator('#buyback-route-last-time').textContent(),/QA on-chain burn/);
  assert.equal(await page.locator('#buyback-route-proof').isVisible(),true);
  await context.close();

  const unavailable = await browser.newContext({ viewport:{width:390,height:844} });
  await unavailable.route('**/api/**', route => route.fulfill({ status:503,
    contentType:'application/json',body:'{"error":"fixture"}' }));
  await unavailable.route('**/api/fee-policy', route => route.fulfill({ status:200,
    contentType:'application/json',body:JSON.stringify(feePolicy) }));
  const mobile = await unavailable.newPage();
  await mobile.goto(`${origin}/#overview`,{ waitUntil:'domcontentloaded' });
  await mobile.waitForFunction(() => document.querySelector('#home-buyback-balance')?.textContent === '—');
  assert.equal(await mobile.locator('#home-buyback-proof').isVisible(),false);
  assert.match(await mobile.locator('#home-buyback-status').textContent(),/unavailable/);
  await unavailable.close();
  console.log('Buyback home progress desktop and mobile fixtures passed.');
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
