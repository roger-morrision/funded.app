import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const FOLLOW='funded.app.followed.wallets.v1',CREATORS='funded.creator.following',wallet='So11111111111111111111111111111111111111112';
const transfer=creators=>({version:1,wallets:[],creators,reminders:[]});
async function setup(page,width){
 await page.setViewportSize({width,height:900});await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
 await page.route('https://**/*',r=>r.abort());await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Unavailable safety fixture'}}));await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
 await page.goto('/#profile');await page.locator('body.product-flows-ready').waitFor();await page.locator('#preference-transfer-details > summary').click();
 const root=page.locator('#preference-transfer');return{root,data:root.getByLabel('Follows & reminders data',{exact:false}),apply:root.getByRole('button',{name:'Apply reviewed merge',exact:true})};
}
async function review(ui,value){await ui.data.fill(JSON.stringify(value));await ui.root.getByRole('button',{name:'Review import',exact:true}).click();await expect(ui.apply).toBeEnabled();}
for(const width of [390,1440]){
 test(`export invalidates an older import review at ${width}px (mocked APIs)`,async({page})=>{
  const ui=await setup(page,width);await review(ui,transfer(['123']));await ui.root.getByRole('button',{name:'Export preferences',exact:true}).click();
  expect(JSON.parse(await ui.data.inputValue()).creators).toEqual([]);await expect(ui.apply).toBeDisabled();expect(await page.evaluate(key=>localStorage.getItem(key),CREATORS)).toBeNull();
 });
 test(`merge preserves both followed wallet roles at ${width}px (mocked APIs)`,async({page})=>{
  await page.addInitScript(({FOLLOW,wallet})=>localStorage.setItem(FOLLOW,JSON.stringify([{address:wallet,roles:['creator']}])),{FOLLOW,wallet});const ui=await setup(page,width);
  await review(ui,{...transfer([]),wallets:[{address:wallet,roles:['trader']}]});await ui.apply.click();await expect(ui.root.getByRole('status')).toContainText('Reviewed preferences merged');
  expect((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),FOLLOW))[0].roles.sort()).toEqual(['creator','trader']);
 });
 test(`a changed device snapshot cannot be overwritten by a stale review at ${width}px (mocked APIs)`,async({page,context})=>{
  const ui=await setup(page,width);await review(ui,transfer(['123']));const other=await context.newPage();const otherUi=await setup(other,width);await review(otherUi,transfer(['456']));await otherUi.apply.click();await expect(otherUi.root.getByRole('status')).toContainText('Reviewed preferences merged');
  // The first tab may proactively disable the review or reject it on Apply.
  if(await ui.apply.isEnabled())await ui.apply.click();await expect(ui.root.getByRole('status')).toContainText(/changed.*review|review.*again/i);await expect(ui.apply).toBeDisabled();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),CREATORS)).toEqual(['456']);await other.close();
  await ui.root.getByRole('button',{name:'Review import',exact:true}).click();await ui.apply.click();expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),CREATORS)).toEqual(['456','123']);
 });
 test(`late account preferences cannot replace a newer device review at ${width}px (mocked identity)`,async({page})=>{
  const ui=await setup(page,width);let release,requested;const gate=new Promise(r=>release=r),started=new Promise(r=>requested=r);
  await page.route('**/api/creator-support/me',async r=>{requested();await gate;await r.fulfill({json:{user:{id:'99',username:'labeled_test_identity'},content:{preferenceSync:true},profile:{workspacePreferences:transfer(['999'])}}});});
  await ui.root.getByRole('button',{name:'Load from X account',exact:true}).click();await started;await review(ui,transfer(['123']));const response=page.waitForResponse(r=>r.url().endsWith('/api/creator-support/me'));release();await(await response).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(ui.data).toHaveValue(JSON.stringify(transfer(['123'])));await ui.apply.click();expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),CREATORS)).toEqual(['123']);
 });
 for(const mode of ['unreadable','silent-write'])test(`preference apply rejects ${mode} storage without a false success at ${width}px (mocked APIs)`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const ui=await setup(page,width);await review(ui,transfer(['123']));
  await page.evaluate(({key,mode})=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(name){if(mode==='unreadable'&&this===localStorage&&name===key)throw new DOMException('Denied','SecurityError');return get.call(this,name)};Storage.prototype.setItem=function(name,value){if(mode==='silent-write'&&this===localStorage&&name===key)return;return set.call(this,name,value)};window.restorePreferenceStorage=()=>{Storage.prototype.getItem=get;Storage.prototype.setItem=set;};},{key:CREATORS,mode});
  await ui.apply.click();await expect(ui.root.getByRole('status')).toContainText('could not be saved');await expect(ui.apply).toBeDisabled();await page.evaluate(()=>window.restorePreferenceStorage());expect(await page.evaluate(key=>localStorage.getItem(key),CREATORS)).toBeNull();expect(await page.evaluate(key=>localStorage.getItem(key),FOLLOW)).toBeNull();expect(errors).toEqual([]);
 });
 test(`identity change cancels a pending preference load at ${width}px (mocked identity)`,async({page})=>{
  const ui=await setup(page,width);await ui.data.fill(JSON.stringify(transfer(['123'])));let release,requested;const gate=new Promise(r=>release=r),started=new Promise(r=>requested=r);
  await page.route('**/api/creator-support/me',async r=>{requested();await gate;await r.fulfill({json:{user:{id:'99',username:'labeled_test_identity'},content:{preferenceSync:true},profile:{workspacePreferences:transfer(['999'])}}});});
  await ui.root.getByRole('button',{name:'Load from X account',exact:true}).click();await started;await page.evaluate(()=>window.dispatchEvent(new Event('funded:reward-identity-change')));const response=page.waitForResponse(r=>r.url().endsWith('/api/creator-support/me'));release();await(await response).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(ui.data).toHaveValue(JSON.stringify(transfer(['123'])));await expect(ui.apply).toBeDisabled();expect(await page.evaluate(key=>localStorage.getItem(key),CREATORS)).toBeNull();
 });

}
