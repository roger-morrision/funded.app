import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
import { adminFixture } from './admin-review-fixture.js';

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Offline fixture' } }));
  await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
});

test('admin starts with its balance summary and aligns wallet amounts', async ({ page }) => {
  await adminFixture(page);
  await page.goto('/admin.html');
  await expect(page.locator('#summary strong')).toHaveCount(3);
  await expect(page.locator('#workspace > :first-child')).toHaveAttribute('id', 'summary');
  await expect(page.locator('.admin-wallet-table tbody td:nth-child(4)').first()).toHaveCSS('text-align', 'right');
});

test('Explore keeps the selected launch stage, sort and view after reload', async ({ page }) => {
  await page.goto('/#explore');
  await page.locator('body.product-flows-ready').waitFor();
  await page.locator('.explore-tabs [data-explore-tab="new"]').click();
  const lane = page.locator('[data-explore-lane="almost"]');
  await lane.click();
  await page.locator('#explore-sort').selectOption('boosted');
  await page.locator('[data-explore-view="table"]').click();
  await page.reload();
  await expect(lane).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#explore-sort')).toHaveValue('boosted');
  await expect(page.locator('#explore')).toHaveAttribute('data-explore-view', 'table');
  await page.goto('/explore?filters=1&f.tab=new&f.lane=migrated');
  await expect(page.locator('[data-explore-lane="migrated"]')).toHaveAttribute('aria-pressed', 'true');
});

test('the agency page precedes its footer and narrow controls fit their labels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/#marketing-agency');
  await page.locator('body.product-flows-ready').waitFor();
  const agency = await page.locator('#marketing-agency').boundingBox();
  const footer = await page.locator('.site-footer').boundingBox();
  expect(footer.y).toBeGreaterThanOrEqual(agency.y + agency.height - 1);
  for (const [route, controls] of [
    ['launch', '#connect-button, .launch-steps button'],
    ['explore', '.explore-tabs button'],
    ['leaderboard', '.leaderboard-tabs button'],
  ]) {
    await page.evaluate(hash => { location.hash = hash; }, route);
    await page.locator('body.page-route-' + route).waitFor();
    for (const control of await page.locator(controls).all()) {
      await expect(control).toBeVisible();
      expect(await control.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
  }
});

test('call feed distinguishes an outage, empty results and stale results after a refresh', async ({ page }) => {
  let available = false;
  await page.route('**/api/callouts', route => route.fulfill(available
    ? { json: { callouts: [], topCallers: [], serverTime: '2026-11-07T00:00:00Z' } }
    : { status: 503, json: { error: 'Offline fixture' } }));
  await page.goto('/#callouts');
  const status = page.locator('#callouts-status');
  await expect(status).toHaveText('Calls are unavailable. Retrying automatically.');
  await expect(page.locator('.callouts-columns')).toBeHidden();
  available = true;
  await expect(page.locator('[data-callouts-list="latest"]')).toContainText('No calls yet');
  await expect(page.locator('.callouts-columns')).toBeVisible();
  available = false;
  await expect(status).toContainText('Showing the last loaded calls.');
  await page.locator('[data-callouts-filter="mine"]').click();
  await expect(status).toContainText('Showing the last loaded calls.');
  await expect(page.locator('[data-callouts-list="latest"]')).toContainText('Connect a wallet');
});
