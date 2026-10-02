import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { build, preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
process.env.VITE_JACKPOT_ENABLED = 'true';
const outDir = await mkdtemp(join(tmpdir(), 'funded-jackpot-ui-'));
await build({ build:{ outDir, emptyOutDir:true, logLevel:'silent' }, logLevel:'silent' });
const server = await preview({ build:{ outDir }, preview:{ host:'127.0.0.1', port:5199, strictPort:true } });
const browser = await chromium.launch({ channel:'chrome', headless:true });
const context = await browser.newContext({ viewport:{ width:900, height:800 } });
const signature = '5'.repeat(88);
let creatorAmount = '123456789';
let creatorVerified = true;
let nextReceipt = null;
const windowEnd = Math.floor(Date.now() / 1000) + 3600;
await context.route('**/api/**', route => route.fulfill({ status:503,
  contentType:'application/json', body:'{"error":"UI fixture"}' }));
await context.route('**/api/jackpots/status', route => route.fulfill({ status:200,
  contentType:'application/json', body:JSON.stringify({ cluster:'devnet',
    generatedAt:new Date().toISOString(),
    creator:{ id:'creator:test', fundedLamports:creatorAmount, fundingVerified:creatorVerified,
      entries:3, payoutEnabled:true, rulesPublished:true, eligibilityApproved:true,
      windowEnd,
      history:[{ status:'paid', cluster:'devnet', signature,
        winner:'11111111111111111111111111111111', amountLamports:'123456789' },
      { status:'paid', cluster:'devnet', signature:'bad', winner:'bad', amountLamports:'1' },
      ...(nextReceipt ? [nextReceipt] : [])] },
    trader:{ id:'trader:test', fundedLamports:'50000000', fundingVerified:true, entries:4,
      payoutEnabled:false, windowEnd, history:[] } }) }));
const page = await context.newPage();
try {
  await page.goto('http://127.0.0.1:5199/#payments', { waitUntil:'domcontentloaded' });
  const cards = page.locator('.jackpot-preview-card');
  await cards.first().waitFor({ state:'visible' });
  await cards.first().scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.jackpot-disclosure').getAttribute('open'), '');
  assert.equal(await page.locator('#rewards-overview > .jackpot-overview-spotlight').count(), 1);
  assert.equal(await page.locator('#rewards-overview > .jackpot-overview-spotlight').isVisible(), true);
  assert.equal(await page.locator('[data-jackpot-overview-amount="creator"]').textContent(), '0.123456789 SOL');
  assert.equal(await page.locator('#launch-form .jackpot-context-link').getAttribute('hidden'), null);
  assert.notEqual(await page.locator('#trade-panel .panel-heading + .jackpot-context-link').getAttribute('hidden'), null);
  await page.locator('.jackpot-disclosure').evaluate(element => { element.open = false; });
  await page.locator('.jackpot-overview-spotlight button').click();
  assert.equal(await page.locator('.jackpot-disclosure').getAttribute('open'), '');
  await page.locator('.jackpot-proof summary').click();
  assert.match(await page.locator('.jackpot-proof').textContent(), /Planned creator pool/);
  assert.match(await page.locator('[data-jackpot-proof-status]').textContent(), /funding verified/);
  const reveal = cards.first().locator('.jackpot-reveal');
  await page.waitForFunction(() => document.querySelector('.jackpot-reveal')?.classList.contains('is-drawing'));
  assert.match(await reveal.locator('.jackpot-reveal-title').textContent(), /Revealing the verified draw/);
  assert.equal(await reveal.locator('.jackpot-reveal-wallet').textContent(), '');
  assert.notEqual(await reveal.locator('.jackpot-reveal-wheel').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.waitForFunction(() => document.querySelector('.jackpot-reveal')?.classList.contains('is-winner'));
  assert.equal(await reveal.locator('.jackpot-reveal-title').textContent(), 'Congratulations, winner!');
  assert.equal(await reveal.locator('.jackpot-reveal-wallet').textContent(), '1111…1111');
  assert.equal(await reveal.locator('.jackpot-reveal-wallet').getAttribute('title'), '11111111111111111111111111111111');
  assert.equal(await reveal.locator('.jackpot-reveal-receipt').getAttribute('href'),
    `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  await reveal.locator('.jackpot-replay').click();
  assert.match(await reveal.getAttribute('class'), /is-drawing/);
  await page.waitForFunction(() => document.querySelector('.jackpot-reveal')?.classList.contains('is-winner'));
  await page.waitForFunction(() => document.querySelector('.jackpot-preview-card .jackpot-amount')?.textContent === '0.123456789 SOL');
  assert.match(await cards.first().locator('.jackpot-amount').getAttribute('class'), /jackpot-amount-updated/);
  assert.match(await cards.first().textContent(), /0\.123456789 SOL/);
  assert.match(await cards.first().textContent(), /3 verified entries/);
  assert.match(await cards.first().textContent(), /Jackpot round closes in/);
  await page.waitForFunction(() => document.querySelectorAll('.jackpot-preview-card .jackpot-amount')[1]?.textContent === '0.05 SOL');
  assert.match(await cards.nth(1).textContent(), /Entries not open · preview only/);
  assert.equal(await cards.first().locator('.jackpot-history a').count(), 1);
  assert.equal(await cards.first().locator('.jackpot-history a').getAttribute('href'),
    `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  assert.match(await cards.nth(1).textContent(), /No draw scheduled/);
  assert.equal(await page.locator('.jackpot-alerts').isVisible(), true);
  await page.locator('[data-jackpot-alert-toggle]').check();
  assert.match(await page.locator('[data-jackpot-alert-status]').textContent(), /On · new finalized/);
  const before = await cards.first().locator('.jackpot-preview-countdown').textContent();
  await page.waitForTimeout(1200);
  const after = await cards.first().locator('.jackpot-preview-countdown').textContent();
  assert.notEqual(after, before);
  creatorAmount = '223456789';
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => document.querySelector('.jackpot-preview-card .jackpot-amount')?.textContent === '0.223456789 SOL');
  assert.match(await reveal.getAttribute('class'), /is-winner/);
  creatorVerified = false;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => document.querySelector('.jackpot-preview-card .jackpot-amount')?.textContent === 'Funding proof unavailable');
  creatorVerified = true;
  await page.waitForTimeout(100);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => document.querySelector('.jackpot-preview-card .jackpot-amount')?.textContent === '0.223456789 SOL');
  nextReceipt = { status:'paid', cluster:'devnet', signature:'6'.repeat(88),
    winner:`${'2'.repeat(30)}33`, amountLamports:'223456789', paidAt:Math.floor(Date.now() / 1000) };
  await page.waitForTimeout(100);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => document.querySelector('.jackpot-reveal')?.classList.contains('is-drawing'));
  await page.waitForFunction(() => document.querySelector('.jackpot-reveal-wallet')?.textContent === '2222…2233');
  await page.waitForFunction(() => document.querySelectorAll('[data-jackpot-alert-list] li').length === 1);
  assert.equal(await page.locator('[data-jackpot-alert-list] a').getAttribute('href'),
    `https://explorer.solana.com/tx/${nextReceipt.signature}?cluster=devnet`);
  assert.equal(await reveal.locator('.jackpot-reveal-receipt').getAttribute('href'),
    `https://explorer.solana.com/tx/${nextReceipt.signature}?cluster=devnet`);
  const refresh = page.waitForResponse(response => response.url().endsWith('/api/jackpots/status'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await refresh;
  assert.match(await reveal.getAttribute('class'), /is-winner/);
  const laterPage = await context.newPage();
  await laterPage.goto('http://127.0.0.1:5199/#overview', { waitUntil:'domcontentloaded' });
  await laterPage.locator('body.workspace-ready').waitFor();
  await laterPage.locator('.home-jackpot-spotlight').waitFor({ state:'visible' });
  await laterPage.waitForFunction(() => document.querySelector('[data-home-jackpot-amount="creator"]')?.textContent === '0.223456789 SOL');
  assert.equal(await laterPage.locator('[data-home-jackpot-amount="trader"]').textContent(), '0.05 SOL');
  assert.equal(await laterPage.locator('.home-jackpot-heading a').getAttribute('href'), '#payments');
  await laterPage.waitForFunction(() => document.querySelector('.jackpot-preview-card .jackpot-amount')?.textContent === '0.0 SOL');
  await laterPage.locator('.home-jackpot-heading a').click();
  await laterPage.locator('#rewards-overview').waitFor({ state:'visible' });
  assert.equal(await laterPage.locator('[data-jackpot-overview-amount="creator"]').textContent(), '0.223456789 SOL');
  await laterPage.locator('.jackpot-preview-card').first().waitFor({ state:'visible' });
  await laterPage.locator('.jackpot-preview-card').first().scrollIntoViewIfNeeded();
  await laterPage.waitForFunction(() => {
    const text = document.querySelector('.jackpot-preview-card .jackpot-amount')?.textContent;
    return text && text !== '0.0 SOL' && text !== '0.223456789 SOL';
  });
  await laterPage.waitForFunction(() => document.querySelector('.jackpot-preview-card .jackpot-amount')?.textContent === '0.223456789 SOL');
  const reducedContext = await browser.newContext({ viewport:{ width:900, height:800 }, reducedMotion:'reduce' });
  await reducedContext.route('**/api/**', route => route.fulfill({ status:503,
    contentType:'application/json', body:'{"error":"UI fixture"}' }));
  await reducedContext.route('**/api/jackpots/status', route => route.fulfill({ status:200,
    contentType:'application/json', body:JSON.stringify({ cluster:'devnet', generatedAt:new Date().toISOString(),
      creator:{ id:'creator:test', fundedLamports:'0', fundingVerified:false, payoutEnabled:false,
        windowEnd, history:[{ status:'paid', cluster:'devnet', signature,
          winner:'11111111111111111111111111111111', amountLamports:'123456789' }] },
      trader:{ id:'trader:test', fundedLamports:'0', fundingVerified:false,
        payoutEnabled:false, windowEnd, history:[] } }) }));
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto('http://127.0.0.1:5199/#payments', { waitUntil:'domcontentloaded' });
  await reducedPage.locator('.jackpot-disclosure').waitFor({ state:'attached' });
  assert.match(await reducedPage.locator('[data-jackpot-overview-status]').textContent(), /Inactive preview/);
  assert.equal(await reducedPage.locator('[data-jackpot-overview-amount="creator"]').textContent(), '0.0 SOL');
  assert.notEqual(await reducedPage.locator('#launch-form .jackpot-context-link').getAttribute('hidden'), null);
  if (!await reducedPage.locator('.jackpot-disclosure').evaluate(element => element.open))
    await reducedPage.locator('.jackpot-disclosure > summary').click();
  await reducedPage.locator('.jackpot-preview-card').first().waitFor({ state:'visible' });
  await reducedPage.locator('.jackpot-preview-card').first().scrollIntoViewIfNeeded();
  await reducedPage.locator('.jackpot-reveal.is-winner').waitFor();
  assert.equal(await reducedPage.locator('.jackpot-alerts').isVisible(), true);
  assert.equal(await reducedPage.locator('[data-jackpot-alert-toggle]').isChecked(), false);
  assert.equal(await reducedPage.locator('.jackpot-reveal-wallet').first().textContent(), '1111…1111');
  assert.equal(await reducedPage.locator('.jackpot-reveal-wheel').first().evaluate(element => getComputedStyle(element).animationName), 'none');
  await reducedPage.setViewportSize({ width:390, height:844 });
  await reducedPage.evaluate(() => { location.hash = '#overview'; });
  await reducedPage.locator('.home-jackpot-spotlight').waitFor({ state:'attached' });
  assert.equal(await reducedPage.locator('[data-home-jackpot-amount="creator"]').textContent(), '0.0 SOL');
  assert.equal(await reducedPage.locator('[data-home-jackpot-amount="trader"]').textContent(), '0.0 SOL');
  assert.match(await reducedPage.locator('[data-home-jackpot-status]').textContent(), /Inactive Devnet preview/);
  assert.equal(await reducedPage.locator('.home-jackpot-spotlight').isVisible(), false);
  await reducedContext.close();
  console.log('Jackpot UI fixture passed: amounts, countdown, verified draw replay, short winner wallet, receipt, reduced motion, and refresh.');
} finally {
  await browser.close();
  await new Promise(resolveClose => server.httpServer.close(resolveClose));
  if (!resolve(outDir).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error('Temporary build path escaped the system temp directory.');
  await rm(outDir, { recursive:true, force:true });
}
