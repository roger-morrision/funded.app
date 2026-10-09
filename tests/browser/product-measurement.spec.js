import { test, expect } from '@playwright/test';

// The retired pilot UI must stay absent, including for returning users who
// previously enabled recording. These requests are mocked, not chain evidence.
for (const width of [390, 1440]) for (const legacyConsent of [false, true]) {
  test(`retired pilot does not record or appear at ${width}px with legacy consent ${legacyConsent}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('https://**/*', route => route.abort());
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
    const events = [];
    await page.route('**/api/product-events', route => {
      events.push(route.request().postDataJSON());
      return route.fulfill({ json: { accepted: true } });
    });
    await page.addInitScript(enabled => {
      localStorage.setItem('funded.journeys.consent.v1', String(enabled));
      localStorage.setItem('funded.diagnostics.enabled', String(enabled));
    }, legacyConsent);
    await page.goto('/#community');
    await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
    await expect(page.locator('#community-preferences, #journey-consent, .journey-preferences')).toHaveCount(0);
    await page.evaluate(() => {
      for (const name of ['launch_review', 'trade_confirmed', 'boost_open']) {
        window.dispatchEvent(new CustomEvent('funded:product-event', { detail: { name } }));
      }
    });
    await page.goto('/#launch');
    await expect(page.locator('#token-name')).toBeVisible();
    await page.locator('#token-name').fill('Privacy QA');
    await expect(page.locator('#token-name')).toHaveValue('Privacy QA');
    expect(events).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
