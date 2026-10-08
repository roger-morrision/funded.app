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
  assert(await page.locator('[data-launch-step="1"]').isVisible(), 'Coin details must be visible on the create page.');
  assert.equal(await page.locator('[data-launch-step-target]').count(), 2, 'Launch must have two steps.');
  assert.equal(await page.locator('[data-launch-step="3"]').count(), 0, 'The old review panel must be removed.');
  await page.locator('#token-name').fill('Launch options QA');
  await page.locator('#token-symbol').fill('LOQA');
  await page.locator('#launch-next').click();
  assert(await page.locator('[data-launch-step="2"]').isVisible(), 'Launch settings must be visible after token details.');
  assert(await page.locator('#launch-button').isVisible(), 'The launch action must be visible on Step 2.');
  assert.equal(await page.locator('#launch-button').getAttribute('data-launch-action'), 'connect-wallet');

  const advanced = page.locator('.launch-fee-options');
  assert.equal(await page.locator('.creator-burn-card[data-burn-tier]').count(), 3);
  assert.equal(await page.locator('.creator-burn-card[data-burn-tier="boost"]').count(), 0);
  for (const tier of ['standard', 'pro', 'premier']) {
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
  await advanced.locator(':scope > summary').click();
  await page.locator('#launch-mode-custom').click();
  assert.equal(await page.locator('#launch-mode-custom').getAttribute('aria-pressed'), 'true');
  await page.locator('#creator-wallet-share').fill('60');
  await page.locator('#holder-airdrop-share').fill('20');
  assert.equal((await page.locator('#launch-summary-creator').textContent()).trim(), '60%');
  assert.equal((await page.locator('#launch-summary-holders').textContent()).trim(), '20%');
  assert.equal(await page.locator('#launch-button').getAttribute('data-launch-action'), 'connect-wallet', 'Balanced policy must allow wallet connection.');

  await page.locator('#holder-airdrop-share').fill('10');
  await page.locator('#x-share').fill('10');
  assert.equal((await page.locator('#launch-summary-x').textContent()).trim(), '10%');
  await page.locator('#x-recipient').fill('@fundedqa');
  assert(await page.locator('#launch-button').isDisabled(), 'Unavailable X rewards must block wallet connection.');
  assert.match(await page.locator('#launch-button').textContent(), /X account rewards unavailable/);
  console.log('Launch options browser matrix: two-step form, live summary, 3 tiers, 3 allocations, developer buy, holder split, and X reward gate passed. Local-only; API mocked unavailable; no signing.');
} finally {
  await browser.close();
}
