import { test, expect } from '@playwright/test';

for (const [label, operations, community] of [['current 8/4', 40, 20], ['saved override 6/6', 30, 30]]) {
  test(`all fee pages use ${label} and distinguish collection from funded payments`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ status:503, json:{ error:'Offline policy-copy fixture' } }));
    await page.route('**/api/fee-policy', async route => {
      await new Promise(resolve => setTimeout(resolve, 150));
      await route.fulfill({ json:{ revision:44, split:{ operationsPercent:operations,
        referralLevelPercents:[10, 3, 2], communityPercent:community, buybackPercent:25 } } });
    });
    await page.route('https://**/*', route => route.abort());
    await page.goto('/#capital-flow');
    await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    const ops = operations / 5, bonus = community / 5;
    await expect(page.locator('#fee-output-operations')).toHaveText(`${ops} SOL`);
    await expect(page.locator('#fee-output-community')).toHaveText(`${bonus} SOL`);
    await expect(page.locator('#daily-bonus-dashboard')).toContainText(`${bonus}% Daily bonus pool`);
    await expect(page.locator('#daily-bonus-dashboard')).toContainText('completed UTC day closes at 00:00 UTC');
    await expect(page.locator('#capital-flow .route-timeline')).toContainText('creator signs settlement');
    await expect(page.locator('#capital-flow .panel-explainer').first()).toContainText('Existing coins');
    await expect(page.locator('[data-money-flow-poster="distribution"] .money-flow-steps').first()).toContainText(`${ops}% Operations & marketing`);
    await expect(page.locator('[data-money-flow-poster="distribution"] .money-flow-steps').first()).toContainText(`${bonus}% Daily bonus`);
    await page.evaluate(() => { location.hash = 'analytics-detail'; });
    await expect(page.locator('#analytics-detail')).toBeVisible();
    await expect(page.locator('.allocation-chips')).toContainText(`${ops}%Operations & marketing`);
    await expect(page.locator('.allocation-chips')).toContainText(`${bonus}%Daily bonus`);
    await page.evaluate(() => { location.hash = 'overview'; });
    await expect(page.locator('#fee-policy-faq')).toContainText(`Operations & marketing (${ops}%)`);
    await expect(page.locator('#fee-policy-faq')).toContainText(`Daily bonus (${bonus}%)`);
    await page.evaluate(() => { location.hash = 'launch'; });
    await expect(page.locator('.launch-fee-options .benefit-grid article:last-child small')).toContainText(`${ops}% Operations & marketing`);
    await expect(page.locator('.launch-fee-options .benefit-grid article:last-child small')).toContainText(`${bonus}% Daily bonus`);
    await page.evaluate(() => { location.hash = 'payments'; });
    await expect(page.getByRole('link', { name:/Daily bonus · payout history/ })).toBeVisible();
    await expect(page.getByRole('link', { name:/Daily bonus · payout history/ })).toHaveAttribute('href', '#bonuses');
    await expect(page.locator('.reward-upcoming-note')).toContainText('referral payouts are creator signed');
    await page.evaluate(() => { location.hash = 'paid'; });
    await expect(page.locator('#paid .app-revenue-grid')).toContainText(`${ops}% of gross fees`);
    await expect(page.locator('#paid .app-revenue-grid')).toContainText(`${bonus}% of gross fees`);
    await expect(page.locator('#paid .revenue-model > .field-help')).toContainText('not reassigned to another inviter or added to the Daily bonus pool');
    await page.evaluate(() => { location.hash = 'referrals'; });
    await expect(page.locator('#referral-faq')).toContainText('not reassigned to another inviter or added to the Daily bonus pool');
    await page.evaluate(() => { location.hash = 'docs/fees'; });
    const guide = page.locator('#docs-guide-article');
    await expect(guide).toBeVisible();
    await expect(guide).toContainText(`${ops}% Operations & marketing`);
    await expect(guide).toContainText(`${bonus}% Daily bonus`);
    await expect(guide).toContainText('creator reviews and signs settlement');
    await expect(guide).toContainText('Standard payouts are hourly');
    await expect(guide).toContainText('selected Devnet QA coins use five-minute cycles');
    await expect(guide).toContainText('separate community airdrop uses launched coin tokens');
    await expect(guide).toContainText('configured aggregate trigger');
    await page.setViewportSize({ width:390, height:844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path:test.info().outputPath('fee-guide-mobile.png'), fullPage:true });
    expect(errors).toEqual([]);
  });
}
