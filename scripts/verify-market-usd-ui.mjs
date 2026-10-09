import { readAppSource } from './read-app-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { formatUsd } from '../src/features/shared/display.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source=await readAppSource();
const functions=[formatUsd.toString(), ...['formatCoinUsd','formatCoinSnapshotUsd','renderCoinSnapshotUsd'].map(name=>source.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\r?\\n\\}`))[0])].join('\n');
const now=Math.floor(Date.now()/1000);
const activity={status:'ready',decimals:6,coverage:'complete',trades:[{priceRatio:2,blockTime:now-10},{priceRatio:1,blockTime:now-20}]};
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
      const output=await page.evaluate(async ({functions,activity,quote})=>{
        const {renderCoinPricePath}=await import('/src/features/coin/chart-view.js');
        const host=document.createElement('div');host.innerHTML='<strong id="usd-fixture"></strong><strong id="coin-snapshot-spot-usd"></strong><strong id="coin-snapshot-reserve-usd"></strong><strong id="coin-snapshot-quote-usd"></strong><small id="coin-snapshot-usd-rate"></small>';
        const panel=document.querySelector('#coin-price-path');
        document.body.append(host);
        const setCoinField=(selector,value)=>host.querySelector(selector).textContent=value;
        const values={marketCap:2,reserve:0.5,virtualQuote:3,supply:1000};
        const formatSnapshot=new Function('coinSolUsdPrice','coinSolUsdValues','setCoinField',functions+';renderCoinSnapshotUsd();return formatCoinSnapshotUsd;')(quote,values,setCoinField);
        renderCoinPricePath({coinSolUsdPrice:quote,coinSolUsdValues:values,coinMarketActivity:activity,coinChartPeriod:'24h',coinChartMetric:'mcap',coinChartUnit:'usd'}, {formatCoinSnapshotUsd:formatSnapshot});
        const result={mc:host.querySelector('#coin-snapshot-spot-usd').textContent,reserve:host.querySelector('#coin-snapshot-reserve-usd').textContent,chart:panel.textContent};host.remove();return result;
      },{functions,activity,quote});
      assert.equal(output.mc,quote?'$200':'$—');assert.equal(output.reserve,quote?'$50':'$—');
      assert.match(output.chart,quote?/Estimated market cap · USD.*\$200/s:/Market cap in USD unavailable/);
    }
  }
  console.log('USD browser checks passed: dollar filters, rendered MC/reserve values, MC chart and missing-quote states at mobile and desktop widths (mocked data; no signing).');
} finally {await browser.close();}
