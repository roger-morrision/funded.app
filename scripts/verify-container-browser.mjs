import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyContainerBuildIdentity(baseValue, expectedBuild) {
 const base = new URL(baseValue || '');
 assert.ok(['http:', 'https:'].includes(base.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash, 'Use an explicit disposable loopback container origin.');
 assert.match(expectedBuild || '', /^[a-f0-9]{40}$/, 'Set FUNDED_EXPECT_BUILD to the full source commit SHA.');
 const response = await fetch(new URL('/api/capabilities', base), { redirect: 'error', signal: AbortSignal.timeout(15_000) });
 assert.equal(response.status, 200, 'Build identity endpoint must return HTTP 200.');
 const capabilities = await response.json();
 assert.equal(capabilities?.build, expectedBuild, 'Container build must match FUNDED_EXPECT_BUILD.');
 assert.equal(capabilities?.cluster, 'devnet', 'Container browser verification requires Devnet.');
 return { base: base.origin, expectedBuild, observedBuild: capabilities.build };
}

export async function verifyContainerBrowser({ env = process.env, launchBrowser = options => chromium.launch(options) } = {}) {
 const identity = await verifyContainerBuildIdentity(env.FUNDED_CONTAINER_BASE, env.FUNDED_EXPECT_BUILD);
const base = new URL(identity.base);
const evidenceDir = env.FUNDED_CONTAINER_BROWSER_EVIDENCE_DIR;
if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
const browser=await launchBrowser({ ...(env.CHROMIUM_PATH ? { executablePath: env.CHROMIUM_PATH } : {}),headless:true});
const results=[];
try {
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900}});
  for(const route of ['/#explore','/#launch','/#docs']){
   const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
   const response=await page.goto(new URL(route, base).href,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);
   await page.locator('body.workspace-ready').waitFor({timeout:30000});
   if(route==='/#docs'){
    await page.getByRole('button',{name:'Check service status'}).click();
    await page.locator('#service-status[aria-busy="false"]').waitFor();
    const report=await page.locator('#service-status').innerText();assert.match(report,/Saved records/);assert.match(report,/Available/);
   }
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
   assert.deepEqual(errors,[]);results.push({route,width,status:response.status(),workspaceReady:true,uncaughtErrors:0,overflow});
   if(evidenceDir && route==='/#explore')await page.screenshot({path:join(evidenceDir, `real-container-explore-${width}.png`),fullPage:false});
   await page.close();
  }
  await context.close();
 }
 await verifyContainerBuildIdentity(identity.base, identity.expectedBuild);
}finally{await browser.close()}
return {mode:'real local container browser; no request interception',...identity,identityCheckedBeforeAndAfter:true,identityScope:'API build observed before and after browser checks; asset bytes require the separate image/source-digest verification',passed:results.length,interceptedRequests:0,checks:results};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 console.log(JSON.stringify(await verifyContainerBrowser(), null, 2));
}
