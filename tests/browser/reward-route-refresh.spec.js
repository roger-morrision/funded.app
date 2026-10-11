import { test, expect } from '@playwright/test';

test('rapid section navigation reuses reward evidence while identity changes refresh it', async ({ page }) => {
  let rewardRequests = 0;
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'offline fixture' } }));
  await page.route('**/api/rewards/experience*', route => {
    rewardRequests += 1;
    return route.fulfill({ json: { cluster: 'devnet', evidence: { status: 'no-records' }, tokens: [], events: [] } });
  });
  await page.goto('/#overview');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect.poll(() => rewardRequests).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  const initial = rewardRequests;
  for (const hash of ['explore', 'payments', 'community', 'docs', 'privacy', 'terms',
    'disclosures', 'opt-out', 'buybacks', 'capital-flow', 'leaderboard', 'overview']) {
    await page.evaluate(next => { location.hash = next; }, hash);
  }
  await page.waitForTimeout(300);
  expect(rewardRequests - initial, 'Same-scope navigation should not exhaust the reward API budget.').toBeLessThanOrEqual(1);
  const afterNavigation = rewardRequests;
  await page.evaluate(() => window.dispatchEvent(new Event('funded:reward-identity-change')));
  await expect.poll(() => rewardRequests).toBeGreaterThan(afterNavigation);
});
