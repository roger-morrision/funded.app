import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

for(const width of [1280,390])test(`metric labels, missing values and stale holder counts at ${width}px`,async()=>{
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage({viewport:{width,height:850}});
    await page.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/')return route.fulfill({contentType:'text/html',body:`<main id="main-content"><div><span id="coin-market-cap-label">Market cap</span><strong id="coin-market-cap"></strong></div><div><span>Market cap</span><strong id="coin-strip-market-cap"></strong></div><div><span>Holders</span><strong id="coin-holder-count"></strong></div><strong id="coin-strip-trades"></strong><div id="coin-strip-burn-cell"><span>Burned</span><strong id="coin-strip-burned"></strong></div></main>`});
      return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('..'+path,import.meta.url))});
    });
    await page.goto('http://metrics.test/');
    await page.evaluate(async()=>{const {mountTechnicalNotices}=await import('/src/features/experience/technical-notices.js');globalThis.noticeCleanup=mountTechnicalNotices();});
    const render=data=>page.evaluate(async data=>{
      const {renderIndexedMetricFields}=await import('/src/features/coin/indexed-metrics.js');
      const state={coinActivity:{},formatUsd:value=>'$'+value,setCoinField:(selector,value)=>{document.querySelector(selector).textContent=value;}};
      renderIndexedMetricFields(state,data);
      if(state.coinActivity.holderCount!==(data.holderCount??'—'))throw Error('Holder tab count drifted');
      globalThis.noticeCleanup.scan();
    },data);
    await render({marketCapUsd:null,fdvUsd:1000000,buyCount24h:null,sellCount24h:null,holderCount:null,burnedTokens:500000000,burnedPercent:50});
    await expect(page.locator('#coin-market-cap-label')).toHaveText('FDV');
    await expect(page.locator('#coin-market-cap')).toHaveText('$1,000,000');
    for(const id of ['coin-strip-trades','coin-holder-count','coin-strip-burned'])await expect(page.locator('#'+id)).toHaveText('Unavailable');
    await render({marketCapUsd:0,fdvUsd:100,buyCount24h:0,sellCount24h:0,holderCount:3852,holderCountStale:true,holderCountCheckedAt:'2026-11-24T15:19:00Z'});
    await expect(page.locator('#coin-market-cap-label')).toHaveText('Market cap');
    await expect(page.locator('#coin-market-cap')).toHaveText('$0');
    await expect(page.locator('#coin-strip-trades')).toHaveText('0');
    await expect(page.locator('#coin-holder-count')).toHaveText('≈3,852');
    await expect(page.locator('#coin-holder-freshness')).toHaveText('Last known count');
    await render({marketCapUsd:null,fdvUsd:null,buyCount24h:8,sellCount24h:null,holderCount:0});
    await expect(page.locator('#coin-market-cap')).toHaveText('Unavailable');
    await expect(page.locator('#coin-strip-trades')).toHaveText('Unavailable');
    await expect(page.locator('#coin-holder-count')).toHaveText('0');
  }finally{await browser.close();}
});
