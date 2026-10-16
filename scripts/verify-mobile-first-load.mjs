import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const width = Number(process.argv[2] || 390);
if (![320, 375, 390, 430].includes(width)) throw new Error('Use a supported mobile viewport width.');
const server = await preview({ configLoader:'runner',
  preview:{ host:'127.0.0.1', port:0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : { channel:'chrome' }),
  headless:true,
});
try {
  const context = await browser.newContext({ viewport:{ width, height:844 },
    deviceScaleFactor:1, isMobile:true, hasTouch:true });
  await context.route('**/api/**', route => route.fulfill({ status:503,
    contentType:'application/json', body:'{"error":"fixture"}' }));
  await context.route('**/api/fee-policy', route => route.fulfill({ status:200,
    contentType:'application/json',body:JSON.stringify({split:{operationsPercent:50,
      referralLevelPercents:[10,3,2],communityPercent:10,buybackPercent:25}}) }));
  await context.addInitScript(() => {
    window.__firstLoadShifts = [];
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__firstLoadShifts.push({ value:entry.value, time:entry.startTime,
          sources:entry.sources?.map(source => ({
            node:source.node?.id || source.node?.className || source.node?.tagName || '',
            previous:source.previousRect?.toJSON?.() || source.previousRect,
            current:source.currentRect?.toJSON?.() || source.currentRect,
          })) || [] });
      }
    }).observe({type:'layout-shift',buffered:true});
  });
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto(`${origin}/#overview`,{waitUntil:'domcontentloaded'});
  try { await page.locator('body.product-experience-ready').waitFor({timeout:15_000}); }
  catch { throw new Error(JSON.stringify({errors,body:await page.locator('body').getAttribute('class'),
    bootstrap:await page.locator('body').getAttribute('data-bootstrap-state'),
    message:await page.locator('[data-bootstrap-message]').textContent()})); }
  await page.waitForTimeout(1000);
  const result = await page.evaluate(() => ({
    shifts:window.__firstLoadShifts,
    state:document.body.dataset.bootstrapState,
    hero:document.querySelector('.hero-section')?.getBoundingClientRect().toJSON(),
  }));
  const score = result.shifts.reduce((sum,entry) => sum + entry.value, 0);
  console.log(JSON.stringify({width,score,...result}));
  assert.equal(result.state,'ready');
  assert.ok(score < 0.05, `Mobile first-load layout shift ${score.toFixed(3)} exceeds 0.05.`);
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
