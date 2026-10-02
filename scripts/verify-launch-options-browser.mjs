import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
  await context.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"QA API unavailable"}' }));
  const page = await context.newPage();
  await page.goto(`${process.env.UI_BASE_URL || 'http://127.0.0.1:4177'}/#launch`);
  await page.waitForSelector('body.workspace-ready');
  await page.locator('#token-name').fill('Launch options QA');
  await page.locator('#token-symbol').fill('LOQA');
  await page.locator('#launch-next').click();
  assert(await page.locator('[data-launch-step="2"]').isVisible(), 'Settings step must open with valid token details.');

  const advanced = page.locator('#launch-advanced-options');
  await advanced.locator(':scope > summary').click();
  for (const tier of ['standard', 'boost', 'pro', 'premier']) {
    const choice = page.locator(`button[data-burn-tier="${tier}"]`);
    await choice.click();
    assert.equal(await choice.getAttribute('aria-pressed'), 'true', `${tier} choice did not select`);
    assert.equal((await page.locator('#preview-burn-tier').textContent()).trim(), tier.toUpperCase());
    assert.equal(await page.locator('#cost-burn-row').isVisible(), tier !== 'standard');
  }
  await page.locator('button[data-burn-tier="standard"]').click();
  for (const [tokens, percent] of [['30000000', '3%'], ['50000000', '5%'], ['500000000', '50%']]) {
    if (tokens === '500000000') await page.locator('#community-airdrop-tokens').fill(tokens);
    else await page.locator(`[data-airdrop-tokens="${tokens}"]`).click();
    assert.equal(await page.locator('#community-airdrop-tokens').inputValue(), tokens);
    assert.equal((await page.locator('#preview-community').textContent()).trim(), percent);
  }
  await page.locator('#creator-buy-sol').fill('0.01');
  assert.match(await page.locator('#preview-creator-buy').textContent(), /0\.01 SOL/);
  await page.locator('#launch-mode-custom').click();
  assert.equal(await page.locator('#launch-mode-custom').getAttribute('aria-pressed'), 'true');
  await page.locator('#creator-wallet-share').fill('60');
  await page.locator('#holder-airdrop-share').fill('20');
  await page.locator('#launch-next').click();
  assert(await page.locator('[data-launch-step="3"]').isVisible(), 'Balanced custom policy must reach review.');
  assert.equal((await page.locator('#review-holder-share').textContent()).trim(), '20%');
  assert.equal((await page.locator('#review-community').textContent()).trim(), '50%');

  await page.locator('#launch-back').click();
  await page.locator('#holder-airdrop-share').fill('10');
  await page.locator('#x-share').fill('10');
  await page.locator('#x-recipient').fill('@fundedqa');
  await page.locator('#launch-next').click();
  assert(await page.locator('[data-launch-step="2"]').isVisible(), 'Unavailable X rewards must block review.');
  assert.match(await page.locator('#wizard-hint').textContent(), /X account rewards unavailable/);
  console.log('Launch options browser matrix: 4 tiers, 3 allocations, developer buy, holder split, review summary, and X reward gate passed. Local-only; API mocked unavailable; no signing.');
} finally {
  await browser.close();
}
