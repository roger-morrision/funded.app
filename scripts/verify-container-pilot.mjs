import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const base=new URL(process.env.FUNDED_CONTAINER_BASE || '');
assert(['http:','https:'].includes(base.protocol) && ['127.0.0.1','localhost','[::1]'].includes(base.hostname) && !base.username && !base.password && base.pathname==='/' && !base.search && !base.hash,'Use an explicit loopback app origin.');
const expectedBuild=process.env.FUNDED_EXPECT_BUILD;
assert(expectedBuild,'FUNDED_EXPECT_BUILD is required to bind smoke evidence to the deployed build.');
const capabilities=await fetch(new URL('/api/capabilities',base));assert.equal(capabilities.status,200);
const identity=await capabilities.json();assert.equal(identity.build,expectedBuild);assert.equal(identity.cluster,'devnet');assert.equal(identity.sessions.storage,'postgresql');
const settingsResponse=await fetch(new URL('/build-settings.json',base));assert.equal(settingsResponse.status,200);
const settings=await settingsResponse.json();assert.equal(settings.cluster,'devnet');assert.equal(settings.mainnetEnabled,false);assert.equal(settings.devWalletEnabled,false);
const evidenceDir=process.env.FUNDED_PILOT_EVIDENCE_DIR;if(evidenceDir)await mkdir(evidenceDir,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const checks=[];
const idle=page=>page.waitForFunction(()=>document.querySelector('#pilot-local-panel')?.getAttribute('aria-busy')==='false');
async function snapshot(page){
  await idle(page);
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('funded-pilot-local',1);request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('state','readonly'),read=tx.objectStore('state').get('record-and-consent');let value;
      read.onsuccess=()=>{value=read.result;};tx.oncomplete=()=>{db.close();resolve({...value,record:value?.record?JSON.parse(value.record):null});};
      tx.onabort=()=>{db.close();reject(tx.error||new Error('Snapshot aborted'));};
    };
  }));
}
async function openPilot(page){
  const response=await page.goto(new URL('/pilot',base).href,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);
  await page.locator('body.workspace-ready').waitFor({timeout:30000});await idle(page);
}
async function contextFor(width=1440){
  const context=await browser.newContext({viewport:{width,height:900}});
  // Keep local app/API responses real; external hosts are unnecessary here.
  await context.route('https://**/*',route=>new URL(route.request().url()).origin===base.origin?route.fallback():route.abort());
  return context;
}
async function holdTransaction(page){
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('funded-pilot-local',1);request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('state','readwrite'),store=tx.objectStore('state');let release=false,ready=false;
      window.qaReleasePilotTransaction=()=>{release=true;};
      const pump=()=>{const read=store.get('record-and-consent');read.onsuccess=()=>{if(!ready){ready=true;resolve();}if(!release)pump();};};
      tx.oncomplete=()=>db.close();tx.onabort=()=>{db.close();reject(tx.error||new Error('Hold aborted'));};pump();
    };
  }));
}
try{
  for(const width of [1440,390]){
    const context=await contextFor(width);
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await openPilot(page);
    await page.locator('#creator-pilot:not([hidden])').waitFor();
    assert.equal(await page.locator('#creator-pilot-metrics .pilot-panel').count(),1);
    assert.match(await page.locator('.creator-pilot-disclosure').innerText(),/test funds with no monetary value/);
    assert.equal(await page.locator('[data-pilot-consent]').isChecked(),false);
    assert.equal(await page.locator('[data-pilot-export]').isDisabled(),true);
    assert.equal((await snapshot(page)).record,null);
    assert.equal(await page.locator('[data-pilot-incentive]').inputValue(),'unknown');
    assert.equal(await page.locator('[data-pilot-prompt]').inputValue(),'unknown');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(evidenceDir)await page.screenshot({path:join(evidenceDir,`pilot-${width}.png`),fullPage:true});
    await page.locator('[data-pilot-role]').selectOption('community');
    await page.locator('[data-pilot-source]').selectOption('test');
    await page.locator('[data-pilot-consent]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-pilot-export]').disabled);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('funded:pilot-event',{detail:{name:'launch-stopped',wallet:'QA-PRIVATE-CANARY'}})));
    const {record,grant}=await snapshot(page);assert.equal(grant,record.participantId);
    assert.equal(record.source,'test');assert.equal(record.role,'community');assert(record.events.some(event=>event.name==='launch-stopped'));assert(!JSON.stringify(record).includes('QA-PRIVATE-CANARY'));
    await page.locator('[data-pilot-clear]').click();
    await page.waitForFunction(()=>document.querySelector('[data-pilot-export]').disabled);
    assert.equal((await snapshot(page)).record,null);
    assert.equal((await snapshot(page)).grant,'off');
    assert.deepEqual(errors,[]);
    checks.push({width,directPilotRoute:true,defaultOptOut:true,localRecordingAndDeletion:true,sensitiveDetailOmitted:true,noOverflow:true,uncaughtErrors:0});
    await context.close();
  }
  {
    const context=await contextFor();const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const legacy={version:2,participantId:'11111111-2222-4333-8444-555555555555',consented:true,cluster:'devnet',role:'creator',source:'test',startedAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-03T00:00:00.000Z',observedThrough:'2026-10-03T00:00:00.000Z',coverageEndedAt:'2026-10-03T00:00:00.000Z',events:[{name:'pilot-enrolled',at:'2026-10-01T00:00:00.000Z',incentive:'none',prompt:'voluntary'}]};
    await page.addInitScript(record=>{if(!sessionStorage.getItem('qa-seeded')){localStorage.setItem('funded.vip.pilot.v1',JSON.stringify(record));localStorage.setItem('funded.vip.pilot.consent.v2',record.participantId);sessionStorage.setItem('qa-seeded','1');}},legacy);
    await openPilot(page);assert.deepEqual((await snapshot(page)).record,legacy);assert.equal((await snapshot(page)).grant,legacy.participantId);
    assert.equal(await page.evaluate(()=>localStorage.getItem('funded.vip.pilot.v1')),null);
    await page.locator('[data-pilot-clear]').click();await idle(page);assert.equal((await snapshot(page)).record,null);
    await page.evaluate(record=>{localStorage.setItem('funded.vip.pilot.v1',JSON.stringify(record));localStorage.setItem('funded.vip.pilot.consent.v2',record.participantId);},legacy);
    await page.reload();await idle(page);assert.equal((await snapshot(page)).record,null);assert.equal((await snapshot(page)).grant,'off');
    assert.equal(await page.locator('[data-pilot-consent]').isChecked(),false);assert.deepEqual(errors,[]);
    checks.push({case:'legacy migration and durable deletion tombstone',identityAndHistoryPreserved:true,staleLegacyCannotResurrect:true,uncaughtErrors:0});await context.close();
  }
  {
    const context=await contextFor();const pages=await Promise.all([context.newPage(),context.newPage()]),errors=[];
    for(const page of pages)page.on('pageerror',error=>errors.push(error.message));
    await Promise.all(pages.map(openPilot));await pages[0].locator('[data-pilot-role]').selectOption('creator');await pages[1].locator('[data-pilot-role]').selectOption('community');
    await holdTransaction(pages[0]);
    try{await Promise.all(pages.map(page=>page.locator('[data-pilot-consent]').click()));}
    finally{await pages[0].evaluate(()=>window.qaReleasePilotTransaction());}
    await Promise.all(pages.map(page=>page.waitForFunction(()=>document.querySelector('[data-pilot-consent]').checked&&!document.querySelector('[data-pilot-export]').disabled)));
    const [first,second]=await Promise.all(pages.map(snapshot));assert.deepEqual(first,second);assert.equal(first.grant,first.record.participantId);
    for(const page of pages)assert.equal(await page.locator('[data-pilot-role]').inputValue(),first.record.role);
    const loser=first.record.role==='creator'?pages[1]:pages[0];assert.match(await loser.locator('[data-pilot-status]').innerText(),/already has a different role/);
    await pages[0].locator('[data-pilot-clear]').click();await pages[1].waitForFunction(()=>!document.querySelector('[data-pilot-consent]').checked&&document.querySelector('[data-pilot-export]').disabled);
    for(const page of pages){const saved=await snapshot(page);assert.equal(saved.record,null);assert.equal(saved.grant,'off');}
    assert.deepEqual(errors,[]);checks.push({case:'native simultaneous enrollment and cross-tab revocation',singleCommittedIdentity:true,conflictExplained:true,bothTabsRevoked:true,uncaughtErrors:0});await context.close();
  }
}finally{await browser.close();}
const report={mode:'real local container app and API; remote browser hosts blocked; synthetic local pilot signals',build:identity.build,browserSourceDigest:settings.sourceDigest,cluster:settings.cluster,passed:checks.length,checks,xPublications:0,solanaTransactions:0};
if(evidenceDir)await writeFile(join(evidenceDir,'pilot-container-smoke.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
