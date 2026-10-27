import {requiredFeePolicyForCompiled} from '../fixtures/compiled-artifact-fixture.js';
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => requiredFeePolicyForCompiled(route) ?? route.fulfill({
    status: 503,
    json: { error: 'Controlled offline fixture' },
  }));
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
});

test('UX-012 notification dialog has its visible name and preserves desktop close behavior', async ({ page }) => {
  const trigger = page.locator('#notifications-button');
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Reward notifications' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Reward notifications' })).toBeVisible();
  await expect(page.locator('#notification-title')).toHaveCount(1);
  const close = dialog.getByRole('button', { name: 'Close notifications' });
  await expect(close).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('UX-012 responsive open dialog keeps its name across controlled content states', async ({ page }) => {
  await page.locator('#notifications-button').click();
  await page.setViewportSize({ width: 390, height: 844 });

  const dialog = page.getByRole('dialog', { name: 'Reward notifications' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#notifications-button')).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Close notifications' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // DOM-only fixtures; these do not represent delivered notification or authentication states.
  for (const content of ['', 'Controlled notification item', 'Notifications unavailable']) {
    await dialog.locator('.notice-list').evaluate((node, value) => { node.textContent = value; }, content);
    await expect(page.getByRole('dialog', { name: 'Reward notifications' })).toBeVisible();
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
