import { test, expect } from '@playwright/test';

const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors=[];failures.set(page,errors);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/qa-public-share', route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><dialog id="qa-dialog"><p id="share-status"></p></dialog></body></html>'}));
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/x-public-trade-shares/config',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:true,cluster:'devnet',origin:new URL(route.request().url()).origin,account:'fundedfixture'})}));
});
test.afterEach(async ({page})=>expect(failures.get(page),'No uncaught browser exceptions').toEqual([]));
async function mount(page, mode='immediate', expand=true) {
  await page.goto('/qa-public-share');
  await page.evaluate(async mode=>{
    const {mountPublicTradeShare}=await import('/public-trade-share-ui.js');
    window.shareFixture={current:true,signs:0};
    const fixture=window.shareFixture;
    const dialog=document.querySelector('#qa-dialog');
    dialog.showModal();
    await mountPublicTradeShare(dialog,{kind:'roundtrip',network:'devnet',wallet:'wallet-fixture',mint:'mint-fixture',buyReceipt:'buy-fixture',receipt:'sell-fixture'}, {
      assertCurrent:()=>{if(!fixture.current)throw new Error('Wallet changed; review permission again.');},
      sign:async()=>{fixture.signs++;if(mode==='cancel'&&fixture.signs===1)throw new Error('User rejected message signing');if(mode==='pending')await new Promise(resolve=>{fixture.resolve=resolve;});return 'synthetic-message-signature';},
    });
  },mode);
  if(expand)await page.locator('#public-trade-share summary').click();
}
async function challenge(page, patch={}) {
  await page.route('**/api/x-public-trade-shares/challenge',async route=>{
    const body=route.request().postDataJSON();
    expect(body).toEqual({wallet:'wallet-fixture',mint:'mint-fixture',buySignature:'buy-fixture',sellSignature:'sell-fixture'});
    const origin=new URL(route.request().url()).origin;
    const expiresAt=new Date(Date.now()+240000).toISOString();
    const value={origin,cluster:'devnet',wallet:body.wallet,mint:body.mint,account:'fundedfixture',challengeId:'a'.repeat(43),expiresAt};
    value.statement=['funded.app public closed-trade sharing consent v1','Purpose: publish-closed-trade-on-x',`Origin: ${origin}`,'X account: @fundedfixture','Network: Solana Devnet (test funds)',`Wallet: ${body.wallet}`,`Mint: ${body.mint}`,`Buy receipt: ${body.buySignature}`,`Sell receipt: ${body.sellSignature}`,`Issued at: ${new Date().toISOString()}`,`Signature acceptance deadline: ${expiresAt}`,`Challenge: ${value.challengeId}`,'I authorize one factual public X summary of this exact closed trade after receipt verification. This does not authorize future trades or transactions.'].join('\n');
    await route.fulfill({contentType:'application/json',body:JSON.stringify({...value,...patch})});
  });
}

test('explicit one-trade approval retries uncertain submission with the same signature',async({page})=>{
  await challenge(page);
  const submissions=[];
  await page.route('**/api/x-public-trade-shares/consent',async route=>{
    submissions.push(route.request().postDataJSON());
    await route.fulfill({status:submissions.length===1?503:201,contentType:'application/json',body:JSON.stringify(submissions.length===1?{error:'Confirmation unavailable; retry.'}:{status:'accepted'})});
  });
  await mount(page);
  await page.locator('#public-share-preview').click();
  await expect(page.locator('#public-share-statement')).toContainText('one factual public X summary');
  await expect(page.locator('#public-share-allow')).not.toBeChecked();
  await expect(page.locator('#public-share-sign')).toBeDisabled();
  await page.locator('#public-share-allow').check();
  await page.locator('#public-share-sign').click();
  await expect(page.locator('#public-share-sign')).toHaveText('Retry same permission');
  await page.locator('#public-share-sign').click();
  await expect(page.locator('#public-share-status')).toContainText('Permission saved. Publication depends');
  expect(await page.evaluate(()=>window.shareFixture.signs)).toBe(1);
  expect(submissions).toHaveLength(2);expect(submissions[1]).toEqual(submissions[0]);
});

test('wallet changes during signing prevent consent submission',async({page})=>{
  await challenge(page);let submitted=0;
  await page.route('**/api/x-public-trade-shares/consent',route=>{submitted++;return route.fulfill({contentType:'application/json',body:'{}'});});
  await mount(page,'pending');await page.locator('#public-share-preview').click();
  await page.locator('#public-share-allow').check();await page.locator('#public-share-sign').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.shareFixture.resolve)).toBe('function');
  await page.evaluate(()=>{window.shareFixture.current=false;window.shareFixture.resolve();});
  await expect(page.locator('#public-share-status')).toContainText('Wallet changed');
  expect(submitted).toBe(0);
});

test('closing the permission dialog while signing suppresses submission',async({page})=>{
  await challenge(page);let submitted=0;
  await page.route('**/api/x-public-trade-shares/consent',route=>{submitted++;return route.fulfill({contentType:'application/json',body:'{}'});});
  await mount(page,'pending');await page.locator('#public-share-preview').click();
  await page.locator('#public-share-allow').check();await page.locator('#public-share-sign').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.shareFixture.resolve)).toBe('function');
  await page.evaluate(async()=>{document.querySelector('#qa-dialog').close();window.shareFixture.resolve();await new Promise(resolve=>setTimeout(resolve,0));});
  expect(submitted).toBe(0);
  await expect(page.locator('#qa-dialog')).not.toBeVisible();
});

test('mismatched preview never enables permission signing',async({page})=>{
  await challenge(page,{cluster:'mainnet-beta'});
  await mount(page);await page.locator('#public-share-preview').click();
  await expect(page.locator('#public-share-status')).toContainText('does not match');
  await expect(page.locator('#public-share-sign')).toBeHidden();
  expect(await page.evaluate(()=>window.shareFixture.signs)).toBe(0);
});

test('cancelled message approval can be retried without submitting the rejected attempt',async({page})=>{
  await challenge(page);let submitted=0;
  await page.route('**/api/x-public-trade-shares/consent',route=>{submitted++;return route.fulfill({status:201,contentType:'application/json',body:'{"status":"accepted"}'});});
  await mount(page,'cancel');await page.locator('#public-share-preview').click();
  await page.locator('#public-share-allow').check();await page.locator('#public-share-sign').click();
  await expect(page.locator('#public-share-status')).toContainText('User rejected');
  expect(submitted).toBe(0);
  await page.locator('#public-share-sign').click();
  await expect(page.locator('#public-share-status')).toContainText('Permission saved');
  expect(submitted).toBe(1);expect(await page.evaluate(()=>window.shareFixture.signs)).toBe(2);
});

test('disabled publication capability exposes no permission action',async({page})=>{
  await page.route('**/api/x-public-trade-shares/config',route=>route.fulfill({contentType:'application/json',body:'{"enabled":false,"cluster":"devnet"}'}));
  await mount(page,'immediate',false);
  await expect(page.locator('#public-trade-share')).toHaveCount(0);
  expect(await page.evaluate(()=>window.shareFixture.signs)).toBe(0);
});
