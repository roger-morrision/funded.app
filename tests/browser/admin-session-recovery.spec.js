import {test,expect} from '@playwright/test';
import {adminFixture,ADMIN,SOURCE,overview,deferred} from './admin-review-fixture.js';
test('valid admin session stays usable when balance RPC fails, then recovers without signing in again (mocked API)',async({page})=>{
 let offline=true;const state=await adminFixture(page,async({path,send})=>{if(path!=='/api/admin/overview')return false;await send(offline?503:200,offline?{error:'RPC unavailable'}:overview(SOURCE));return true;});
 await page.goto('/admin.html');await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#auth-status')).toContainText('Signed in');
 await expect(page.locator('#summary')).toContainText('balances unavailable');await expect(page.locator('#withdraw-form [type=submit]')).toBeDisabled();
 offline=false;await page.locator('#refresh').click();await expect(page.locator('#wallet-rows')).toContainText(SOURCE);
 expect(state.requests.filter(r=>r.path==='/api/admin/challenge')).toHaveLength(0);
});
test('late session restoration cannot reopen the workspace after sign-out (mocked API)',async({page})=>{
 const gate=deferred();let held=false;
 await adminFixture(page,async({path,method,send})=>{if(path!=='/api/admin/session'||method!=='GET')return false;held=true;await gate.promise;await send(200,{wallet:ADMIN});return true;});
 await page.goto('/admin.html');await expect.poll(()=>held).toBe(true);
 await page.locator('#sign-in').click();await expect(page.locator('#workspace')).toBeVisible();await page.locator('#sign-out').click();gate.resolve();
 await expect(page.locator('#auth-status')).toHaveText('Not signed in');await expect(page.locator('#workspace')).toBeHidden();
});
test('outstanding overview and vault responses are discarded after logout (mocked API)',async({page})=>{
 const gate=deferred();let hold=false,held=false;
 await adminFixture(page,async({path,send})=>{if(!hold||path!=='/api/admin/overview')return false;held=true;await gate.promise;await send(200,overview(ADMIN));return true;});
 await page.goto('/admin.html');await expect(page.locator('#wallet-rows')).toContainText(SOURCE);hold=true;await page.locator('#refresh').click();await expect.poll(()=>held).toBe(true);
 await page.locator('#sign-out').click();gate.resolve();await expect(page.locator('#workspace')).toBeHidden();await expect(page.locator('#wallet-rows')).toBeEmpty();await expect(page.locator('#message')).toHaveText('Signed out.');
});
test('session expiry and protected 401 lock sensitive controls (mocked API)',async({page})=>{
 let expired=false;await adminFixture(page,async({path,send})=>{if(!expired||path!=='/api/admin/overview')return false;await send(401,{error:'Session expired.'});return true;});
 await page.goto('/admin.html');await expect(page.locator('#workspace')).toBeVisible();expired=true;await page.locator('#refresh').click();
 await expect(page.locator('#workspace')).toBeHidden();await expect(page.locator('#auth-status')).toContainText('Session expired');await expect(page.locator('#wallet-rows')).toBeEmpty();
});
test('local session deadline hides the workspace even without another request (mocked API)',async({page})=>{
 await adminFixture(page,()=>false,{expiresMs:2500});await page.goto('/admin.html');await expect(page.locator('#workspace')).toBeVisible();
 await expect(page.locator('#workspace')).toBeHidden({timeout:5000});await expect(page.locator('#auth-status')).toContainText('Session expired');
});
test('RPC health separates Redis savings and rejects future-dated financial freshness (mocked API)',async({page})=>{
 await adminFixture(page,async({path,send})=>{if(path!=='/api/admin/financial-health')return false;await send(200,{checkedAt:new Date(Date.now()+3600000).toISOString(),counts:{flows:3,alerts:0},alerts:[]});return true;});
 await page.setViewportSize({width:390,height:844});await page.goto('/admin.html');await expect(page.locator('[data-rpc-health]')).toContainText('Redis ready');
 const saved=page.locator('[data-rpc-health] dl div').filter({has:page.locator('dt',{hasText:'Redis requests saved'})});await expect(saved.locator('dd')).toHaveText('10');
 await expect(page.locator('[data-rpc-health]')).toContainText('not billed credits');await expect(page.locator('#financial-health')).toContainText('Monitor is stale');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
