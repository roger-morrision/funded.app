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
try{
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:900}});
    // Local HTTP/API responses remain real; remote assets and external account APIs are not needed for this flow.
    await context.route('https://**/*',route=>new URL(route.request().url()).origin===base.origin?route.fallback():route.abort());
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const response=await page.goto(new URL('/pilot',base).href,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);
    await page.locator('body.workspace-ready').waitFor({timeout:30000});
    await page.locator('#creator-pilot:not([hidden])').waitFor();
    assert.equal(await page.locator('#creator-pilot-metrics .pilot-panel').count(),1);
    assert.match(await page.locator('.creator-pilot-disclosure').innerText(),/test funds with no monetary value/);
    assert.equal(await page.locator('[data-pilot-consent]').isChecked(),false);
    assert.equal(await page.locator('[data-pilot-export]').isDisabled(),true);
    assert.equal(await page.evaluate(()=>localStorage.getItem('funded.vip.pilot.v1')),null);
    assert.equal(await page.locator('[data-pilot-incentive]').inputValue(),'unknown');
    assert.equal(await page.locator('[data-pilot-prompt]').inputValue(),'unknown');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(evidenceDir)await page.screenshot({path:join(evidenceDir,`pilot-${width}.png`),fullPage:true});
    await page.locator('[data-pilot-role]').selectOption('community');
    await page.locator('[data-pilot-source]').selectOption('test');
    await page.locator('[data-pilot-consent]').check();
    await page.waitForFunction(()=>!document.querySelector('[data-pilot-export]').disabled);
    await page.evaluate(async()=>{window.dispatchEvent(new CustomEvent('funded:pilot-event',{detail:{name:'launch-stopped',wallet:'QA-PRIVATE-CANARY'}}));if(navigator.locks)await navigator.locks.request('funded-pilot-record',()=>{});});
    const record=await page.evaluate(()=>JSON.parse(localStorage.getItem('funded.vip.pilot.v1')));
    assert.equal(record.source,'test');assert.equal(record.role,'community');assert(record.events.some(event=>event.name==='launch-stopped'));assert(!JSON.stringify(record).includes('QA-PRIVATE-CANARY'));
    await page.locator('[data-pilot-clear]').click();
    await page.waitForFunction(()=>document.querySelector('[data-pilot-export]').disabled);
    assert.equal(await page.evaluate(()=>localStorage.getItem('funded.vip.pilot.v1')),null);
    assert.deepEqual(errors,[]);
    checks.push({width,directPilotRoute:true,defaultOptOut:true,localRecordingAndDeletion:true,sensitiveDetailOmitted:true,noOverflow:true,uncaughtErrors:0});
    await context.close();
  }
}finally{await browser.close();}
const report={mode:'real local container app and API; remote browser hosts blocked; synthetic local pilot signals',build:identity.build,browserSourceDigest:settings.sourceDigest,cluster:settings.cluster,passed:checks.length,checks,xPublications:0,solanaTransactions:0};
if(evidenceDir)await writeFile(join(evidenceDir,'pilot-container-smoke.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
