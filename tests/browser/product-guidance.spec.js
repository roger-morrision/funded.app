import { test, expect } from '@playwright/test';

for(const width of[390,1440])test(`FQA-029 ranking help preserves native topic navigation at ${width}px (mocked APIs)`,async({page},info)=>{
  test.setTimeout(90000);await fixtures(page);await page.setViewportSize({width,height:width===390?844:900});const errors=[],observations=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/#leaderboard');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.evaluate(()=>document.fonts.ready);
  const article=page.locator('#docs-guide-article'),link=page.locator('#leaderboard-panel a.text-button');
  const topic=async(focus=false)=>{await expect(page).toHaveURL(/#docs\/leaderboard$/);await expect(article.locator('h1')).toHaveText('Leaderboards');await expect(page.locator('.docs-guide-nav [aria-current="page"]')).toHaveText('Leaderboards');await expect.poll(()=>article.locator('h1').evaluate(e=>{const r=e.getBoundingClientRect(),nav=document.querySelector('.mobile-workspace-nav');return r.top>=0&&r.bottom<=(nav?.getClientRects().length?nav.getBoundingClientRect().top:innerHeight)})).toBe(true);if(focus)await expect.poll(()=>page.evaluate(()=>Boolean(document.activeElement.closest('#docs-guide-article')))).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true)};
  const initialHistoryLength=await page.evaluate(()=>history.length);
  for(const view of['burners','burn-board','creators','traders']){
    const tab=page.locator(`[data-leaderboard-view="${view}"]`);if(width===390){await tab.focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');await expect(link).toBeFocused()}else await tab.click();await expect(tab).toHaveAttribute('aria-selected','true');
    if(width===390)await page.keyboard.press('Enter');else await link.click();await topic(true);expect(await page.evaluate(()=>history.length)).toBe(initialHistoryLength+1);observations.push({view,url:page.url(),active:await page.evaluate(()=>({tag:document.activeElement.tagName,text:document.activeElement.textContent.slice(0,80)})),tree:await article.ariaSnapshot()});
    await page.goBack();await expect(page).toHaveURL(/#leaderboard$/);await expect(tab).toHaveAttribute('aria-selected','true');await expect(link).toBeVisible();
  }
  await page.goForward();await topic();await page.reload();await page.locator('body.workspace-ready.product-experience-ready').waitFor();await topic();await page.goto('/#docs/leaderboard');await topic();await page.screenshot({path:info.outputPath('ranking-guide.png')});
  // Controlled synchronous focus intervention during the real Docs DOM replacement.
  // An outside owner must cancel restoration even when it subsequently blurs to BODY.
  for(const mode of['outside','outside-then-blur']){
    await page.goto('/#docs');await expect(article.locator('h1')).toHaveText('What is funded.vip?');await page.goto('/#leaderboard');
    await article.evaluate((element,mode)=>{const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');Object.defineProperty(element,'innerHTML',{configurable:true,get(){return descriptor.get.call(this)},set(value){descriptor.set.call(this,value);const owner=document.querySelector('#connect-button');owner.focus({preventScroll:true});if(mode==='outside-then-blur')owner.blur();}})},mode);
    await link.click();await topic();if(mode==='outside')await expect(page.locator('#connect-button')).toBeFocused();else expect(await page.evaluate(()=>document.activeElement===document.body)).toBe(true);await article.evaluate(element=>delete element.innerHTML);
    observations.push({mode,label:'Controlled setter delegates actualDOMreplacement, then native outsidefocus/blur before guarded restore',active:await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id}))});
  }
  expect(errors).toEqual([]);
  await info.attach('ranking-guide-navigation',{body:JSON.stringify({width,label:'Actualnativeanchor/Docsrenderer, mockedread-only API availability; no ranking/financial operation',observations,errors},null,2),contentType:'application/json'});
});

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
  await expect(article).toContainText('gross collected creator fees at each coin’s saved rate');
  await expect(article).toContainText('each receive one third');
  await expect(article).toContainText('1st 50% · 2nd 30% · 3rd 20% of the category budget');
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
  await expect(faq.locator('details[data-faq="bonus"]')).toContainText('of the category budget');
  await faq.locator('a[href="#bonuses"]').click();await expect(page.locator('#bonuses')).toBeVisible();
  await page.goto('/#referral-faq');
  await page.locator('#referral-faq').getByText('Do I need to claim a referral bonus?',{exact:true}).click();
  await expect(page.locator('[data-faq="referral-claim"]')).toContainText('no separate V3 recipient claim');
  const dailyFaq=page.locator('[data-faq="referral-daily"]');
  await expect(dailyFaq).toContainText(`${bonus}% Daily bonus pool`);
  await expect(dailyFaq).toContainText('each receive one third');
  await expect(dailyFaq).toContainText('of the category budget');
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
