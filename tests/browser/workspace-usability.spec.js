import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors=[];failures.set(page,errors);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline fixture"}' }));
  await page.route('https://**/*', route => route.abort());
});
test.afterEach(async({page})=>expect(failures.get(page),'No uncaught browser errors').toEqual([]));

async function mountHistory(page,id){
  await page.goto('/#docs');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.evaluate(async id=>{
    const {mountReceiptHistory}=await import('/receipt-history-ui.js');
    const container=document.createElement('section');container.id='exact-receipt-fixture';document.querySelector('#docs').append(container);
    mountReceiptHistory(container,id,'devnet');
  },id);
  return page.locator('#exact-receipt-fixture');
}

test('service status explains each check without equating availability with payment success', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ cluster: 'devnet', status: 'degraded', observedAt: '2026-10-04T05:00:00Z', checks: [{ id: 'storage', status: 'operational' }, { id: 'network', status: 'wrong-network' }] }) }));
  await page.goto('/#docs');
  await page.getByRole('button', { name: 'Check service status' }).click();
  const panel = page.locator('#service-status');
  await expect(panel.locator('[role=status]')).toContainText('some services need attention');
  await expect(panel.locator('li').first()).toContainText('Saved records');
  await expect(panel.locator('li').last()).toContainText('Network does not match this app');
  await expect(panel.locator('.service-status-scope')).toContainText('transaction receipt');
  await expect(panel).toHaveAttribute('aria-busy', 'false');
});

test('payment history retains verified page and matching CSV when next page fails', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/creators/test-user/receipts*', route => {
    requests += 1;
    if (requests > 1) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline fixture"}' });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ cluster: 'devnet', commitment: 'finalized', status: 'onchain-indexed', checkedPayouts: 1, nextCursor: 'page-two', receipts: [{ signature: '1'.repeat(88), slot: 50, amountLamports: '18446744073709551615', paidAt: '2026-10-04T05:00:00Z' }] }) });
  });
  await page.goto('/#docs');
  await page.evaluate(async () => {
    const { mountReceiptHistory } = await import('/receipt-history-ui.js');
    const container = document.createElement('section'); container.id = 'receipt-usability-fixture'; document.querySelector('#docs').append(container);
    mountReceiptHistory(container, 'test-user', 'devnet');
  });
  const panel = page.locator('#receipt-usability-fixture');
  await panel.getByRole('button', { name: 'Load payment history' }).click();
  await expect(panel.locator('.receipt-history-card strong')).toHaveText('18446744073.709551615 SOL');
  await panel.getByRole('button', { name: 'Next page' }).click();
  await expect(panel.locator('[role=status]')).toContainText('Page 1 remains displayed');
  await expect(panel.locator('.receipt-history-card')).toHaveCount(1);
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download page as CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('funded-devnet-receipts-page-1.csv');
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv).toContain('18446744073.709551615');
  expect(csv).toContain('current verified page only');
});

test('empty payment history explains pending rewards and disables export', async ({ page }) => {
  await page.route('**/api/creators/empty-user/receipts', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ cluster: 'devnet', commitment: 'finalized', status: 'no-records', checkedPayouts: 0, receipts: [] }) }));
  await page.goto('/#docs');
  await page.evaluate(async () => {
    const { mountReceiptHistory } = await import('/receipt-history-ui.js');
    const container = document.createElement('section'); container.id = 'empty-receipt-fixture'; document.querySelector('#docs').append(container);
    mountReceiptHistory(container, 'empty-user', 'devnet');
  });
  const panel = page.locator('#empty-receipt-fixture');
  await panel.getByRole('button', { name: 'Load payment history' }).click();
  await expect(panel.locator('.receipt-history-empty')).toContainText('check pending amounts');
  await expect(panel.getByRole('button', { name: 'Download page as CSV' })).toBeDisabled();
  await expect(panel.locator('[data-history-rows]')).toHaveAttribute('aria-busy', 'false');
});

