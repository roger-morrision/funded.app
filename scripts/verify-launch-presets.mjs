import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
  // Layout and preset selection do not require RPC or connected accounts.
  await context.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Preset layout test: API unavailable"}' }));
  const page = await context.newPage();
  await page.goto(`${process.env.UI_BASE_URL || 'http://127.0.0.1:5173'}/#launch`, { waitUntil: 'commit' });
  await page.waitForSelector('body.page-route-launch');
  await page.waitForSelector('details.launch-optional-story');
  const optional = page.locator('details.launch-optional-story');
  const socialLinks = page.locator('.social-section');
  const quickProfile = page.locator('#launch-profile-fast');
  const communityProfile = page.locator('#launch-profile-community');
  const nameWarning = page.locator('#token-name-warning');
  const symbolWarning = page.locator('#token-symbol-warning');
  assert(await nameWarning.isHidden() && await symbolWarning.isHidden(), 'Identity warnings stay hidden before a violation.');
  await page.locator('#launch-next').click();
  assert(await nameWarning.isVisible(), 'An empty token name shows its warning after Continue.');
  await page.locator('#token-name').fill('Nova Protocol');
  assert(await nameWarning.isHidden(), 'A valid token name hides its warning.');
  await page.locator('#launch-next').click();
  assert(await symbolWarning.isVisible(), 'An empty ticker shows its warning after Continue.');
  await page.locator('#token-symbol').fill('BAD!');
  assert(await symbolWarning.isVisible(), 'An invalid ticker keeps its warning visible.');
  await page.locator('#token-symbol').fill('NOVA');
  assert(await symbolWarning.isHidden(), 'A valid ticker hides its warning.');
  assert(await optional.isVisible(), 'Optional story must be available in token details.');
  assert(await socialLinks.isVisible(), 'Social links must always be visible in token details.');
  assert(await quickProfile.isVisible() && await communityProfile.isVisible(), 'Both launch paths must be visible in token details.');
  assert.match(await quickProfile.innerText(), /80% creator share goes to your wallet/);
  assert.match(await communityProfile.innerText(), /wallet, holder rewards, and a verified X account/);
  await communityProfile.click();
  assert.equal(await communityProfile.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#launch-mode-custom').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#custom-policy').evaluate(el => el.hidden), false);
  assert.equal(await optional.evaluate(el => el.open), true);
  await page.locator('#creator-wallet-share').evaluate(el => { el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#holder-airdrop-share').evaluate(el => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await quickProfile.click();
  assert.equal(await quickProfile.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#launch-mode-quick').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.locator('#creator-wallet-share, #holder-airdrop-share, #x-share').evaluateAll(nodes => nodes.map(node => node.value)), ['80', '0', '0']);
  await optional.locator(':scope > summary').click();
  assert.equal(await page.locator('[data-page-infographic="launch"]').count(), 0, 'The launch banner must not push the form below the fold.');
  assert.deepEqual(await socialLinks.locator('label').allTextContents(), ['Website', 'X profile', 'Telegram', 'Discord']);
  assert(await socialLinks.evaluate(el => el.nextElementSibling?.matches('details.launch-optional-story')), 'Optional story must follow social links.');
  assert(await optional.evaluate(el => el.nextElementSibling?.matches('.launch-immutable-note')), 'Launch note must follow optional story.');
  for (const width of [360, 390, 700, 701, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await quickProfile.locator('p').evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 12, `Launch path explanation must be readable at ${width}px`);
    if (width <= 520) {
      const stepLabels = await page.locator('.launch-steps button > span').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent.trim(), fontSize: parseFloat(getComputedStyle(node).fontSize) })));
      assert.deepEqual(stepLabels.map(step => step.text), ['Token details', 'Launch settings', 'Review']);
      assert(stepLabels.every(step => step.fontSize >= 10), `Mobile step names must remain readable at ${width}px`);
    }
    assert(await socialLinks.locator('input:visible').count() === 4, `All social links are visible at ${width}px`);
    await optional.locator(':scope > summary').click();
    assert.equal(await optional.evaluate(el => el.open), true);
    assert(await page.locator('#token-description').isVisible());
    await optional.locator(':scope > summary').click();
    assert.equal(await optional.evaluate(el => el.open), false);
    assert(await socialLinks.locator('input:visible').count() === 4, `Social links remain visible with the story closed at ${width}px`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No overflow at ${width}px`);
  }
  console.log('Launch path fee selection, readable explanations, social links, and optional story pass at 5 widths without overflow. Local-only, API mocked unavailable, no signing.');
} finally {
  await browser.close();
}
