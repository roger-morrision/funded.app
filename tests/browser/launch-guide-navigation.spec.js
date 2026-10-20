import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

test.beforeEach(async({page})=>{
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Offline documentation fixture'}}));
  await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
});
const ready=async page=>{
  await page.locator('body.workspace-ready.product-experience-ready').waitFor();
  await page.evaluate(()=>document.fonts.ready);
};
const launchArticle=async page=>{
  await expect(page).toHaveURL(/#docs\/launch$/);
  await expect(page.locator('#docs-guide-article h1')).toHaveText('Launch a token');
  await expect(page.locator('.docs-guide-nav [aria-current="page"]')).toHaveText('Launch a token');
  await expect.poll(()=>page.locator('#docs-guide-article h1').evaluate(e=>{
    const r=e.getBoundingClientRect(),nav=document.querySelector('.mobile-workspace-nav');
    const bottom=nav?.getClientRects().length?nav.getBoundingClientRect().top:innerHeight;
    return r.top>=0&&r.bottom<=bottom;
  })).toBe(true);
  expect(await page.evaluate(()=>Boolean(document.activeElement.closest('#launch-dialog,#launch-route-shell')))).toBe(false);
};

for(const width of[390,1440])for(const activation of['pointer','keyboard']){
  test(`FQA-020 / UX-019 contextual launch guide at ${width}px by ${activation} preserves native history/draft (mocked APIs)`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:width===390?844:900});const errors=[];let choosers=0;
    page.on('pageerror',e=>errors.push(e.message));page.on('filechooser',()=>choosers++);
    await page.goto('/#launch');await ready(page);await expect(page.locator('body')).toHaveClass(/page-route-launch/);
    await page.locator('#token-name').fill('QA guide preview');await page.locator('#token-symbol').fill('GUIDE');
    const guide=page.locator('#launch-route-shell .route-shell-actions a');
    await expect(guide).toHaveAttribute('href','#docs/launch');await expect(guide).toHaveText('Read the launch guide →');
    const history=await page.evaluate(()=>window.history.length);
    if(activation==='pointer')await guide.click();else{
      for(let n=0;n<12&&!await guide.evaluate(e=>e===document.activeElement);n++)await page.keyboard.press('Shift+Tab');
      await expect(guide).toBeFocused();await page.keyboard.press('Enter');
    }
    await launchArticle(page);expect(await page.evaluate(()=>window.history.length)).toBe(history+1);
    await page.screenshot({path:testInfo.outputPath('launch-guide-topic.png')});
    await page.goBack();await expect(page).toHaveURL(/#launch$/);await expect(page.locator('body')).toHaveClass(/page-route-launch/);
    await expect(page.locator('#token-name')).toHaveValue('QA guide preview');await expect(page.locator('#token-symbol')).toHaveValue('GUIDE');
    await page.goForward();await launchArticle(page);expect(await page.evaluate(()=>window.history.length)).toBe(history+1);
    expect(choosers).toBe(0);expect(errors).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  });
}
for(const width of[390,1440])test(`FQA-020 direct/reloaded launch topic and generic Docs/Next at ${width}px (mocked APIs)`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:900});
  await page.goto('/#docs/launch');await ready(page);await launchArticle(page);
  await page.reload();await ready(page);await launchArticle(page);
  await page.goto('/#docs');await ready(page);await expect(page.locator('#docs-guide-article h1')).toHaveText('What is funded.vip?');
  await expect(page.locator('.docs-guide-nav [aria-current="page"]')).toHaveText('What is funded.vip?');
  const next=page.locator('.docs-guide-next button'),title=await next.textContent();await next.click();
  await expect(page.locator('#docs-guide-article h1')).toHaveText(title);
  await expect(page.locator('.docs-guide-nav [aria-current="page"]')).toHaveText(title);
  await page.locator('.docs-guide-nav button',{hasText:'Launch a token'}).click();await launchArticle(page);
});
