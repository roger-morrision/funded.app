import { test, expect } from '@playwright/test';
import {pilotSnapshot,pilotRecord,idlePilot,failPilotStorage,holdPilotTransaction,releasePilotTransaction} from './helpers/pilot-storage.js';

const failures=new WeakMap();
async function configure(page,errors){
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Offline QA fixture"}'}));
  await page.route('https://**/*',route=>route.abort());
}
test.beforeEach(async({page})=>{const errors=[];failures.set(page,errors);await configure(page,errors);});
test.afterEach(async({page})=>expect(failures.get(page),'No uncaught browser exceptions').toEqual([]));
async function open(page){await page.goto('/#pilot');await expect(page.locator('body')).toHaveClass(/workspace-ready/);await expect(page.locator('[data-pilot-consent]')).toBeVisible();await idlePilot(page);}
async function enroll(page){await page.locator('[data-pilot-role]').selectOption('creator');await page.locator('[data-pilot-source]').selectOption('creator-invite');await page.locator('[data-pilot-consent]').click();await expect(page.locator('[data-pilot-consent]')).toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeEnabled();}
async function signal(page,name,extra={}){await page.evaluate(({name,extra})=>window.dispatchEvent(new CustomEvent('funded:pilot-event',{detail:{name,...extra}})),{name,extra});await idlePilot(page);}
async function record(page){return pilotRecord(page);}
async function exported(page){const pending=page.waitForEvent('download');await page.locator('[data-pilot-export]').click();const download=await pending;const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString('utf8'));}

test('measurement is off by default and explicit enrollment records role and source without wallet setup',async({page})=>{
  await open(page);await expect(page.locator('#creator-pilot-metrics .pilot-panel')).toHaveCount(1);
  await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeDisabled();
  await signal(page,'launch-stopped',{wallet:'private-wallet-fixture'});expect(await record(page)).toBeNull();
  await page.locator('[data-pilot-consent]').click();await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();
  await expect(page.locator('[data-pilot-status]')).toContainText(/Choose.*creator|Choose.*role/i);
  await enroll(page);const value=await record(page);expect(value.role).toBe('creator');expect(value.source).toBe('creator-invite');expect(value.consented).toBe(true);
  expect(value.events.every(event=>event.incentive==='unknown'&&event.prompt==='unknown')).toBe(true);
});

test('export contains only allowed event facts and preserves voluntary versus incentivized context',async({page})=>{
  const writes=[];page.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()) && new URL(request.url()).pathname !== '/api/solana/rpc')writes.push(request.url());});
  await open(page);await enroll(page);
  await page.locator('[data-pilot-incentive]').selectOption('none');await page.locator('[data-pilot-prompt]').selectOption('voluntary');
  await signal(page,'launch-review-opened',{wallet:'PRIVATE-WALLET-CANARY',receipt:'PRIVATE-RECEIPT-CANARY',url:'https://secret.example',postText:'PRIVATE-POST-CANARY'});
  await signal(page,'not-an-allowed-event',{text:'PRIVATE-UNKNOWN-CANARY'});
  await page.locator('[data-pilot-incentive]').selectOption('offered');await page.locator('[data-pilot-prompt]').selectOption('reminder');
  await signal(page,'claim-stopped');
  const value=await exported(page);
  expect(value.events.find(event=>event.name==='launch-review-opened')).toMatchObject({incentive:'none',prompt:'voluntary'});
  expect(value.events.find(event=>event.name==='claim-stopped')).toMatchObject({incentive:'offered',prompt:'reminder'});
  expect(value.events.some(event=>event.name==='not-an-allowed-event')).toBe(false);
  for(const event of value.events)expect(Object.keys(event).sort()).toEqual(['at','incentive','name','prompt']);
  expect(JSON.stringify(value)).not.toMatch(/PRIVATE-|secret\.example/);
  expect(value.observedThrough).toMatch(/^\d{4}-/);
  expect(writes,'Local enrollment, recording and export must not upload participant data').toEqual([]);
});

