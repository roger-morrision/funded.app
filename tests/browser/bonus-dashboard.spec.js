import { test, expect } from '@playwright/test';
const wallet = '2'.repeat(44), tx = '3'.repeat(64);
function fixture({ category = 'all', page = 1 } = {}) {
  const received = { wallet, receivedLamports:'500000000', payments:2 };
  return { cluster:'devnet', scope:'all-recorded-snapshots', serverTime:'2026-10-18T23:58:58Z',
    nextCutoffAt:'2026-10-19T00:00:00Z', poolCheckedAt:'2026-10-18T23:58:58Z', snapshotEnabled:true, payoutEnabled:true,
    pool:{ status:'verified-indexed-settlements', day:'2026-10-18', collections:3,
      categoryLamports:{ creators:'1000000000', referrals:'999999999', traders:'999999998' } },
    snapshots:45, totalPayments:25, unavailableReceipts:1, unavailableSnapshots:0, worker:{ status:'active' },
    leaders:{ creators:[received], referrals:[], traders:[received] },
    history:{ page, pages:2, total:25, category, rows:[{ wallet, day:page === 1 ? '2026-10-17' : '2026-09-01',
      receivedLamports:'149', categoryLamports:{ creators:'50', referrals:'50', traders:'49' }, signature:tx,
      href:`https://explorer.solana.com/tx/${tx}?cluster=devnet` }] } };
}
async function setup(page, response = () => null) {
  await page.route('**/api/**', route => route.fulfill({ status:503, json:{ error:'Offline fixture' } }));
  await page.route('**/api/daily-bonus/dashboard?*', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json:response() || fixture({ category:url.searchParams.get('category'), page:Number(url.searchParams.get('page')) }) });
  });
  await page.route('https://**/*', route => route.abort());
}
test('Home bonus amounts animate to recorded totals; countdown ticks down; category links open full history', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await setup(page); await page.goto('/#overview');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const home = page.locator('#home-daily-bonuses'); await expect(home).toBeVisible();
  await expect(home.locator('[data-bonus-pool="creators"]')).toHaveText('1 SOL');
  await expect(home.locator('[data-bonus-pool="referrals"]')).toHaveText('0.999999999 SOL');
  const clock = home.locator('[data-bonus-countdown]'); const initial = await clock.textContent();
  await expect.poll(() => clock.textContent()).not.toBe(initial);
  await home.locator('[data-bonus-category-link="traders"]').click();
  await expect(page.locator('#bonuses')).toBeVisible(); await expect(home).toBeHidden();
  await expect(page.locator('[data-bonus-history-category]')).toHaveValue('traders');
  await expect(page.locator('[data-bonus-leaders]')).toContainText('0.5 SOL');
  await expect(page.locator('[data-bonus-history-rows]')).toContainText('0.000000149 SOL');
  await expect(page.locator('[data-bonus-history-rows] a[target="_blank"]')).toHaveAttribute('href', /cluster=devnet/);
  await page.locator('[data-bonus-next]').click();
  await expect(page.locator('[data-bonus-history-rows]')).toContainText('2026-09-01');
  await expect(page.locator('[data-bonus-next]')).toBeDisabled();
  await expect(page.locator('[data-bonus-history-status]')).toContainText('excluded from rankings');
  expect(errors).toEqual([]);
});
test('reduced motion, narrow layout, direct page routing and invalid-network stale clearing', async ({ page }) => {
  let response; await page.emulateMedia({ reducedMotion:'reduce' }); await setup(page, () => response);
  await page.setViewportSize({ width:390, height:844 }); await page.goto('/#bonuses');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#bonuses')).toBeVisible();
  await expect(page.locator('[data-bonus-history-rows]')).toContainText('2026-10-17');
  await page.locator('#open-menu').click();
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  if (await page.locator('.nav-more').getAttribute('open') === null) await page.locator('.nav-more summary').click();
  await expect(page.locator('.nav-more a[href="#bonuses"]')).toBeVisible();
  await expect(page.locator('.nav-more a[href="#bonuses"]')).toHaveAttribute('aria-current', 'page');
  await page.locator('.nav-more a[href="#bonuses"]').click();
  await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-bonus-history-category]').selectOption('referrals');
  await expect(page.locator('[data-bonus-page]')).toContainText('Page 1');
  response = { ...fixture(), cluster:'mainnet-beta' }; await page.locator('[data-bonus-history-refresh]').click();
  await expect(page.locator('[data-bonus-history-status]')).toContainText('unavailable');
  await expect(page.locator('[data-bonus-leaders]')).toBeEmpty();
  await expect(page.locator('[data-bonus-history-rows]')).toBeEmpty();
  await expect(page.locator('[data-bonus-next]')).toBeDisabled();
  await page.screenshot({ path:test.info().outputPath('bonus-unavailable-mobile.png'), fullPage:true });
});
test('empty history shows no synthetic recipients and Home does not invent rewards', async ({ page }) => {
  const empty = fixture(); empty.leaders = { creators:[], referrals:[], traders:[] };
  empty.totalPayments = 0; empty.unavailableReceipts = 0; empty.history = { page:1, pages:1, rows:[], total:0, category:'all' };
  empty.pool = { status:'unavailable', categoryLamports:null };
  await setup(page, () => empty); await page.goto('/#bonuses');
  await expect(page.locator('[data-bonus-leaders]')).toContainText('No finalized bonus payout yet');
  await expect(page.locator('[data-bonus-history-rows]')).toContainText('No finalized bonus payouts');
  await page.goto('/#overview');
  await expect(page.locator('[data-bonus-pool="creators"]')).toHaveText('Unavailable');
});

test('Devnet QA schedule shows five-minute cutoffs consistently on Home, history and Capital flow',async({page})=>{
  const qa={...fixture(),schedule:{mode:'devnet-qa-5m',periodSeconds:300,mints:['qa'],cohort:'abcdef012345'},serverTime:'2026-10-18T10:15:20Z',nextCutoffAt:'2026-10-18T10:20:00Z'};
  await setup(page,()=>qa);
  await page.route('**/api/daily-bonus',route=>route.fulfill({json:{cluster:'devnet',schedule:qa.schedule,nextCutoffAt:qa.nextCutoffAt,snapshots:[],payoutEnabled:true,snapshotEnabled:true,indexing:[{day:'qa5m:2026-10-18T10:00:00Z',reason:'Old test fixture.'}]}}));
  await page.goto('/#overview');
  await expect(page.locator('[data-bonus-schedule]')).toContainText('every 5 minutes');
  await expect(page.locator('[data-bonus-cutoff-label]')).toHaveText('Next QA snapshot · every 5 minutes');
  await expect(page.locator('[data-bonus-countdown]')).toContainText('00:04:');
  await page.goto('/#bonuses');await expect(page.locator('[data-bonus-delivery]')).toContainText('Devnet QA snapshots close every 5 minutes');
  await page.goto('/#capital-flow');await expect(page.locator('#daily-bonus-title')).toHaveText('Top 3. Every 5 minutes · Devnet QA.');
  await expect(page.locator('[data-bonus-status]')).not.toContainText('Processing');
});
