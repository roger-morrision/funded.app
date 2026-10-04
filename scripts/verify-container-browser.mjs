import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const base = new URL(process.env.FUNDED_CONTAINER_BASE || '');
assert.ok(['http:', 'https:'].includes(base.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash, 'Use an explicit disposable loopback container origin.');
const evidenceDir = process.env.FUNDED_CONTAINER_BROWSER_EVIDENCE_DIR;
if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
const browser=await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),headless:true});
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
}finally{await browser.close()}
console.log(JSON.stringify({mode:'real local container browser; no request interception',passed:results.length,interceptedRequests:0,checks:results},null,2));
