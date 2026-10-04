import { test, expect } from '@playwright/test';

const failures=new WeakMap();
const key='funded.vip.pilot.v1';
test.beforeEach(async({page})=>{
  const errors=[];failures.set(page,errors);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Offline QA fixture"}'}));
  await page.route('https://**/*',route=>route.abort());
});
test.afterEach(async({page})=>expect(failures.get(page),'No uncaught browser errors').toEqual([]));
async function open(page,path='/#pilot'){
  await page.goto(path);await expect(page.locator('body')).toHaveClass(/workspace-ready/);
}

test('Home has a clear Devnet pilot path and setup requires no wallet',async({page})=>{
  await page.addInitScript(()=>{
    window.pilotWalletRequests=[];
    window.phantom={solana:{isPhantom:true,isConnected:false,publicKey:null,on:()=>{},connect:async options=>{window.pilotWalletRequests.push(options);throw new Error('Wallet has no prior approval');}}};
  });
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await open(page,'/#overview');
    await expect(page.locator('.home-hero-kicker')).toContainText('Devnet pilot');
    await page.getByRole('link',{name:'Start the creator pilot',exact:true}).click();
    const pilot=page.locator('#creator-pilot');await expect(pilot).toBeVisible();
    await expect(pilot.locator('.creator-pilot-disclosure')).toContainText('test funds with no monetary value');
    await expect(pilot.locator('[data-pilot-primary]')).toHaveText('Prepare your token');
    await expect(pilot.locator('[data-pilot-step="0"]')).toHaveText('Start without a wallet');
    await pilot.locator('[data-pilot-enroll]').click();
    await expect(page.locator('[data-pilot-role]')).toBeFocused();
    await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await pilot.locator('[data-pilot-primary]').boundingBox()).height).toBeGreaterThanOrEqual(44);
    await pilot.locator('[data-pilot-primary]').click();await expect(page.locator('#token-name')).toBeVisible();
    await page.locator('#token-name').fill('Wallet-free preparation');
    expect(await page.evaluate(()=>window.pilotWalletRequests.every(options=>options?.onlyIfTrusted===true)), 'No interactive wallet connection is requested').toBe(true);
    expect(await page.evaluate(()=>window.phantom.solana.isConnected)).toBe(false);
    expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();
  }
});

test('pilot resumes a saved draft only after explicit restore',async({page})=>{
  await open(page,'/#launch');await page.locator('#token-name').fill('Pilot saved draft');
  await page.locator('#token-symbol').fill('PILOT');
  await page.locator('.launch-draft-panel summary').click();await page.locator('#save-launch-draft').click();
  await expect(page.locator('#launch-draft-status')).toContainText('saved');
  await page.locator('#token-name').fill('Current unsaved work');
  await page.evaluate(()=>{location.hash='pilot';});
  await expect(page.locator('[data-pilot-primary]')).toHaveText('Resume your draft');
  await expect(page.locator('[data-pilot-step="0"]')).toHaveText('Draft saved on this device');
  await page.locator('[data-pilot-primary]').click();await expect(page.locator('#restore-launch-draft')).toBeFocused();
  await expect(page.locator('#token-name')).toHaveValue('Current unsaved work');
  await page.locator('#restore-launch-draft').click();await expect(page.locator('#token-name')).toHaveValue('Pilot saved draft');
});

test('unfinished launch routes to receipt recovery without claiming success',async({page})=>{
  await open(page);
  await page.evaluate(async()=>{const{recordLaunchEvent}=await import('/launch-journal.js');recordLaunchEvent('pilot-pending',{cluster:'devnet',state:'submitted',signature:'synthetic-pending-signature',mint:'11111111111111111111111111111111'});});
  await expect(page.locator('[data-pilot-primary]')).toHaveText('Check unfinished launch');
  await expect(page.locator('[data-pilot-primary]')).toHaveAttribute('href','#my-launches');
  await expect(page.locator('.creator-pilot-recovery')).toContainText('before starting another transaction');
  await expect(page.locator('[data-pilot-step="2"]')).toContainText('inspect the receipt before retrying');
  await page.locator('[data-pilot-primary]').click();await expect(page).toHaveURL(/#my-launches$/);
});

test('invitation copy and clipboard fallback do not enroll or send messages',async({page})=>{
  const writes=[];page.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(request.url());});
  await open(page,'/pilot');await expect(page.locator('#creator-pilot')).toBeVisible();
  await page.evaluate(()=>{navigator.clipboard.writeText=async value=>{window.pilotCopiedText=value;};});
  await page.locator('[data-pilot-copy]').click();
  await expect(page.locator('[data-pilot-copy-status]')).toContainText('Review it before sharing');
  expect(await page.evaluate(()=>window.pilotCopiedText)).toMatch(/Devnet \(test funds\).*\/#pilot/);
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('Clipboard denied');};});
  await page.locator('[data-pilot-copy]').click();await expect(page.locator('[data-pilot-copy-status]')).toContainText('Your pilot link:');
  expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();expect(writes).toEqual([]);
});
