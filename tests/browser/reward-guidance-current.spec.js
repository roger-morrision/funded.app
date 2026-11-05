import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const receipts=[{source:'v3-creator-wallet',to:'8'.repeat(44),signature:'3'.repeat(88),amountLamports:1000000001,actualReceivedLamports:999993001,feeLamports:5000,recipientRentLamports:2000,feePayer:'8'.repeat(44),blockTime:1792454400,slot:512479000},
  {source:'automatic-holder',to:'9'.repeat(44),signature:'4'.repeat(88),amountLamports:200001,actualReceivedLamports:200001,feeLamports:5000,feePayer:'7'.repeat(44),blockTime:1792454460,slot:512479001}];
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Unavailable fixture'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/evidence/payment-history',route=>route.fulfill({json:{cluster:'devnet',status:'onchain-indexed',commitment:'finalized',generatedAt:new Date().toISOString(),verifiedPayouts:receipts,payoutCoverage:{status:'verified',recorded:2,verified:2}}}));
});
for(const width of [390,1440])test(`concise guidance, airdrops and payment layout at ${width}`,async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:900});
  const visit=async route=>{await page.goto('/#'+route);await page.locator('body.workspace-ready.product-experience-ready').waitFor();};
  await visit('explore');await expect(page.locator('#explore-ranking-note')).toHaveCount(0);
  await visit('airdrops');await expect(page.locator('#airdrops')).toContainText('automatically');
  await expect(page.getByRole('tab',{name:/Migrated & Airdropped/})).toBeVisible();
  await expect(page.locator('#airdrops')).not.toContainText(/check claim status|claim before|claim deadline|V3/);
  await visit('referrals');await expect(page.getByRole('tab',{name:'My referral list'})).toBeVisible();
  await page.getByRole('tab',{name:'My referral list'}).click();await expect(page.locator('#my-referral-list')).toHaveText('-');
  await visit('docs/airdrop-policy');const article=page.locator('#docs-guide-article');
  await expect(article).toContainText('proportional');await expect(article).toContainText('automatically');await expect(article.locator('li')).toHaveCount(4);
  await visit('docs/referrals');await expect(article).toContainText('manually');await expect(article).toContainText('automatic');
  await visit('docs/fees');await expect(article.locator('.fee-benefit-detail a')).toHaveCount(0);
  const colors=await page.locator('.fee-distribution-categories [data-fee-category] > strong').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).color));
  if(colors.length)expect(new Set(colors).size).toBeGreaterThan(3);
  await visit('payments');await page.locator('[data-reward-open="history"]').click();
  const rows=page.locator('#payment-list .payment-history-row');await expect(rows).toHaveCount(2);
  if(width>700){await expect(page.locator('.payment-table-head')).toBeVisible();
    const cols=await rows.first().evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length);expect(cols).toBe(3);}
  const summary=rows.first().locator('summary');await summary.focus();await page.keyboard.press('Enter');await expect(rows.first().locator('details')).toHaveAttribute('open','');
  await page.evaluate(()=>window.dispatchEvent(new Event('funded:route-change')));
  await expect(summary).toBeFocused();await expect(rows.first().locator('details')).toHaveAttribute('open','');
  await expect(rows.first()).toContainText('0.999993001');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`payments-${width}.png`),fullPage:true});
  await visit('profile');if(await page.locator('#help-topics-trigger').isVisible())await page.locator('#help-topics-trigger').click();else{await page.locator('#open-menu').click();await page.locator('#help-menu-trigger').click();}
  const answer=page.locator('.help-topics-answer');await expect(answer.locator('ul')).toBeVisible();await expect(answer).toContainText('account');
  expect(errors).toEqual([]);
});

test('every guide and Help topic opens with concise current guidance',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/#docs');await page.locator('body.workspace-ready').waitFor();
  const nav=page.locator('.docs-guide-nav'),article=page.locator('#docs-guide-article');
  const titles=await nav.locator('button[data-docs-topic]').allTextContents();expect(titles.length).toBe(45);
  for(const title of titles){await nav.getByRole('button',{name:title,exact:true}).click();await expect(article.locator('h1')).toHaveText(title);
    expect((await article.locator('.docs-guide-body').innerText()).length).toBeGreaterThan(60);
    await expect(article).not.toContainText(/\bV3\b|no separate V3 recipient claim/);}
  await page.goto('/#overview');await page.locator('#help-topics-trigger').click();const panel=page.locator('#help-topics-panel');
  const ids=await panel.locator('[data-help-topic]').evaluateAll(nodes=>nodes.map(n=>n.dataset.helpTopic));expect(ids.length).toBeGreaterThanOrEqual(30);
  for(const id of ids){await panel.locator(`[data-help-topic="${id}"]`).click();await expect(panel.locator('.help-topics-answer ul')).toBeVisible();
    await expect(panel.locator('.help-topics-answer a')).toHaveAttribute('href',/^#docs\//);}
  expect(errors).toEqual([]);
});
