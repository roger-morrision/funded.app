import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { preview } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await preview({ configLoader:'runner', preview:{ host:'127.0.0.1', port:0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH
  ? { executablePath:process.env.CHROMIUM_PATH } : { channel:'chrome' }), headless:true });
try {
  const page = await browser.newPage({ viewport:{ width:900, height:720 } });
  for (const path of ['src/features/rewards/holder-airdrop-directory.js',
    'src/features/rewards/airdrop-discovery-model.js', 'devnet-metadata.js']) {
    const body = await readFile(path, 'utf8');
    await page.route(`**/${path}`, route => route.fulfill({ status:200,
      contentType:'application/javascript', body }));
  }
  await page.route('**/devnet-images/**', route => route.fulfill({ status:200,
    contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" />' }));
  await page.route('**/__holder_fixture__', route => route.fulfill({ status:200,
    contentType:'text/html', body:'<!doctype html><html><body><main><div id="anchor"></div></main></body></html>' }));
  await page.goto(`${origin}/__holder_fixture__`, { waitUntil:'domcontentloaded', timeout:10000 });
  await page.evaluate(async () => {
    const { mountHolderAirdropDirectory, renderHolderAirdropDirectory } =
      await Promise.race([import('/src/features/rewards/holder-airdrop-directory.js'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Module import timed out')), 10000))]);
    mountHolderAirdropDirectory(document.querySelector('#anchor'));
    renderHolderAirdropDirectory({ cluster:'devnet', evidence:{ status:'recorded-finalized-v3' },
      tokens:[{ mint:'11111111111111111111111111111111', symbol:'QA', name:'QA coin',
        holderSharePercent:20, holderPaidWallets:2, holderPaidLamports:'300000000',
        totals:{ holder:'400000000' }, holderRewardPolicy:{ cadence:'hourly' },
        topHolderRecipients:[
          { wallet:'22222222222222222222222222222222', amountLamports:'200000000',
            paymentCount:2, latestSignature:'3'.repeat(64) },
          { wallet:'44444444444444444444444444444444', amountLamports:'100000000',
            paymentCount:1, latestSignature:'5'.repeat(64) },
        ] }] });
  });
  await page.locator('#holder-distributed-tab').click();
  assert.equal(await page.locator('.holder-reward-top-wallets li').count(), 2);
  assert.match(await page.locator('.holder-reward-top-wallets li').first().innerText(), /0\.2 SOL/);
  assert.match(await page.locator('.holder-reward-top-wallets li').first()
    .locator('a').getAttribute('href'), /cluster=devnet/);
  assert.match(await page.locator('#holder-airdrop-note').innerText(), /verified payment receipts/);
  console.log('Holder reward directory renders receipt-backed top wallets (mocked browser fixture).');
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