test('visit context resets to unknown after reload instead of inheriting a no-incentive claim',async({page})=>{
  await open(page);await enroll(page);
  await page.locator('[data-pilot-incentive]').selectOption('none');await page.locator('[data-pilot-prompt]').selectOption('voluntary');
  await signal(page,'launch-review-opened');await page.reload();await expect(page.locator('[data-pilot-consent]')).toBeChecked();
  await expect(page.locator('[data-pilot-incentive]')).toHaveValue('unknown');await expect(page.locator('[data-pilot-prompt]')).toHaveValue('unknown');
  await signal(page,'claim-stopped');const value=await record(page);
  expect(value.events.find(event=>event.name==='launch-review-opened')).toMatchObject({incentive:'none',prompt:'voluntary'});
  expect(value.events.find(event=>event.name==='claim-stopped')).toMatchObject({incentive:'unknown',prompt:'unknown'});
});

test('revocation in another tab stops recording and export without recreating deleted data',async({page,context})=>{
  await open(page);await enroll(page);const other=await context.newPage();await configure(other,failures.get(page));await open(other);
  await expect(other.locator('[data-pilot-consent]')).toBeChecked();await page.locator('[data-pilot-consent]').uncheck();
  await expect(other.locator('[data-pilot-consent]')).not.toBeChecked();await expect(other.locator('[data-pilot-export]')).toBeDisabled();
  await signal(other,'launch-stopped');expect(await record(other)).toBeNull();
  expect((await pilotSnapshot(other)).grant).toBe('off');
  await other.reload();await expect(other.locator('[data-pilot-consent]')).not.toBeChecked();await other.close();
});

test('storage failure during enrollment leaves recording and export disabled',async({page})=>{
  await open(page);
  await failPilotStorage(page,'write');
  await page.locator('[data-pilot-role]').selectOption('community');await page.locator('[data-pilot-consent]').click();
  await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeDisabled();
  await expect(page.locator('[data-pilot-status]')).toContainText(/storage.*unavailable|not enabled/i);expect(await record(page)).toBeNull();
});

test('failed deletion stops open tabs and reports retained device data honestly',async({page,context})=>{
  await open(page);await enroll(page);const other=await context.newPage();await configure(other,failures.get(page));await open(other);
  const before=await record(page);
  // All durable writers are unavailable; a healthy peer may otherwise finish revocation.
  await Promise.all([page,other].map(tab=>failPilotStorage(tab,'write')));
  await page.locator('[data-pilot-clear]').click();
  await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeDisabled();
  await expect(page.locator('[data-pilot-status]')).toContainText(/could not be cleared|could not be removed/i);
  await expect(other.locator('[data-pilot-consent]')).not.toBeChecked();await expect(other.locator('[data-pilot-export]')).toBeDisabled();
  await signal(other,'launch-stopped');expect(await record(other)).toEqual(before);await other.close();
});

test('a failed event write stops recording and prevents stale export',async({page})=>{
  await open(page);await enroll(page);const before=await record(page);
  await failPilotStorage(page,'write');
  await signal(page,'launch-stopped');await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeDisabled();
  await expect(page.locator('[data-pilot-status]')).toContainText(/Recording.*stopped/i);expect(await record(page)).toEqual(before);
});

