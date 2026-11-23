// Interactive flow checks without a wallet (npm run review:flows; REVIEW_BASE_URL picks the site).
// script errors or failed API reads that happened during the step.
import { chromium } from '@playwright/test';
const BASE = process.env.REVIEW_BASE_URL || 'https://richpad.fun';
const MINT = '85RhcSEMy15SNhFLmSArNm7udPKXVagVgsq4YmSopump';
const browser = await chromium.launch();
const results = [];
const record = row => { results.push(row); console.log(row); };
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(20_000);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror ' + e.message.slice(0, 140)));
  page.on('response', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && r.status() >= 400 && ![404, 429].includes(r.status())) errors.push(`${r.status()} ${u.pathname}`); });
  const go = async path => { await page.goto(BASE + path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500); };
  const step = async (name, fn) => {
    const before = errors.length;
    try { const out = await fn(); record(`${viewport.width} OK   ${name}: ${out ?? ''}`); }
    catch (e) { record(`${viewport.width} FAIL ${name}: ${e.message.split('\n')[0].slice(0, 160)}`); }
    if (errors.length > before) record(`       errors: ${[...new Set(errors.slice(before))].join(' | ')}`);
  };
  const text = sel => page.locator(sel).first().innerText({ timeout: 3000 }).then(t => t.replace(/\s+/g, ' ').trim());

  await step('header search finds a token', async () => {
    await go('/');
    await page.getByRole('button', { name: 'Search launches' }).click({ timeout: 3000 });
    await page.waitForTimeout(500);
    await page.keyboard.type('bill'); await page.waitForTimeout(2500);
    const hit = await page.locator('dialog[open] :is(a, button, li):visible, [role="dialog"] :is(a, button, li):visible', { hasText: /\$bill/i }).count();
    if (!hit) throw new Error('no result containing "bill"'); return `${hit} result(s)`;
  });
  await step('Explore search filters cards', async () => {
    await go('/#explore');
    const before = await page.locator('#explore .token-card-shell:visible, #explore article:visible').count();
    await page.locator('#explore input[type="search"]').first().fill('FLC'); await page.waitForTimeout(2000);
    const after = await page.locator('#explore .token-card-shell:visible, #explore article:visible').count();
    if (!(after > 0 && after < before)) throw new Error(`cards ${before} -> ${after}`); return `${before} -> ${after} cards`;
  });
  // Explore remembers its search between visits; clear it so steps don't inherit one.
  const clearExploreSearch = async () => { await page.locator('#explore input[type="search"]').first().fill(''); await page.waitForTimeout(1200); };
  await step('Explore table view', async () => {
    await go('/#explore'); await clearExploreSearch();
    const table = page.locator('#explore button', { hasText: /^Table$/ }).first();
    if (!await table.isVisible()) return 'no Table toggle on this width';
    await table.click(); await page.waitForTimeout(1500);
    const rows = await page.locator('#explore table tbody tr:visible').count();
    if (!rows) throw new Error('no table rows'); return `${rows} rows`;
  });
  await step('Explore tabs switch', async () => {
    await go('/#explore'); await clearExploreSearch();
    const out = [];
    for (const label of ['New · 12h', 'Favorites', 'Paid list', 'Trending']) {
      const tab = page.locator('#explore :is(button,a)', { hasText: label }).first();
      if (!await tab.isVisible().catch(() => false)) { out.push(`${label}:hidden`); continue; }
      await tab.click(); await page.waitForTimeout(1200);
      // Grid or table: Explore also remembers the chosen view.
      const cards = await page.locator('#explore .token-card-shell:visible, #explore table tbody tr:visible').count();
      const empty = await page.locator('#explore .empty-state:visible, #explore [class*="empty"]:visible').first().innerText().catch(() => '');
      out.push(`${label}:${cards}${cards ? '' : ' "' + empty.replace(/\s+/g, ' ').slice(0, 50) + '"'}`);
    }
    return out.join(', ');
  });
  await step('favorite star without wallet', async () => {
    await go(`/token/${MINT}`);
    const star = page.locator('#coin-watch');
    await star.click(); await page.waitForTimeout(1200);
    const pressed = await star.getAttribute('aria-pressed');
    const stored = await page.evaluate(() => localStorage.getItem('richpad.favorites.guest'));
    if (pressed === 'true') await star.click();
    if (pressed !== 'true') throw new Error('star did not turn on without a wallet');
    return `pressed=${pressed}, saved in browser: ${stored ? 'yes' : 'no'}`;
  });
  await step('token chart ranges', async () => {
    await go(`/token/${MINT}`);
    const out = [];
    for (const r of ['5m', '1h', '6h', '24h']) {
      const b = page.locator('.coin-chart-panel button, [data-chart-range]', { hasText: new RegExp(`^${r}$`) }).first();
      if (!await b.isVisible().catch(() => false)) { out.push(`${r}:missing`); continue; }
      await b.click(); await page.waitForTimeout(900);
      out.push(`${r}:${await b.getAttribute('aria-pressed') ?? (await b.getAttribute('class'))?.includes('active')}`);
    }
    return out.join(' ');
  });
  await step('token tabs Chat/Trades/Holders', async () => {
    await go(`/token/${MINT}`);
    const out = [];
    for (const t of ['chat', 'trades', 'holders']) {
      await page.locator(`[data-coin-tab="${t}"]`).first().click(); await page.waitForTimeout(1500);
      const content = (await text('#coin-activity-list').catch(() => '')).slice(0, 40);
      out.push(`${t}:${content ? 'ok' : 'EMPTY'}`);
    }
    return out.join(' ');
  });
  await step('trade amount and quote without wallet', async () => {
    await go(`/token/${MINT}`);
    const preset = page.locator('button', { hasText: /^0\.1$|^0\.1 SOL$/ }).first();
    if (await preset.isVisible().catch(() => false)) await preset.click();
    await page.waitForTimeout(2500);
    const panel = await text('.trade-panel, #trade-panel, .coin-trade-panel').catch(() => '');
    return panel.slice(0, 110);
  });
  await step('calls compose without wallet', async () => {
    await go('/#callouts');
    await page.locator('#callouts :is(a, button)', { hasText: /Make a call/i }).first().click({ timeout: 3000 });
    await page.waitForTimeout(1200);
    const dialog = await text('dialog[open], [role="dialog"]:visible').catch(() => '');
    return dialog ? dialog.slice(0, 100) : 'no dialog';
  });
  await step('referral link without wallet', async () => {
    await go('/#referrals');
    await page.locator('#main-content button', { hasText: /Get invite link/i }).first().click({ timeout: 3000 });
    await page.waitForTimeout(1500);
    const after = await page.locator('dialog[open], [role="dialog"]:visible, .toast:visible').first().innerText().catch(() => '');
    return after ? after.replace(/\s+/g, ' ').slice(0, 100) : 'nothing shown';
  });
  await step('docs search', async () => {
    await go('/#docs');
    const input = page.locator('#docs input[type="search"], #docs input').first();
    // On phones the guide search sits inside the collapsed "Browse guides" menu.
    if (!await input.isVisible()) await page.locator('#docs :is(summary, button)', { hasText: /Browse guides/i }).first().click({ timeout: 3000 });
    await input.fill('referral'); await page.waitForTimeout(1200);
    const count = await page.locator('#docs :is(nav,aside) :is(a,button):visible').count();
    return `${count} guide links visible after search`;
  });
  await step('portfolio wallet lookup', async () => {
    await go('/#portfolio');
    const input = page.locator('#portfolio-wallet-lookup');
    if (!await input.isVisible().catch(() => false)) throw new Error('lookup box not visible');
    await input.fill('5ThgFz4yFPX6fQ8mdaPjtKXeYYA6RwEMjkC2vaPMA6oi'); await input.press('Enter');
    await page.waitForURL(/\/wallet\//, { timeout: 8000 }); await page.waitForTimeout(3000);
    return `opened ${new URL(page.url()).pathname.slice(0, 20)}… title="${await page.title()}"`;
  });
  await step('leaderboard and bonuses render', async () => {
    await go('/#leaderboard'); const a = (await text('#leaderboard')).slice(0, 60);
    await go('/#bonuses'); const b = (await text('[data-today-countdown]').catch(() => '?'));
    return `leaderboard "${a}" | bonus clock "${b}"`;
  });
  await page.close();
}
await browser.close();
// A printed failure must fail automation, not leave a successful exit status.
if (results.some(row => / FAIL |^\s+errors:/.test(row))) process.exitCode = 1;
