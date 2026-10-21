import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';

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
    contentType:'application/json', body:JSON.stringify({split:PROTOCOL_FEE_SPLIT}) }));
  const page = await context.newPage();
  await page.goto(`${origin}#launch`, { waitUntil:'domcontentloaded' });
  await page.locator('body.product-experience-ready').waitFor({ timeout:20_000 });
  await page.addScriptTag({ content:moduleBundle[0].output[0].code });
  for (const width of [390,1440]) {
    await page.setViewportSize({ width, height:844 });
    for (const variant of [
      { fee:'20000000', status:'ready', purchase:'840000000', maximum:'850000000', total:'0.920000 SOL', row:'0.020000 SOL' },
      { fee:'35000000', status:'ready', purchase:'840000000', maximum:'850000000', total:'0.935000 SOL', row:'0.035000 SOL' },
      { fee:'0', status:'ready', purchase:'840000000', maximum:'850000000', total:'0.900000 SOL', row:'0.000000 SOL' },
      { fee:'20000000', status:'ready', purchase:'1340000000', maximum:'1350000000', total:'1.420000 SOL', row:'0.020000 SOL' },
      { fee:null, status:'ready', purchase:'840000000', maximum:'850000000', total:'Fee policy unavailable', row:'Unavailable' },
      { fee:'20000000', status:'unavailable', total:'Quote unavailable', row:'0.020000 SOL' },
      { fee:'20000000', status:'invalid', total:'Enter valid amounts', row:'0.020000 SOL' },
      { fee:'20000000', status:'loading', total:'Calculating…', row:'0.020000 SOL' },
    ]) {
    const result = await page.evaluate(({ fee, status, purchase, maximum }) => {
      const { updateCostSummary, renderLaunchCostDetails } = window.PublicCostView;
      const publicQuote = { status, solAmountLamports:purchase, maxSolAmountLamports:maximum, developerTokens:0 };
      const formatLaunchCost = lamports => `${(Number(lamports)/1e9).toFixed(6)} SOL`;
      updateCostSummary({ wallet:null, estimatedLaunchFeeLamports:null, publicQuote }, {
        document, formatLaunchCost,
        renderLaunchCostDetails:() => renderLaunchCostDetails({wallet:null,publicQuote},
          {document,formatLaunchCost,getLaunchFeeLamports:() => fee}),
        getLaunchFeeLamports:() => fee,
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
        preview:document.querySelector('#preview-launch-cost').textContent,
        label:document.querySelector('#cost-tier-label').textContent,
        purchase:document.querySelector('#cost-initial-buy').textContent,
        overhead:document.querySelector('#cost-launch').textContent,
        serviceFee:document.querySelector('#cost-service-fee').textContent,
        mobile:document.querySelector('#launch-mobile-budget-value').textContent,
        details:document.querySelector('#launch-cost-details').textContent,
        visible:getComputedStyle(document.querySelector('#launch-cost-details')).display !== 'none',
        pageOverflow:document.documentElement.scrollWidth > innerWidth,
        detailLayout:[...document.querySelectorAll('#launch-cost-details dl > div')].map(row => {
          const label = row.querySelector('dt').getBoundingClientRect();
          const amount = row.querySelector('dd').getBoundingClientRect();
          const bounds = row.getBoundingClientRect();
          return { labelWidth:label.width, labelHeight:label.height, amountBelowLabel:amount.top >= label.bottom - 1,
            withinRow:label.left >= bounds.left - 1 && label.right <= bounds.right + 1
              && amount.left >= bounds.left - 1 && amount.right <= bounds.right + 1 };
        }),
      };
    }, variant);
    assert.equal(result.wallet,'');
    assert.equal(result.total,variant.total);
    assert.equal(result.preview,variant.total);
    assert.equal(result.mobile,variant.total);
    assert.equal(result.serviceFee,variant.row);
    assert.equal(result.pageOverflow,false);
    if (variant.status === 'ready' && variant.fee !== null) {
      assert.equal(result.purchase,`${(Number(variant.maximum)/1e9).toFixed(6)} SOL`);
      assert.match(result.overhead,/0\.050000 SOL planning allowance/);
      assert.equal(result.label,`Launch service fee: ${Number(variant.fee)/1e9} SOL`);
      assert.equal(result.visible,true);
      assert.equal(result.detailLayout.length,5);
      assert.ok(result.detailLayout.every(item => item.labelWidth >= 80 && item.labelHeight <= 70
        && item.amountBelowLabel && item.withinRow), 'Every cost label and amount must stay readable without overlap.');
      assert.match(result.details,/Purchase allowance \(1%\)/);
      assert.match(result.details,new RegExp(`App launch service fee\\s*${variant.row.replace('.', '\\.')}`));
      assert.match(result.details,/Network fees \+ account rent planning allowance/);
      assert.match(result.details,new RegExp(`Estimated total SOL budget\\s*${variant.total.replace('.', '\\.')}`));
    } else {
      assert.equal(result.visible,true);
      assert.match(result.details,/Review launch costs/);
      assert.match(result.details,/complete planning budget needs/);
      assert.doesNotMatch(result.details,/Estimated total SOL budget/);
    }
    if (process.env.FUNDED_BUDGET_SCREENSHOT_DIR && variant.status === 'ready'
      && variant.fee === '20000000' && variant.purchase === '840000000') {
      await page.screenshot({ path:`${process.env.FUNDED_BUDGET_SCREENSHOT_DIR}/local-${width}.png`, fullPage:true });
    }
    console.log(`${width}px ${variant.status}/${variant.fee ?? 'no policy'}: ${result.total}`);
    }
    const connectedLayout = await page.evaluate(() => {
      const now = Date.now();
      window.PublicCostView.renderLaunchCostDetails({
        wallet:{ publicKey:'fixture-only' },
        launchCostReview:{ budget:'935000000', balanceAfterBudget:'1000000000',
          buyQuote:'840000000', allowance:'10000000', serviceFeeLamports:'35000000',
          otherLaunchCosts:'45000000', networkFee:'5000000', transactionCount:2,
          messageCount:2, curvePremiumBps:0, quotedAt:now, expiresAt:now+60000 },
      }, { document, formatLaunchCost:value => `${(Number(value)/1e9).toFixed(6)} SOL` });
      const details = document.querySelector('#launch-cost-details details');
      details.open = true;
      return [...details.querySelectorAll('.launch-review-costs dl > div')].map(row => {
        const label = row.querySelector('dt').getBoundingClientRect();
        const amount = row.querySelector('dd').getBoundingClientRect();
        const bounds = row.getBoundingClientRect();
        return { labelWidth:label.width, labelHeight:label.height,
          amountBelowLabel:amount.top >= label.bottom - 1,
          withinRow:label.left >= bounds.left - 1 && label.right <= bounds.right + 1
            && amount.left >= bounds.left - 1 && amount.right <= bounds.right + 1 };
      });
    });
    assert.equal(connectedLayout.length,5);
    assert.ok(connectedLayout.every(item => item.labelWidth >= 80 && item.labelHeight <= 70
      && item.amountBelowLabel && item.withinRow), 'Connected cost labels and amounts must stay readable without overlap.');
    console.log(`${width}px connected advanced cost breakdown: readable`);
  }
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
