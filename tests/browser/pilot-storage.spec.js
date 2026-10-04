import {test,expect} from '@playwright/test';
import {pilotSnapshot,pilotRecord,idlePilot,failPilotStorage,restorePilotStorage,holdPilotTransaction,releasePilotTransaction,LEGACY_RECORD,LEGACY_GRANT} from './helpers/pilot-storage.js';

const legacy={version:2,participantId:'11111111-2222-4333-8444-555555555555',consented:true,cluster:'devnet',role:'creator',source:'organic',startedAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-03T00:00:00.000Z',observedThrough:'2026-10-03T00:00:00.000Z',coverageEndedAt:'2026-10-03T00:00:00.000Z',events:[{name:'pilot-enrolled',at:'2026-10-01T00:00:00.000Z',incentive:'none',prompt:'voluntary'}]};
const failures=new WeakMap();
test.beforeEach(async({page})=>{
  const errors=[];failures.set(page,errors);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await page.route('https://**/*',route=>route.abort());
});
test.afterEach(async({page})=>expect(failures.get(page),'No uncaught browser errors').toEqual([]));
async function open(page){await page.goto('/#pilot');await expect(page.locator('body')).toHaveClass(/workspace-ready/);await idlePilot(page);}
async function enroll(page){await page.locator('[data-pilot-role]').selectOption('community');await page.locator('[data-pilot-source]').selectOption('test');await page.locator('[data-pilot-consent]').click();await expect(page.locator('[data-pilot-export]')).toBeEnabled();}
async function seedLegacy(page,grant=legacy.participantId){await page.addInitScript(({record,grant})=>{if(!sessionStorage.getItem('qa-pilot-seeded')){localStorage.setItem('funded.vip.pilot.v1',JSON.stringify(record));localStorage.setItem('funded.vip.pilot.consent.v2',grant);sessionStorage.setItem('qa-pilot-seeded','1');}},{record:legacy,grant});}

test('legacy migration preserves identity, immutable context, timestamps and bounded coverage across reload',async({page})=>{
  await seedLegacy(page);await open(page);await expect(page.locator('[data-pilot-consent]')).toBeChecked();
  expect(await pilotRecord(page)).toEqual(legacy);expect((await pilotSnapshot(page)).grant).toBe(legacy.participantId);
  expect(await page.evaluate(key=>localStorage.getItem(key),LEGACY_RECORD)).toBeNull();
  expect(await page.evaluate(key=>localStorage.getItem(key),LEGACY_GRANT)).toBe('off');
  await page.reload();await idlePilot(page);expect(await pilotRecord(page)).toEqual(legacy);
});

test('explicit legacy revocation cannot become consent during migration or a later reload',async({page})=>{
  await seedLegacy(page,'off');await open(page);await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();
  await expect(page.locator('[data-pilot-export]')).toBeDisabled();expect((await pilotSnapshot(page)).grant).toBe('off');
  await page.evaluate(({record,grant})=>{localStorage.setItem('funded.vip.pilot.v1',JSON.stringify(record));localStorage.setItem('funded.vip.pilot.consent.v2',grant);},{record:legacy,grant:legacy.participantId});
  await page.reload();await idlePilot(page);await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();expect((await pilotSnapshot(page)).grant).toBe('off');
});

test('deletion tombstone prevents stale legacy records from resurrecting after restart',async({page})=>{
  await open(page);await enroll(page);await page.locator('[data-pilot-clear]').click();await idlePilot(page);
  expect(await pilotRecord(page)).toBeNull();expect((await pilotSnapshot(page)).grant).toBe('off');
  await page.evaluate(record=>{localStorage.setItem('funded.vip.pilot.v1',JSON.stringify(record));localStorage.setItem('funded.vip.pilot.consent.v2',record.participantId);},legacy);
  await page.reload();await idlePilot(page);expect(await pilotRecord(page)).toBeNull();
  await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeDisabled();
});

test('pending enrollment exposes no successful consent or export until its transaction commits',async({page})=>{
  await open(page);await page.locator('[data-pilot-role]').selectOption('creator');await holdPilotTransaction(page);
  try{
    await page.locator('[data-pilot-consent]').click();await expect(page.locator('#pilot-local-panel')).toHaveAttribute('aria-busy','true');
    await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeDisabled();
    await expect(page.locator('[data-pilot-status]')).not.toContainText('Local recording on');
  }finally{await releasePilotTransaction(page);}
  await expect(page.locator('[data-pilot-consent]')).toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeEnabled();
  expect((await pilotSnapshot(page)).grant).toBe((await pilotRecord(page)).participantId);
});

test('aborted enrollment never commits partial record or consent and leaves the UI off',async({page})=>{
  await open(page);const before=await pilotSnapshot(page);await failPilotStorage(page,'abort');
  await page.locator('[data-pilot-role]').selectOption('creator');await page.locator('[data-pilot-consent]').click();await idlePilot(page);
  await expect(page.locator('[data-pilot-status]')).toContainText(/storage.*unavailable|not enabled|stopped/i);
  await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeDisabled();
  expect(await pilotSnapshot(page)).toEqual(before);await restorePilotStorage(page);
  await page.reload();await idlePilot(page);expect(await pilotRecord(page)).toBeNull();
});

test('export waits for durable commit and aborting it produces no download',async({page})=>{
  await open(page);await enroll(page);const before=await pilotRecord(page);let downloads=0;page.on('download',()=>downloads++);
  await failPilotStorage(page,'abort');await page.locator('[data-pilot-export]').click();await idlePilot(page);
  await expect(page.locator('[data-pilot-status]')).toContainText(/storage.*unavailable|stopped/i);
  await expect(page.locator('[data-pilot-export]')).toBeDisabled();expect(downloads).toBe(0);expect(await pilotRecord(page)).toEqual(before);
});

test('unavailable IndexedDB fails closed without a localStorage recording fallback',async({page})=>{
  await page.addInitScript(()=>{const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(name,...args){if(name==='funded-pilot-local')throw new DOMException('Storage blocked','SecurityError');return open.call(this,name,...args);};});
  await open(page);await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeDisabled();
  await expect(page.locator('[data-pilot-status]')).toContainText(/storage.*unavailable|stopped/i);
  expect(await page.evaluate(key=>localStorage.getItem(key),LEGACY_RECORD)).toBeNull();
});

test('migration read failure preserves legacy data instead of cleaning up an uncommitted record',async({page})=>{
  await seedLegacy(page);
  await page.addInitScript(()=>{const get=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(...args){if(this.transaction.db.name==='funded-pilot-local')throw new DOMException('Read unavailable','SecurityError');return get.apply(this,args);};});
  await open(page);await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeDisabled();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),LEGACY_RECORD)).toEqual(legacy);
  expect(await page.evaluate(key=>localStorage.getItem(key),LEGACY_GRANT)).toBe(legacy.participantId);
});