test('mixed receipt evidence keeps fifteen lamports exact and flags omitted invalid rows',async({page})=>{
  const valid={signature:'1'.repeat(88),slot:50,amountLamports:'15',paidAt:'2026-10-04T05:00:00Z'};
  await page.route('**/api/creators/exact-user/receipts',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({cluster:'devnet',commitment:'finalized',status:'onchain-indexed',checkedPayouts:4,receipts:[valid,{...valid,signature:'2'.repeat(88),amountLamports:9007199254740992},{...valid,signature:'3'.repeat(88),amountLamports:'15.0000000000000001'},{...valid,signature:'4'.repeat(88),slot:0}]})}));
  const panel=await mountHistory(page,'exact-user');await panel.getByRole('button',{name:'Load payment history'}).click();
  await expect(panel.locator('.receipt-history-card')).toHaveCount(1);
  await expect(panel.locator('.receipt-history-card strong')).toHaveText('0.000000015 SOL');
  await expect(panel.locator('[role=status]')).toContainText(/could not be verified|invalid|incomplete/i);
  await expect(panel.locator('[role=status]')).not.toContainText('reached the end');
  await expect(panel.getByRole('button',{name:'Retry this page'})).toBeVisible();
  const pending=page.waitForEvent('download');await panel.getByRole('button',{name:'Download page as CSV'}).click();
  const csv=await readFile(await(await pending).path(),'utf8');
  await expect(panel.locator('[role=status]')).toContainText(/could not be verified|invalid|incomplete/i);
  await expect(panel.getByRole('button',{name:'Retry this page'})).toBeVisible();
  expect(csv.trim().split('\r\n')).toHaveLength(2);
  expect(csv).toContain('current verified page only (verified subset)');
  expect(csv).toContain('"15","0.000000015"');expect(csv).toContain(valid.signature);
  for(const digit of ['2','3','4'])expect(csv).not.toContain(digit.repeat(88));
});

test('unknown receipt proof stays retryable until a finalized exact payment is available',async({page})=>{
  let attempts=0;
  await page.route('**/api/creators/proof-user/receipts',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({cluster:'devnet',commitment:'finalized',status:++attempts===1?'proof-unavailable':'onchain-indexed',checkedPayouts:1,receipts:attempts===1?[]:[{signature:'5'.repeat(88),slot:51,amountLamports:'15',paidAt:'2026-10-04T05:00:00Z'}]})}));
  const panel=await mountHistory(page,'proof-user');await panel.getByRole('button',{name:'Load payment history'}).click();
  await expect(panel.locator('.receipt-history-empty')).toContainText('missing evidence');
  await expect(panel.getByRole('button',{name:'Download page as CSV'})).toBeDisabled();
  await expect(panel.locator('[role=status]')).not.toContainText('reached the end');
  await panel.getByRole('button',{name:'Retry this page'}).click();
  await expect(panel.locator('.receipt-history-card strong')).toHaveText('0.000000015 SOL');
  await expect(panel.getByRole('button',{name:'Download page as CSV'})).toBeEnabled();
  await expect(panel.getByRole('button',{name:'Retry this page'})).toBeHidden();
});

for(const [reason,cluster,commitment] of [['another network','mainnet-beta','finalized'],['unfinalized evidence','devnet','confirmed']])test(`receipt history rejects ${reason} without exporting it`,async({page})=>{
  await page.route('**/api/creators/untrusted-user/receipts',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({cluster,commitment,status:'onchain-indexed',checkedPayouts:1,receipts:[{signature:'6'.repeat(88),slot:51,amountLamports:'15',paidAt:'2026-10-04T05:00:00Z'}]})}));
  const panel=await mountHistory(page,'untrusted-user');await panel.getByRole('button',{name:'Load payment history'}).click();
  await expect(panel.locator('[role=status]')).toContainText('history is unavailable');
  await expect(panel.locator('.receipt-history-card')).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'Download page as CSV'})).toBeDisabled();
  await expect(panel.getByRole('button',{name:'Retry this page'})).toBeVisible();
});

