import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const base=process.env.REVIEW_BASE_URL || 'http://localhost:5180';
const out='tmp/audit-ui';await mkdir(out,{recursive:true});
const browser=await chromium.launch();const results=[];
try {
  for(const width of [360,390,768,1440]) {
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);await page.waitForSelector('body.product-flows-ready');
    await page.locator('#network-disclosure').waitFor({state:'visible'});
    assert.match(await page.locator('#network-disclosure').innerText(),/MAINNET/);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=1,`overflow ${width}: ${overflow}`);
    const heroVariant=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--home-hero-art'));
    assert.match(heroVariant,width<=700?/home-hero-mobile/:/home-hero-desktop/);
    // Current Mainnet design may use its newer SVG hero instead of this artwork.
    const hero=await page.locator('.hero-section').evaluate(node=>getComputedStyle(node).backgroundImage);
    assert.doesNotMatch(hero,/home-wolf-hero.webp/);
    await page.screenshot({path:`${out}/home-${width}.png`});
    await page.goto(`${base}/#profile`);await page.waitForSelector('body.product-flows-ready');
    assert.match(await page.locator('#network-and-rewards-help').innerText(),/Paid rewards require a finalized transaction receipt/);
    await page.goto(`${base}/#explore`);await page.waitForSelector('body.product-flows-ready');
    const toggle=page.locator('[data-quick-buy-toggle]').first();
    await toggle.waitFor({state:'visible'});await toggle.click();
    await page.screenshot({path:`${out}/menu-${width}.png`});
    const link=page.locator('[data-quick-buy-menu]:not([hidden]) a').first();
    assert.match(await link.innerText(),/Review/);
    const href=await link.getAttribute('href');assert.match(href,/reviewBuy=/);
    const signingCalls=[];page.on('request',request=>{if(request.method()==='POST'&&/swap|trade\/submit|sendTransaction/.test(request.url()))signingCalls.push(request.url());});
    await link.click();await page.waitForURL(/\/token\/.*reviewBuy=/);
    await page.waitForSelector('body.product-flows-ready');assert.equal(signingCalls.length,0);
    assert.deepEqual(errors,[]);results.push({width,overflow,reviewNavigation:true,scriptErrors:errors});await page.close();
  }
  const html=await readFile('tmp/review/dist/index.html','utf8');
  const preloads=[...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map(match=>match[1]);
  let gzipBytes=0;for(const path of preloads)gzipBytes+=gzipSync(await readFile('tmp/review/dist'+path)).length;
  const report={scope:'local build, read-only public API data; no wallet or transactions',results,preloads:preloads.length,preloadGzipBytes:gzipBytes};
  await writeFile(`${out}/results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
