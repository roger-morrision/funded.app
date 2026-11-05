import { test, expect } from '@playwright/test';
import { FEE_DISTRIBUTION } from '../../distribution-policy.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

test.beforeEach(async ({ page, baseURL }) => {
  await page.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
  await page.route('**/api/**', route => new URL(route.request().url()).pathname === '/api/fee-policy'
    ? route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}})
    : route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Offline QA fixture"}' }));
  await page.route('https://**/*', route => route.request().method()==='GET' && new URL(route.request().url()).origin===new URL(baseURL).origin ? route.fallback() : route.abort());
});

test('launch stays blocked when V3 readiness is unavailable', async ({ page }) => {
  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/api/')) requests.push(new URL(request.url()).pathname);
  });
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#fee-router-status')).toContainText('Launch blocked:');
  await expect(page.locator('#launch-button')).toBeDisabled();
  expect(requests).toContain('/api/v3-launch-config');
  expect(requests).not.toContain('/api/mint-router/status');
});

test('protocol allocation copy agrees across FAQ, buyback, and fee flow', async ({ page }) => {
  const buyback = FEE_DISTRIBUTION.buybackEffectivePercent;
  await page.goto('/#capital-flow');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#fee-policy-faq')).toContainText(`${buyback}% $FUNDED buyback & burn`);


  await expect(page.locator('.home-receipt-card .receipt-rows span').last()).toHaveText(`${buyback} SOL Buyback allocation`);
  await expect(page.locator('.fee-route-bar i.burn')).toHaveAttribute('style', new RegExp(`width:\\s*${buyback}%`));
});

for (const width of [1440, 390, 320]) test(`launch package and X previews update at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#launch-route-shell')).toBeVisible();
  await page.locator('#token-name').fill('Sample Coin');
  await page.locator('#token-symbol').fill('SAMPLE');
  await expect(page.locator('#preview-name')).toHaveText('Sample Coin');
  await expect(page.locator('#preview-symbol')).toHaveText('SAMPLE');
  await expect(page.locator('#launch-x-post-preview')).toContainText('Sample Coin');
  await page.locator('#launch-next').click();
  await expect(page.locator('.launch-fee-options')).toHaveCount(0);
  const disclosure=page.locator('#launch-presentation-preview'), summary=disclosure.locator(':scope > summary');
  await expect(summary).toHaveCount(0);await expect(page.locator('#launch-package-example')).toBeVisible();

  if(width<700){
    await expect(page.locator('#wizard-hint')).toBeVisible();
    const layout=await page.locator('#wizard-hint').evaluate(e=>{const hint=e.getBoundingClientRect(),row=e.parentElement.getBoundingClientRect(),back=document.getElementById('launch-back').getBoundingClientRect();return{width:hint.width,rowWidth:row.width,bottom:hint.bottom,backTop:back.top};});
    expect(layout.width).toBeGreaterThanOrEqual(layout.rowWidth-2);expect(layout.bottom).toBeLessThanOrEqual(layout.backTop);
  }
  await page.screenshot({path:info.outputPath(`launch-options-${width}.png`),fullPage:true});

  await expect(page.locator('#launch-package-example')).toBeVisible();
  await page.locator('.creator-burn-card[data-burn-tier="pro"]').click();
  await expect(page.locator('.launch-package-preview')).toBeVisible();
  await expect(page.locator('#launch-package-example')).toHaveAttribute('data-tier', 'pro');
  await expect(page.locator('#launch-x-post-preview')).toContainText('Pro launch');
  await page.locator('.creator-burn-card[data-burn-tier="premier"]').click();
  await expect(page.locator('#launch-package-example')).toHaveAttribute('data-tier', 'premier');
  await expect(page.locator('#launch-x-post-count')).toHaveText('2 posts');
  await expect(page.locator('#launch-x-followup')).toBeVisible();


  await page.locator('.creator-burn-card[data-burn-tier="standard"]').click();

  await expect(page.locator('#preview-name')).toHaveText('Sample Coin');await expect(page.locator('#launch-x-post-count')).toHaveText('1 post');
  await expect(page.locator('#launch-button')).toBeDisabled();await expect(page.locator('#launch-agency-options .agency-included-list li')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1440, 390]) test(`launch preview stays readable when optional page styles are unavailable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/page-experience.css', route => route.abort());
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('#token-name').fill('Sample Coin');
  await page.locator('#token-symbol').fill('SAMPLE');
  await page.locator('#launch-next').click();
  await expect(page.locator('#launch-presentation-preview > summary')).toHaveCount(0);
  await expect(page.locator('#launch-package-example')).toBeVisible();
  const preview = page.locator('.launch-package-preview');
  await expect(preview).toBeVisible();
  const boxes = await preview.evaluate(node => {
    const token = node.querySelector('.launch-package-example').getBoundingClientRect();
    const post = node.querySelector('.launch-x-example').getBoundingClientRect();
    return { grid: getComputedStyle(node.querySelector('.launch-package-preview-grid')).display,
      art: getComputedStyle(node.querySelector('.launch-package-example-art')).display,
      token: { left: token.left, right: token.right, top: token.top, bottom: token.bottom },
      post: { left: post.left, right: post.right, top: post.top, bottom: post.bottom },
      previewRight: node.getBoundingClientRect().right };
  });
  expect(boxes.grid).toBe('grid');
  expect(boxes.art).toBe('none');
  expect(boxes.previewRight).toBeLessThanOrEqual(width);
  if (width > 760) expect(boxes.token.right).toBeLessThan(boxes.post.left);
  else expect(boxes.token.bottom).toBeLessThan(boxes.post.top);
  await expect(page.locator('#preview-name')).toHaveText('Sample Coin');
  await expect(page.locator('#launch-x-post-preview')).not.toContainText('{mint-after-launch}');
  await page.locator('.creator-burn-card[data-burn-tier="pro"]').click();
  await expect(page.locator('#launch-package-example-art')).toBeVisible();
});

