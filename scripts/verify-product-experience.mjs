import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5199';
const browser = await chromium.launch({channel:'chrome',headless:true});
await mkdir('tmp/product-experience-evidence',{recursive:true});
const errors=[];
const mint='So11111111111111111111111111111111111111112';
try {
  for (const width of [320,390,768,1440]) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
    await context.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
    await context.route('https://**/*',route=>route.abort());
    const page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
    for (const route of ['overview','explore','launch','my-launches','payments','airdrops','leaderboard','paid','referrals','docs','creators']) {
      await page.goto(`${base}/#${route}`,{waitUntil:'domcontentloaded'});
      await page.locator('body.product-experience-ready').waitFor();
      await page.screenshot({path:`tmp/product-experience-evidence/${route}-${width}.png`});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} overflows at ${width}`);
      if(width<=390){
        assert.equal(await page.locator('.mobile-workspace-nav').isVisible(),true,route);
        assert.deepEqual(await page.locator('.mobile-workspace-nav a').allTextContents(),['Home','Explore','Launch','Portfolio','Rewards']);
      }
      if(route==='explore'){
        assert(await page.locator('#explore-sort').isVisible());
        await page.locator('#explore-filter-toggle').click();
        assert(await page.locator('#explore-promotion-filter').isVisible());
        await page.keyboard.press('Escape');
        assert(await page.locator('#explore-filter-popover').isHidden());
        await page.locator('#explore-sort').selectOption('newest');
        assert.equal(await page.locator('#explore-sort').inputValue(),'newest');
      }
      if(route==='launch'){
        assert(await page.locator('.creator-burn-section').isHidden());
        await page.locator('#token-name').fill('Read only UI test');
        await page.locator('#token-symbol').fill('UITEST');
        await page.locator('#launch-next').click();
        assert(await page.locator('[data-launch-step="2"]').isVisible());
        assert(await page.locator('.creator-burn-section').isVisible());
      }
      if(route==='my-launches'){
        await page.locator('#portfolio-created-tab').click();
        assert(await page.locator('#portfolio-created-panel').isVisible());
        assert(await page.locator('#portfolio-holdings-panel').isHidden());
      }
    }
    await page.goto(`${base}/token/${mint}`,{waitUntil:'domcontentloaded'});
    await page.locator('body.product-experience-ready').waitFor();
    await page.screenshot({path:`tmp/product-experience-evidence/token-${width}.png`});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`token overflows at ${width}`);
    await page.evaluate(mint => localStorage.setItem(`funded.boost.pending.${mint}`,JSON.stringify({signature:'2'.repeat(88),quote:{id:'boost_123_0123456789abcdef',mint,cluster:'devnet',packageId:'10x'}})),mint);
    await page.locator('#coin-boost').click();
    await page.locator('.explore-boost-history[open]').waitFor();
    assert.match(await page.locator('.explore-boost-history').innerText(),/Awaiting confirmation/);
    assert.equal(await page.locator('[data-boost-package]:disabled').count(),5);
    assert.match(await page.locator('.explore-boost-pay').innerText(),/Check payment status/);
    await page.screenshot({path:`tmp/product-experience-evidence/boost-pending-${width}.png`});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('body.product-experience-ready').waitFor();
    await page.locator('#coin-boost').click();
    await page.locator('.explore-boost-history[open]').waitFor();
    assert.match(await page.locator('.explore-boost-history').innerText(),/Awaiting confirmation/);
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log('Product experience passed: 12 routes at 320/390/768/1440px, navigation, filters, launch options, portfolio tabs, pending boost recovery after reload; read-only outage fixture.');
} finally {await browser.close();}