test('read-only network preserves a failed deletion warning for an existing device record',async({page})=>{
  await open(page);await enroll(page);const before=await record(page);
  // Keep the actual UI/controller while supplying a read-only mainnet build configuration.
  await page.route('**/app-config.js*',async route=>{
    const response=await route.fetch();let body=await response.text();
    for(const [name,value] of [['APP_CLUSTER',"'mainnet-beta'"],['EXPLORE_CLUSTER',"'mainnet-beta'"],['APP_ALLOW_MAINNET','true'],['APP_MAINNET_READ_ONLY','true']]){
      const declaration=new RegExp(`export const ${name} = [^;]+;`);
      expect(body).toMatch(declaration);body=body.replace(declaration,`export const ${name} = ${value};`);
    }
    await route.fulfill({response,body});
  });
  await page.reload();await expect(page.locator('[data-pilot-consent]')).toBeDisabled();
  await expect(page.locator('[data-pilot-status]')).toContainText('available only on Devnet');
  await expect(page.locator('[data-pilot-export]')).toBeEnabled();
  await signal(page,'launch-stopped');expect(await record(page)).toEqual(before);
  await failPilotStorage(page,'write');
  await page.locator('[data-pilot-clear]').click();
  await expect(page.locator('[data-pilot-status]')).toContainText('could not be cleared');
  await expect(page.locator('[data-pilot-status]')).toContainText('clear this site’s browser data');
  await expect(page.locator('[data-pilot-status]')).toContainText('available only on Devnet');
  await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();
  await expect(page.locator('[data-pilot-export]')).toBeDisabled();
  expect(await record(page)).toEqual(before);
});

test('parallel tabs retain distinct events in authoritative transactions',async({page,context})=>{
  await open(page);await enroll(page);const other=await context.newPage();await configure(other,failures.get(page));await open(other);
  const batches=[['launch-review-opened','launch-review-cancelled','launch-submission-started','launch-stopped','launch-registration-pending'],['claim-started','claim-pending','claim-stopped','claim-cancelled','launch-cancelled']];
  await Promise.all([page,other].map((tab,index)=>tab.evaluate(async names=>{
    for(const name of names)window.dispatchEvent(new CustomEvent('funded:pilot-event',{detail:{name}}));
  },batches[index])));
  await Promise.all([page,other].map(idlePilot));
  const value=await record(page);
  for(const name of batches.flat())expect(value.events.filter(event=>event.name===name)).toHaveLength(1);
  expect(await record(other)).toEqual(value);await other.close();
});

test('storage read failure prevents exporting stale in-memory data',async({page})=>{
  await open(page);await enroll(page);let downloads=0;page.on('download',()=>downloads++);
  await failPilotStorage(page,'read');
  await page.locator('[data-pilot-export]').click();
  await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeDisabled();
  await expect(page.locator('[data-pilot-status]')).toContainText(/Recording and export stopped/i);expect(downloads).toBe(0);
});

test('simultaneous enrollment creates one device record instead of overwriting another tab',async({page,context})=>{
  await open(page);const other=await context.newPage();await configure(other,failures.get(page));await open(other);
  await page.locator('[data-pilot-role]').selectOption('creator');await other.locator('[data-pilot-role]').selectOption('community');
  await Promise.all([page,other].map(tab=>tab.evaluate(()=>{
    window.pilotSeenIds=[];const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,...args){
      const request=put.call(this,value,...args);
      if(this.transaction.db.name==='funded-pilot-local'&&this.name==='state'&&value.record){
        const id=JSON.parse(value.record).participantId;this.transaction.addEventListener('complete',()=>window.pilotSeenIds.push(id),{once:true});
      }return request;
    };
  })));
  await holdPilotTransaction(page);
  try{await Promise.all([page,other].map(tab=>tab.locator('[data-pilot-consent]').click()));}
  finally{await releasePilotTransaction(page);}
  await Promise.all([page,other].map(idlePilot));
  await expect(page.locator('[data-pilot-consent]')).toBeChecked();await expect(other.locator('[data-pilot-consent]')).toBeChecked();
  const value=await record(page);expect(await record(other)).toEqual(value);
  const seen=await Promise.all([page,other].map(tab=>tab.evaluate(()=>window.pilotSeenIds)));
  expect(new Set([...seen.flat(),value.participantId]).size).toBe(1);
  await expect(page.locator('[data-pilot-role]')).toHaveValue(value.role);await expect(other.locator('[data-pilot-role]')).toHaveValue(value.role);
  const conflictingTab=value.role==='creator'?other:page;
  await expect(conflictingTab.locator('[data-pilot-status]')).toContainText('already has a different role');
  await other.close();
});
