import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const aliases = [['rewards', 'payments'], ['portfolio', 'my-launches'], ['listing', 'list'], ['listings', 'list'], ['get-listed', 'list'], ['leaderboards', 'leaderboard'], ['referral', 'referrals'], ['airdrop', 'airdrops']];

test('sidebar-label hashes open their page instead of falling back to Home (mocked APIs)', async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => new URL(route.request().url()).pathname === '/api/fee-policy'
    ? route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } })
    : route.fulfill({ status: 503, json: { error: 'Offline alias fixture' } }));
  for (const [alias, target] of aliases) {
    await page.goto(`/#${alias}`);
    await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await expect(page.locator('body')).toHaveClass(new RegExp(`page-route-${target}(?: |$)`));
    await expect(page.locator(`#sidebar .nav-item[href="#${target}"]`).first()).toHaveAttribute('aria-current', 'page');
  }
});

test('unknown hashes fall back to Home with a notice, known links stay quiet (mocked APIs)', async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => new URL(route.request().url()).pathname === '/api/fee-policy'
    ? route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } })
    : route.fulfill({ status: 503, json: { error: 'Offline alias fixture' } }));
  await page.goto('/#no-such-page');
  await expect(page.locator('body')).toHaveClass(/page-route-overview(?: |$)/);
  await expect(page.locator('#toast')).toHaveText('Page not found. Showing Home instead.');
  for (const hash of ['overview', 'main-content', 'leaderboard']) {
    await page.goto(`/#${hash}`);
    await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await expect(page.locator('#toast')).not.toHaveText('Page not found. Showing Home instead.');
  }
});