test('database version change stops the old connection without changing the durable record',async({page})=>{
  await open(page);await enroll(page);const before=await pilotRecord(page);
  await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('funded-pilot-local',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{request.result.close();resolve();};}));
  await page.locator('[data-pilot-export]').click();await idlePilot(page);
  await expect(page.locator('[data-pilot-status]')).toContainText(/storage.*unavailable|stopped/i);await expect(page.locator('[data-pilot-export]')).toBeDisabled();
  const persisted=await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('funded-pilot-local',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('state','readonly'),read=tx.objectStore('state').get('record-and-consent');read.onsuccess=()=>resolve(JSON.parse(read.result.record));tx.oncomplete=()=>db.close();};}));
  expect(persisted).toEqual(before);
});

test('missing cross-tab notifications cannot let an old page re-enable revoked consent',async({page,context})=>{
  await context.addInitScript(()=>{
    window.BroadcastChannel=class{constructor(){throw new DOMException('Unavailable','NotSupportedError');}};
    const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,...args){if(key==='funded.pilot.storage-signal.v3')return;return set.call(this,key,...args);};
  });
  await open(page);const other=await context.newPage();other.on('pageerror',error=>failures.get(page).push(error.message));
  await other.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));await other.route('https://**/*',route=>route.abort());
  await open(other);await other.locator('[data-pilot-role]').selectOption('creator');
  await enroll(page);await page.locator('[data-pilot-clear]').click();await idlePilot(page);const revoked=await pilotSnapshot(page);
  await other.locator('[data-pilot-consent]').click();await idlePilot(other);
  await expect(other.locator('[data-pilot-consent]')).not.toBeChecked();await expect(other.locator('[data-pilot-export]')).toBeDisabled();
  await expect(other.locator('[data-pilot-status]')).toContainText(/consent.*changed|reload|revoked/i);
  expect(await pilotSnapshot(other)).toEqual(revoked);expect(await pilotRecord(other)).toBeNull();await other.close();
});