test('keyboard receipt loading focuses Retry after failure and results after recovery',async({page})=>{
  let attempt=0;
  await page.route('**/api/creators/keyboard-user/receipts',route=>++attempt===1
    ?route.fulfill({status:503,contentType:'application/json',body:'{"error":"Temporarily unavailable"}'})
    :route.fulfill({contentType:'application/json',body:JSON.stringify({cluster:'devnet',commitment:'finalized',status:'onchain-indexed',checkedPayouts:1,receipts:[{signature:'7'.repeat(88),slot:51,amountLamports:'15'}]})}));
  const panel=await mountHistory(page,'keyboard-user');
  await panel.getByRole('button',{name:'Load payment history'}).focus();await page.keyboard.press('Enter');
  await expect(panel.getByRole('button',{name:'Retry this page'})).toBeFocused();
  await expect(panel.locator('[role=status]')).toContainText('history is unavailable');
  await page.keyboard.press('Enter');
  await expect(panel.locator('.receipt-history-card strong')).toHaveText('0.000000015 SOL');
  await expect(panel.locator('[role=status]')).toBeFocused();
  await expect(panel.locator('[role=status]')).toContainText('reached the end');
  await expect(panel.getByRole('button',{name:'Retry this page'})).toBeHidden();
});

test('receipt completion does not steal focus after the user moves to another control',async({page})=>{
  let pending;
  await page.route('**/api/creators/focus-user/receipts',route=>{pending=route;});
  const panel=await mountHistory(page,'focus-user');
  await page.evaluate(()=>{const button=document.createElement('button');button.id='unrelated-receipt-action';button.textContent='Another action';document.querySelector('#exact-receipt-fixture').after(button);});
  await panel.getByRole('button',{name:'Load payment history'}).focus();await page.keyboard.press('Enter');
  await expect.poll(()=>Boolean(pending)).toBe(true);
  await expect(panel.locator('[data-history-rows]')).toHaveAttribute('aria-busy','true');
  await page.locator('#unrelated-receipt-action').focus();
  await pending.fulfill({contentType:'application/json',body:JSON.stringify({cluster:'devnet',commitment:'finalized',status:'no-records',checkedPayouts:0,receipts:[]})});
  await expect(panel.locator('[data-history-rows]')).toHaveAttribute('aria-busy','false');
  await expect(panel.locator('[role=status]')).toContainText('reached the end');
  await expect(page.locator('#unrelated-receipt-action')).toBeFocused();
});

test('analytics preserves exact large totals and keeps missing collection amounts unavailable',async({page})=>{
  const exact='9007199254740993';
  await page.route('**/api/analytics/summary',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({homeFeeAllocations:{cluster:'devnet'},recordedCollectedLamports:null,exactLamports:{recordedCollectedLamports:exact},precisionStatus:'overflow'})}));
  let evidence={cluster:'devnet',status:'unverified-records',coverage:{recordedCollections:2},verifiedCollections:[],verifiedPayouts:[]};
  await page.route('**/api/evidence/receipts',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(evidence)}));
  await page.goto('/#analytics-detail');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const card=page.locator('[data-analytics-metric="fees"]');
  await expect(card.locator('small')).toContainText('9007199.254740993 SOL recorded in the ledger');
  await expect(card.locator('small')).toContainText('no matching on-chain proof');
  evidence={...evidence,status:'onchain-indexed',verifiedCollections:[{collectedLamports:Number.MAX_SAFE_INTEGER},{collectedLamports:2}]};
  await page.reload();await expect(card.locator('strong')).toHaveText('9007199.254740993 SOL');
  await expect(card.locator('small')).toContainText('verified subset');
  evidence={...evidence,verifiedCollections:[{collectedLamports:null}]};
  await page.reload();await expect(card.locator('strong')).toHaveText('—');
  await expect(card.locator('small')).toContainText(/collection total unavailable/i);
});
