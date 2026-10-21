import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const KEY = 'funded.app.watchlist.guest.v1';
const MINT = 'So11111111111111111111111111111111111111112';
const intro = 'Use the star on a token in Explore to add it to Favorites. Signed-out saving uses this browser; verify a wallet or sign in with X to sync across devices.';
const ids = ['watchlist-wallet-sync', 'watchlist-sign-in', 'watchlist-sync-retry'];
async function fixture(page, { mints = [], malformed = false, identity = 'guest', holdSync = false } = {}) {
  const writes = [], errors = []; let releaseSync, syncFails = false;
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://**/*', r => r.abort());
  await page.route('**/api/**', r => {
    const req = r.request(), path = new URL(req.url()).pathname;
    if (req.method() !== 'GET' && path !== '/api/solana/rpc') writes.push({ method: req.method(), path });
    return r.fulfill({ status: 503, json: { error: 'Offline presentation fixture' } });
  });
  await page.route('**/api/fee-policy', r => r.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
  await page.route('**/api/x/me', r => identity === 'checking' ? r.fulfill({ status: 503, json: {} }) : r.fulfill({ json: identity === 'account' ? { authenticated: true, configured: true, user: { id: '123', username: 'fixture' } } : { authenticated: false, configured: true } }));
  await page.route('**/api/watchlist?*', async r => {
    if (holdSync) await new Promise(resolve => { releaseSync = resolve; });
    return syncFails ? r.fulfill({ status: 503, json: { error: 'Fixture sync failure' } }) : r.fulfill({ json: { accountId: '123', csrf: 'fixture-only', mints: [MINT] } });
  });
  await page.addInitScript(({ key, mints, malformed }) => {
    if (!sessionStorage.getItem('favorites-guidance-seeded')) {
      localStorage.setItem(key, malformed ? '{' : JSON.stringify({ mints, importId: crypto.randomUUID(), targetAccount: null }));
      sessionStorage.setItem('favorites-guidance-seeded', 'true');
    }
  }, { key: KEY, mints, malformed });
  return { writes, errors, release: async () => { await expect.poll(() => Boolean(releaseSync)).toBe(true); holdSync = false; releaseSync(); }, failSync: () => { syncFails = true; } };
}
async function ready(page) {
  await page.goto('/#community');
  await page.locator('body.workspace-ready.product-experience-ready').waitFor();
  await page.evaluate(() => document.fonts.ready);
}
async function clearFocus(page, locator) {
  await expect(locator).toBeFocused();
  await expect.poll(() => locator.evaluate(e => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e), m = (parseFloat(s.outlineWidth) || 0) + Math.max(0, parseFloat(s.outlineOffset) || 0);
    const h = document.querySelector('.topbar'), n = document.querySelector('.mobile-workspace-nav');
    const top = h?.getClientRects().length ? h.getBoundingClientRect().bottom : 0, bottom = n?.getClientRects().length ? n.getBoundingClientRect().top : innerHeight;
    return m >= 2 && r.left - m >= -1 && r.right + m <= innerWidth + 1 && r.top - m >= top - 1 && r.bottom + m <= bottom + 1;
  })).toBe(true);
}
for (const width of [360, 390, 1440]) test(`Favorites native guidance and existing actions at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 }); const f = await fixture(page); await ready(page);
  const group = page.getByRole('group', { name: 'Sync across devices', exact: true }), controls = group.locator('button');
  await expect(page.locator('#favorites-title')).toHaveText('Favorite tokens');
  await expect(page.locator('#community .section-heading .panel-explainer')).toHaveText(intro);
  await expect(page.locator('#community .section-state')).toHaveText('Sign in to sync');
  expect(await controls.evaluateAll(es => es.map(e => e.id))).toEqual(ids);
  await expect(controls).toHaveText(['Verify wallet', 'Sign in with X', 'Refresh favorites']);
  const boxes = [];
  for (const id of ids) {
    const control = page.locator('#' + id); await expect(control).toBeEnabled();
    const r = await control.boundingBox(); boxes.push(r); expect(r.width).toBeGreaterThanOrEqual(44); expect(r.height).toBeGreaterThanOrEqual(44);
    expect(await control.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(14);
  }
  for (let i = 1; i < boxes.length; i++) {
    const a = boxes[i - 1], b = boxes[i]; expect(Math.max(b.x - a.x - a.width, b.y - a.y - a.height)).toBeGreaterThanOrEqual(7.9);
  }
  await controls.first().focus(); await clearFocus(page, controls.first());
  await page.keyboard.press('Tab'); await clearFocus(page, controls.nth(1));
  await page.keyboard.press('Tab'); await clearFocus(page, controls.nth(2));
  const summary = page.locator('#community summary').filter({ hasText: 'How the watchlist works' });
  await expect(summary.locator('..')).not.toHaveAttribute('open', '');
  await page.keyboard.press('Tab'); await expect(summary).toBeFocused(); await page.keyboard.press('Enter'); await expect(summary.locator('..')).toHaveAttribute('open', '');
  await page.keyboard.press('Enter'); await expect(summary.locator('..')).not.toHaveAttribute('open', '');
  const empty = page.locator('#watchlist-empty'), explore = empty.getByRole('link', { name: 'Explore tokens', exact: true });
  await expect(empty).toContainText('No favorite tokens'); await expect(empty.locator('p')).toHaveText('Select the star on a token in Explore to add it here.');
  const e = await explore.boundingBox(); expect(e.height).toBeGreaterThanOrEqual(44); expect(e.width).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Tab'); await clearFocus(page, explore); await expect(explore).toHaveAttribute('href', '#explore');
  await page.screenshot({ path: info.outputPath(`favorites-focus-${width}.png`) });
  await page.screenshot({ path: info.outputPath(`favorites-${width}.png`), fullPage: true });
  await page.keyboard.press('Enter'); await expect(page).toHaveURL(/#explore$/); await expect(page.locator('#explore')).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/#community$/); await expect(empty).toBeVisible();
  await expect(page.locator('#community')).toContainText('Followed wallets');
  // Presentation-only eligibility fixture: scoped display must honor native state.
  await controls.first().evaluate(e => { e.hidden = true; }); await expect(controls.first()).toBeHidden();
  await controls.nth(1).evaluate(e => { e.disabled = true; }); await expect(controls.nth(1)).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(f.errors).toEqual([]); expect(f.writes).toEqual([]);
});

test('Favorites keeps actual guest, checking, sync and storage states authoritative with mocked reads', async ({ browser }, info) => {
  for (const state of ['guest-populated', 'checking', 'storage-error', 'account-sync']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const f = await fixture(page, { mints: state === 'guest-populated' ? [MINT] : [], malformed: state === 'storage-error', identity: state === 'account-sync' ? 'account' : state === 'checking' ? 'checking' : 'guest', holdSync: state === 'account-sync' });
    try {
      await ready(page); const badge = page.locator('#community .section-state'), empty = page.locator('#watchlist-empty');
      await expect(page.getByRole('group', { name: 'Sync across devices', exact: true })).toBeVisible();
      await expect(page.locator('#community .section-heading .panel-explainer')).toHaveText(intro);
      if (state === 'guest-populated') { await expect(badge).toHaveText('Sign in to sync'); await expect(empty).toBeHidden(); await expect(page.locator('#watchlist-items')).toContainText('This token remains in your favorites.'); }
      if (state === 'checking') { await expect(badge).toHaveText('Checking sign-in'); await expect(page.locator('#community [data-watchlist-status]')).toContainText('Checking sign-in before loading favorites.'); }
      if (state === 'storage-error') { await expect(badge).toHaveText('Sync unavailable'); await expect(empty).toBeHidden(); expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe('{'); }
      if (state === 'account-sync') {
        await expect(badge).toHaveText('Syncing'); await expect(page.locator('#watchlist-sign-in')).toBeHidden();
        await f.release(); await expect(badge).toHaveText('Synced to account'); await expect(empty).toBeHidden();
        await expect(page.locator('#watchlist-items')).toContainText('This token remains in your favorites.');
        f.failSync(); await page.locator('#watchlist-sync-retry').focus(); await page.keyboard.press('Enter');
        await expect(badge).toHaveText('Sync unavailable'); await expect(empty).toBeHidden();
        await expect(page.locator('#watchlist-items')).toContainText('This token remains in your favorites.');
        await expect(page.locator('#community [data-watchlist-status]')).toHaveText('Fixture sync failure');
      }
      await page.screenshot({ path: info.outputPath(`favorites-${state}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); expect(f.errors).toEqual([]); expect(f.writes).toEqual([]);
    } finally { await page.close(); }
  }
});
