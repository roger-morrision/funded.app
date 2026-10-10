import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Offline QA fixture"}' }));
  await page.route('https://**/*', route => route.abort());
});

for (const width of [1440, 390]) test(`launch package and X previews update at ${width}px`, async ({ page }) => {
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
  await page.locator('.creator-burn-card[data-burn-tier="pro"]').click();
  await expect(page.locator('.launch-package-preview')).toBeVisible();
  await expect(page.locator('#launch-package-example')).toHaveAttribute('data-tier', 'pro');
  await expect(page.locator('#launch-x-post-preview')).toContainText('Pro launch');
  await page.locator('.creator-burn-card[data-burn-tier="premier"]').click();
  await expect(page.locator('#launch-package-example')).toHaveAttribute('data-tier', 'premier');
  await expect(page.locator('#launch-x-post-count')).toHaveText('2 posts');
  await expect(page.locator('#launch-x-followup')).toBeVisible();
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
  await expect(page.locator('#launch-summary-protocol')).toHaveText('20%');
  await page.locator('#creator-buy-sol').fill('0.5');
  await expect(page.locator('#preview-creator-buy')).toContainText('0.5 SOL');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Home opens the live launch form and old pilot links resolve there', async ({ page }) => {
  await page.goto('/#overview');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const create = page.locator('.hero-actions a[href="#launch"]');
  await expect(create).toHaveAttribute('href', '#launch');
  await expect(create).toHaveText(/Launch a token/);
  await expect(page.locator('.home-hero-kicker')).not.toContainText(/pilot|devnet/i);
  await create.click();
  await expect(page.locator('#launch-route-shell')).toBeVisible();
  await page.goto('/#pilot');
  await expect(page.locator('#launch-route-shell')).toBeVisible();
});