for (const width of [1440, 390]) test(`launch review lives in the right summary at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('[data-launch-step-target]')).toHaveCount(2);
  await expect(page.locator('[data-launch-step="3"]')).toHaveCount(0);
  await expect(page.locator('#launch-button')).toBeHidden();
  await page.locator('#token-name').fill('Sample Coin');
  await page.locator('#token-symbol').fill('SAMPLE');
  await page.locator('#launch-next').click();
  await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step', '2');
  await expect(page.locator('#launch-next')).toBeHidden();
  await expect(page.locator('#launch-button')).toBeVisible();
  await expect(page.locator('#fee-route-agree')).toBeVisible();
  await expect(page.locator('#launch-summary-name')).toHaveText('Sample Coin');
  await expect(page.locator('#launch-summary-symbol')).toHaveText('SAMPLE');
  await expect(page.locator('#launch-summary-creator')).toHaveText('80%');
  await expect(page.locator('[data-fee-fixed-list="launch-review"] [data-fixed-fee-category="operations"] dd')).toHaveText('8%');
  await page.locator('#creator-buy-sol').fill('0.5');
  await expect(page.locator('#preview-creator-buy')).toContainText('0.5 SOL');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Home opens the live launch form and old pilot links resolve there', async ({ page }) => {
  await page.goto('/#overview');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const create = page.locator('.hero-actions a[href="#launch"]:not([data-launch-for-x])');
  await expect(create).toHaveAttribute('href', '#launch');
  await expect(create).toHaveText(/Launch a coin/);
  await expect(page.locator('.home-hero-kicker')).not.toContainText(/pilot|devnet/i);
  await create.click();
  await expect(page.locator('#launch-route-shell')).toBeVisible();
  await page.goto('/#pilot');
  await expect(page.locator('#launch-route-shell')).toBeVisible();
});

test('Home phone hero exposes the current launch and explore actions',async({page})=>{
 await page.setViewportSize({width:375,height:812});await page.goto('/#overview');await page.locator('body.product-flows-ready').waitFor();
 const actions=page.locator('.hero-actions');await expect(actions.getByRole('link',{name:'Launch a coin',exact:true})).toBeVisible();await expect(actions.getByRole('link',{name:'Explore coins',exact:true})).toBeVisible();await expect(actions.locator('[data-launch-for-x]')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