test('cross-tab revocation still works through the invalidation signal without BroadcastChannel',async({page,context})=>{
  await context.addInitScript(()=>{window.BroadcastChannel=class{constructor(){throw new DOMException('Unavailable','NotSupportedError');}};});
  await open(page);await enroll(page);const other=await context.newPage();other.on('pageerror',error=>failures.get(page).push(error.message));
  await other.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));await other.route('https://**/*',route=>route.abort());
  await open(other);await expect(other.locator('[data-pilot-consent]')).toBeChecked();
  await page.locator('[data-pilot-clear]').click();await idlePilot(page);
  await expect(other.locator('[data-pilot-consent]')).not.toBeChecked();await expect(other.locator('[data-pilot-export]')).toBeDisabled();
  expect(await pilotRecord(other)).toBeNull();expect((await pilotSnapshot(other)).grant).toBe('off');await other.close();
});

test('failed legacy cleanup is reported and cannot undo an authoritative deletion tombstone',async({page})=>{
  await seedLegacy(page);
  await page.addInitScript(()=>{
    for(const method of ['setItem','removeItem']){const original=Storage.prototype[method];Storage.prototype[method]=function(key,...args){if(key.startsWith('funded.vip.pilot.')&&sessionStorage.getItem('qa-pilot-seeded'))throw new DOMException('Legacy data retained','SecurityError');return original.call(this,key,...args);};}
  });
  await open(page);expect((await pilotRecord(page)).participantId).toBe(legacy.participantId);
  await page.locator('[data-pilot-clear]').click();await idlePilot(page);
  await expect(page.locator('[data-pilot-status]')).toContainText(/could not be cleared|browser data|legacy.*unavailable/i);
  await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();expect(await pilotRecord(page)).toBeNull();expect((await pilotSnapshot(page)).grant).toBe('off');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),LEGACY_RECORD)).toEqual(legacy);
  await page.reload();await idlePilot(page);await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();expect(await pilotRecord(page)).toBeNull();
});

test('events captured before consent or for an old participant cannot enter a new enrollment',async({page})=>{
  await open(page);await page.locator('[data-pilot-role]').selectOption('creator');await holdPilotTransaction(page);
  try{
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('funded:pilot-event',{detail:{name:'launch-stopped'}})));
    await page.locator('[data-pilot-consent]').click();
  }finally{await releasePilotTransaction(page);}
  await expect(page.locator('[data-pilot-export]')).toBeEnabled();await idlePilot(page);
  const first=await pilotRecord(page);expect(first.events.some(event=>event.name==='launch-stopped')).toBe(false);
  await holdPilotTransaction(page);
  try{
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('funded:pilot-event',{detail:{name:'claim-verified'}})));
    await page.locator('[data-pilot-clear]').click();
    await expect(page.locator('[data-pilot-consent]')).not.toBeChecked();await expect(page.locator('[data-pilot-export]')).toBeDisabled();
  }finally{await releasePilotTransaction(page);}
  await idlePilot(page);expect(await pilotRecord(page)).toBeNull();
  await enroll(page);const next=await pilotRecord(page);expect(next.participantId).not.toBe(first.participantId);
  expect(next.events.some(event=>['claim-verified','launch-stopped'].includes(event.name))).toBe(false);
});
