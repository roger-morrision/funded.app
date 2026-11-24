import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { referralRows } from '../server/referral-rows.mjs';

const [owner, first, second, child, grandchild, unknown] = ['1','2','3','4','5','6'].map(char => char.repeat(32));
const attributions = Object.fromEntries([
  [first, owner], [second, owner], [child, second], [grandchild, child],
].map(([wallet, inviterWallet]) => [wallet, { wallet, inviterWallet, source:'direct' }]));
const rows = referralRows({ state:{ referrals:{ attributions } }, wallet:owner,
  network:[grandchild, first, child, second], qualified:new Set() });

test('referral rows retain the immediate inviter across multiple branches and three levels', () => {
  const byWallet = new Map(rows.map(row => [row.wallet, row]));
  for (const [wallet, level, inviter] of [[first,1,owner], [second,1,owner], [child,2,second], [grandchild,3,child]]) {
    assert.equal(byWallet.get(wallet).level, level);
    assert.equal(byWallet.get(wallet).inviterWallet, inviter);
  }
  const missing = referralRows({ state:{}, wallet:owner, network:[unknown], qualified:new Set() });
  assert.equal(missing[0].inviterWallet, null);
});

test('referral table shows parent wallet links on desktop and mobile without guessing missing parents', async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ contentType:'text/html', body:
        '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/calm-ui.css"><main id="main-content"><div id="my-referral-list"></div></main>' });
      if (path.startsWith('/api/')) return route.fulfill({ json:{ wallet:path.split('/')[3], trades:[] } });
      return route.fulfill({ contentType:path.endsWith('.css') ? 'text/css' : 'text/javascript',
        body:await readFile(new URL(`..${path}`, import.meta.url)) });
    });
    await page.goto('http://referrals.test/');
    await page.evaluate(async data => {
      const { updateReferralList } = await import('/src/features/referrals/referral-list.js');
      updateReferralList(data, 'ready');
    }, { wallet:owner, referrals:[...rows, { wallet:unknown, level:2 }] });
    for (const width of [1440,390]) {
      await page.setViewportSize({ width, height:900 });
      assert.equal(await page.locator('th').nth(1).textContent(), 'Invited by');
      assert.equal(await page.locator('th').nth(3).textContent(), 'Link source');
      for (const [wallet, inviter, label] of [[first,owner,'You'], [second,owner,'You'], [child,second,'Level 1'], [grandchild,child,'Level 2']]) {
        const row = page.locator('.referral-list-row').filter({ has:page.locator(`td:first-child a[href="/wallet/${wallet}"]`) });
        assert.equal(await row.locator('.referral-inviter a').getAttribute('href'), `/wallet/${inviter}`);
        assert.equal(await row.locator('.referral-inviter a').getAttribute('title'), inviter);
        assert.equal(await row.locator('.referral-inviter small').textContent(), label);
        assert.equal(await row.locator('td').nth(3).textContent(), 'Direct link');
      }
      const missing = page.locator('.referral-list-row').filter({ has:page.locator(`td:first-child a[href="/wallet/${unknown}"]`) });
      assert.equal(await missing.locator('.referral-inviter').textContent(), 'Unavailable');
      assert.equal(await missing.locator('.referral-inviter a').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
  } finally { await browser.close(); }
});
