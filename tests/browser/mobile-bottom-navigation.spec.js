import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const mint = 'So11111111111111111111111111111111111111112';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => new URL(route.request().url()).pathname === '/api/fee-policy'
    ? route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }) : route.fulfill({ status: 503, json: { error: 'Controlled offline navigation fixture' } }));
});

for (const width of [360, 390, 700]) test(`mobile bottom links, drawer and content reserve at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/#overview'); await page.locator('body.product-flows-ready').waitFor();
  const nav = page.locator('.mobile-workspace-nav');
  await expect(nav).toBeVisible(); await expect(nav.getByRole('link')).toHaveCount(5);
  for (const [label, route] of [['Explore', 'explore'], ['Launch', 'launch'], ['Portfolio', 'my-launches'], ['Rewards', 'payments'], ['Home', 'overview']]) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`page-route-${route}(?: |$)`));
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    const geometry = await nav.evaluate(element => {
      const r = element.getBoundingClientRect(), main = document.querySelector('#main-content');
      return { top: r.top, bottom: r.bottom, width: r.width, viewportWidth: document.documentElement.clientWidth, position: getComputedStyle(element).position,
        reserve: parseFloat(getComputedStyle(main).paddingBottom), height: r.height,
        links: [...element.querySelectorAll('a')].map(link => { const q = link.getBoundingClientRect(); return { width: q.width, height: q.height }; }) };
    });
    expect(geometry.position).toBe('fixed'); expect(geometry.bottom).toBeCloseTo(844, 1); expect(geometry.width).toBeCloseTo(geometry.viewportWidth, 1);
    expect(geometry.reserve).toBeGreaterThan(geometry.height);
    for (const link of geometry.links) { expect(link.width).toBeGreaterThanOrEqual(44); expect(link.height).toBeGreaterThanOrEqual(44); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.locator('#open-menu').click(); await expect(nav).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape'); await expect(nav).not.toHaveAttribute('inert', '');
  await expect(page.locator('#open-menu')).toBeFocused();
  await page.evaluate(() => { location.hash = 'airdrops'; });
  await expect(nav.getByRole('link', { name: 'Rewards', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: info.outputPath('mobile-menu.png') });
  await nav.getByRole('link', { name: 'Rewards', exact: true }).focus();
  for (const desktopWidth of [701, 1440]) {
    await page.setViewportSize({ width: desktopWidth, height: 900 });
    await expect(page.locator('.mobile-workspace-nav')).toBeHidden(); await expect(page.locator('#sidebar')).toBeVisible();
    await expect(page.locator('#sidebar')).not.toHaveAttribute('inert', '');
    await expect(page.locator('#sidebar .nav-item[href="#payments"]')).toBeFocused();
  }
});

for (const { width, height } of [{ width: 360, height: 640 }, { width: 360, height: 844 }, { width: 390, height: 844 }]) test(`token actions stay above mobile links and restore focus at ${width}x${height}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height }); await page.goto(`/token/${mint}`);
  await page.locator('body.product-flows-ready.page-route-coin').waitFor();
  const nav = page.locator('.mobile-workspace-nav');
  const buy = nav.getByRole('button', { name: 'Buy', exact: true }), sell = nav.getByRole('button', { name: 'Sell', exact: true });
  await expect(nav.getByRole('link')).toHaveCount(5); await expect(buy).toBeVisible(); await expect(sell).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Explore', exact: true })).toHaveAttribute('aria-current', 'page');
  const geometry = await nav.evaluate(element => {
    const actions = element.querySelector('.mobile-trade-actions').getBoundingClientRect(), links = element.querySelector('.mobile-navigation-links').getBoundingClientRect();
    return { actionsBottom: actions.bottom, linksTop: links.top, reserve: parseFloat(getComputedStyle(document.querySelector('#main-content')).paddingBottom), height: element.getBoundingClientRect().height };
  });
  expect(geometry.actionsBottom).toBeLessThanOrEqual(geometry.linksTop); expect(geometry.reserve).toBeGreaterThan(geometry.height);
  for (const [button, side] of [[buy, 'buy'], [sell, 'sell']]) {
    await button.click(); await expect(page.locator('#trade-panel')).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#trade-side')).toHaveValue(side);
    await expect(nav).toHaveAttribute('inert', '');
    await page.getByRole('button', { name: 'Close trade', exact: true }).click();
    await expect(button).toBeFocused(); await expect(nav).not.toHaveAttribute('inert', '');
  }
  await page.screenshot({ path: info.outputPath('token-menu.png') });
  await nav.getByRole('link', { name: 'Portfolio', exact: true }).click();
  await expect(page).toHaveURL(/\/#my-launches$/); await expect(page.locator('body')).toHaveClass(/page-route-my-launches/);
  await expect(nav.locator('.mobile-trade-actions')).toBeHidden();
  await page.goBack(); await expect(page).toHaveURL(new RegExp(`/token/${mint}$`));
  await expect(buy).toBeVisible(); await expect(nav.getByRole('link', { name: 'Explore', exact: true })).toHaveAttribute('aria-current', 'page');
});
