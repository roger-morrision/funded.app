import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { preview } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile('index.html', 'utf8');
const start = source.indexOf('<section class="home-protocol-route"');
const end = source.indexOf('</section>', start);
assert.ok(start >= 0 && end > start, 'Home protocol panel exists in the production page');
const panel = source.slice(start, end + '</section>'.length);
const server = await preview({ configLoader:'runner', preview:{ host:'127.0.0.1', port:0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH
  ? { executablePath:process.env.CHROMIUM_PATH } : { channel:'chrome' }), headless:true });
try {
  const page = await browser.newPage({ viewport:{ width:1100, height:750 } });
  await page.route('**/src/features/home/protocol-fee-route.js', async route => route.fulfill({
    status:200, contentType:'application/javascript',
    body:await readFile('src/features/home/protocol-fee-route.js', 'utf8'),
  }));
  await page.route('**/home-protocol-route.css', async route => route.fulfill({
    status:200, contentType:'text/css', body:await readFile('home-protocol-route.css', 'utf8'),
  }));
  await page.route('**/__protocol_fixture__', route => route.fulfill({ status:200,
    contentType:'text/html',
    body:`<!doctype html><html><head><link rel="stylesheet" href="/home-protocol-route.css"></head><body style="background:#0b1020">${panel}</body></html>`,
  }));
  await page.goto(`${origin}/__protocol_fixture__`, { waitUntil:'domcontentloaded', timeout:10000 });
  await page.evaluate(async () => {
    const { renderHomeProtocolFeeRoute } = await import('/src/features/home/protocol-fee-route.js');
    renderHomeProtocolFeeRoute({ status:'verified', settledCollections:1,
      currentPolicy:{ revision:3, split:{ operationsPercent:50,
        referralLevelPercents:[10,3,2], communityPercent:10, buybackPercent:25 } },
      appRevenueLamports:'200000000', operationsLamports:'100000000',
      referralLamports:'30000000', communityLamports:'20000000', buybackLamports:'50000000' });
  });
  assert.equal(await page.locator('[data-protocol-destination]').count(), 4);
  assert.match(await page.locator('[data-protocol-destination="operations"]').innerText(), /50% of app share[\s\S]*0\.1 SOL allocated/);
  assert.match(await page.locator('[data-protocol-destination="buyback"]').innerText(), /25% of app share[\s\S]*0\.05 SOL allocated/);
  assert.match(await page.locator('#home-protocol-route-status').innerText(), /not wallet balances or paid rewards/);
  await page.setViewportSize({ width:390, height:800 });
  assert.equal(await page.locator('.home-protocol-route-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1);
  console.log('Home 20% route and responsive destination cards render (mocked receipt fixture).');
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
