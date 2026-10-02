import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildTradePricePath } from '../coin-detail-model.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const functions=['formatUsd','formatCoinUsd','formatCoinSnapshotUsd','renderCoinSnapshotUsd','renderCoinPricePath'].map(name=>source.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\r?\\n\\}`))[0]).join('\n');
const activity={decimals:6,coverage:'complete',trades:[{priceRatio:2,blockTime:20},{priceRatio:1,blockTime:10}]};
const path=buildTradePricePath(activity.trades,6);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const context=await browser.newContext();
  await context.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await context.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"USD UI fixture: API unavailable"}'}));
  const page=await context.newPage();
  await page.goto('http://127.0.0.1:5173/#explore');await page.waitForSelector('body.workspace-ready');
  await page.locator('#explore-filter-toggle').click();
  assert.match(await page.locator('#explore-min-volume-label').textContent(),/USD/);
  assert.match(await page.locator('#explore-min-cap-sol').locator('..').textContent(),/MC · USD/);
  for(const width of [390,1440]) {
    await page.setViewportSize({width,height:900});
    for(const quote of [100,null]) {
      const output=await page.evaluate(({functions,activity,path,quote})=>{
        const host=document.createElement('div');host.innerHTML='<strong id="usd-fixture"></strong><strong id="coin-snapshot-spot-usd"></strong><strong id="coin-snapshot-reserve-usd"></strong><strong id="coin-snapshot-quote-usd"></strong><small id="coin-snapshot-usd-rate"></small>';
        const panel=document.querySelector('#coin-price-path');
        document.body.append(host);
        const setCoinField=(selector,value)=>host.querySelector(selector).textContent=value;
        new Function('coinSolUsdPrice','coinSolUsdValues','coinMarketActivity','buildTradePricePath','setCoinField','escapeHtml','coinChartMetric','coinChartUnit','coinChartView',functions+';renderCoinSnapshotUsd();renderCoinPricePath();')(quote,{marketCap:2,reserve:0.5,virtualQuote:3,supply:1000},activity,()=>path,setCoinField,String,'mcap','usd','snapshot');
        const result={mc:host.querySelector('#coin-snapshot-spot-usd').textContent,reserve:host.querySelector('#coin-snapshot-reserve-usd').textContent,chart:panel.textContent};host.remove();return result;
      },{functions,activity,path,quote});
      assert.equal(output.mc,quote?'$200':'$—');assert.equal(output.reserve,quote?'$50':'$—');
      assert.match(output.chart,quote?/Estimated market cap · USD.*\$200/s:/MC in USD unavailable/);
    }
  }
  console.log('USD browser checks passed: dollar filters, rendered MC/reserve values, MC chart and missing-quote states at mobile and desktop widths (mocked data; no signing).');
} finally {await browser.close();}
