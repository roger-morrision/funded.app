import { test, expect } from '@playwright/test';
async function fixtures(page, override=false) {
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Unavailable fixture'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{revision:19,split:{
    operationsPercent:override ? 30:40,referralLevelPercents:[10,3,2],communityPercent:override ? 30:20,buybackPercent:25}}}));
  await page.route('https://**/*',route=>route.abort());
}

test('all Docs topics navigate, have deep links, and link only to existing documentation topics',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await fixtures(page);await page.goto('/#docs');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const nav=page.locator('.docs-guide-nav'), article=page.locator('#docs-guide-article');
  await expect(article).toBeVisible();
  const titles=await nav.locator('button').allTextContents(), hashes=new Set(), linked=new Set();
  expect(titles.length).toBeGreaterThanOrEqual(29);
  for(const title of titles) {
    await nav.getByRole('button',{name:title,exact:true}).click();
    await expect(article.locator('h1')).toHaveText(title);
    expect((await article.locator('.docs-guide-body').innerText()).length).toBeGreaterThan(80);
    hashes.add(new URL(page.url()).hash);
    for(const href of await article.locator('a[href^="#docs/"]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')))) linked.add(href);
  }
  for(const href of linked) expect(hashes.has(href),`Broken guide link ${href}`).toBe(true);
  await expect(page.locator('#fee-policy-faq')).toHaveCount(1);
  await page.reload();await expect(article.locator('h1')).toHaveText('FAQ');
  await nav.getByRole('button',{name:'Daily bonuses',exact:true}).click();
  await page.goBack();await expect(article.locator('h1')).toHaveText('FAQ');
  expect(errors).toEqual([]);
});

for(const [width,override] of [[390,false],[1440,true]]) test(`reward actions, FAQ and Docs share the saved fee policy at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await fixtures(page,override);
  await page.goto('/#docs/fees');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const article=page.locator('#docs-guide-article'), ops=override ? 6:8, bonus=override ? 6:4;
  await expect(article).toContainText(`${ops}% Operations & marketing`);
  await expect(article).toContainText(`${bonus}% Daily bonus pool`);
  await expect(article).toContainText('No manual claim or recipient signature is required');
  await page.locator('.docs-guide-nav').getByRole('button',{name:'Automatic payouts or claims?',exact:true}).click();
  const daily=article.locator('tbody tr').filter({hasText:'Daily bonus'});
  await expect(daily).toContainText('Automatic transfer');
  await expect(article.locator('tbody tr').filter({hasText:'X account'})).toContainText('complete the claim');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.goto('/#overview');
  const faq=page.locator('.home-reference-faq-list');
  await faq.getByText('How are Daily bonuses paid?',{exact:true}).click();
  await expect(faq.locator('details[data-faq="bonus"]')).toContainText(`${bonus}% Daily bonus pool`);
  await expect(faq.locator('details[data-faq="bonus"]')).toContainText('No manual claim');
  await faq.locator('a[href="#bonuses"]').click();await expect(page.locator('#bonuses')).toBeVisible();
  await page.goto('/#referral-faq');
  await page.locator('#referral-faq').getByText('Do I need to claim a referral bonus?',{exact:true}).click();
  await expect(page.locator('[data-faq="referral-claim"]')).toContainText('no separate V3 recipient claim');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('current-referral-guidance.png'),fullPage:true});
});

test('Help covers all current topics and opens the matching Daily bonus guide',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await fixtures(page);await page.goto('/#overview');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const trigger=page.locator('#help-topics-trigger'), panel=page.locator('#help-topics-panel');
  await trigger.click();await expect(panel).toBeVisible();
  const ids=await panel.locator('[data-help-topic]').evaluateAll(nodes=>nodes.map(node=>node.dataset.helpTopic));
  expect(ids.length).toBeGreaterThanOrEqual(14);
  for(const id of ids) {
    await panel.locator(`[data-help-topic="${id}"]`).click();
    await expect(panel.locator(`[data-help-topic="${id}"]`)).toHaveAttribute('aria-pressed','true');
    expect((await panel.locator('.help-topics-answer p').innerText()).length).toBeGreaterThan(60);
    await expect(panel.locator('.help-topics-answer a')).toHaveAttribute('href',/^#docs\//);
  }
  await panel.locator('[data-help-topic="bonus"]').click();
  await expect(panel.locator('.help-topics-answer')).toContainText('No manual claim');
  await panel.locator('.help-topics-answer a').click();
  await expect(panel).toBeHidden();await expect(page.locator('#docs-guide-article h1')).toHaveText('Daily bonuses');
  await page.goto('/#overview');
  await trigger.click();await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(trigger).toBeFocused();
});
