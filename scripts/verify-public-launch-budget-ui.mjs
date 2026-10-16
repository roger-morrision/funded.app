import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const moduleBundle = await build({ configFile:false, build:{ write:false,
  lib:{ entry:'src/features/launch/cost-view.js', name:'PublicCostView', formats:['iife'] } } });
const server = await preview({ configLoader:'runner', preview:{ host:'127.0.0.1', port:0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : { channel:'chrome' }),
  headless:true,
});
try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 } });
  await context.route('**/api/**', route => route.fulfill({ status:503,
    contentType:'application/json', body:'{"error":"Read-only fixture"}' }));
  await context.route('**/api/fee-policy', route => route.fulfill({ status:200,
    contentType:'application/json', body:JSON.stringify({split:{operationsPercent:50,
      referralLevelPercents:[10,3,2],communityPercent:10,buybackPercent:25}}) }));
  const page = await context.newPage();
  await page.goto(`${origin}#launch`, { waitUntil:'domcontentloaded' });
  await page.locator('body.product-experience-ready').waitFor({ timeout:20_000 });
  await page.addScriptTag({ content:moduleBundle[0].output[0].code });
  for (const width of [390,1280]) {
    await page.setViewportSize({ width, height:844 });
    const result = await page.evaluate(() => {
      const { updateCostSummary, renderLaunchCostDetails } = window.PublicCostView;
      const publicQuote = { status:'ready', solAmountLamports:840_000_000n,
        maxSolAmountLamports:850_000_000n, developerTokens:0 };
      const formatLaunchCost = lamports => `${(Number(lamports)/1e9).toFixed(6)} SOL`;
      updateCostSummary({ wallet:null, estimatedLaunchFeeLamports:null, publicQuote }, {
        document, formatLaunchCost,
        renderLaunchCostDetails:() => renderLaunchCostDetails({wallet:null,publicQuote},
          {document,formatLaunchCost}),
        getLaunchBurnPolicy:() => ({requiresBurn:false}),
        getCreatorBuySummary:() => ({sol:0,tokens:0}),
        getCommunityAirdropTokens:() => 30_000_000,
        getCommunityAllocationPercent:() => 3,
        formatLaunchBurnAmount:String,
        creatorBuyExceedsWalletBalance:() => false,
        developerBuyLimitReached:() => false,
      });
      return {
        wallet:document.documentElement.dataset.connectedWallet || '',
        total:document.querySelector('#cost-total-enabled').textContent,
        purchase:document.querySelector('#cost-initial-buy').textContent,
        overhead:document.querySelector('#cost-launch').textContent,
        mobile:document.querySelector('#launch-mobile-budget-value').textContent,
        details:document.querySelector('#launch-cost-details').textContent,
        visible:getComputedStyle(document.querySelector('#launch-cost-details')).display !== 'none',
      };
    });
    assert.equal(result.wallet,'');
    assert.equal(result.total,'0.900000 SOL');
    assert.equal(result.purchase,'0.850000 SOL');
    assert.match(result.overhead,/0\.050000 SOL planning allowance/);
    assert.equal(result.mobile,'0.900000 SOL');
    assert.equal(result.visible,true);
    assert.match(result.details,/Purchase allowance \(1%\)/);
    assert.match(result.details,/Network fees \+ account rent planning allowance/);
    console.log(`${width}px unsigned launch budget: ${result.total}, breakdown visible`);
  }
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
