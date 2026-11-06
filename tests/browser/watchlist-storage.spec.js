import {installAccountFixture} from '../fixtures/account-browser-fixture.mjs';
import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const KEY = 'funded.app.watchlist.guest.v1';
const MINT = 'So11111111111111111111111111111111111111112';
const FOLLOWED_WALLET = '9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w';
const errors = new WeakMap(), accounts=new WeakMap(), faults=new WeakMap();
test.beforeEach(async ({ page }) => {
  const found = []; errors.set(page, found); page.on('pageerror', error => found.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/fee-policy', route => route.fulfill({ json: { split:PROTOCOL_FEE_SPLIT } }));
  await page.route('**/api/x/me', route => route.fulfill({ json: { authenticated: false, configured: true } }));
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
async function seed(page,mints){
  const account=await installAccountFixture(page,{mints});accounts.set(page,account);
  await page.addInitScript(()=>{window.qaWatchEvents=0;window.addEventListener('funded:watchlist-added',()=>window.qaWatchEvents++);});
}
async function ready(page){
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  if(accounts.has(page))await accounts.get(page).connect();
}
async function fault(page,mode){
  const handler=r=>r.request().method()!=='POST'?r.fallback():mode==='transport'?r.abort()
    :r.fulfill({status:mode==='unauthorized'?401:mode==='unavailable'?503:200,json:mode==='identity'?{accountId:'wrong',mints:[],csrf:'bad'}:{error:'Favorites could not be saved'}});
  faults.set(page,handler);await page.route('**/api/watchlist?*',handler);
}
async function restore(page){await page.unroute('**/api/watchlist?*',faults.get(page));}
const saved=async page=>accounts.get(page).mints;
const notice = page => page.locator('#coin-page [data-watchlist-status]');

for (const mode of ['unavailable', 'unauthorized', 'transport', 'identity']) for (const remove of [false, true]) {
  test(`account favorite ${remove ? 'remove' : 'save'} survives ${mode} failure and explicit retry`, async ({ page }) => {
    const initial = remove ? [MINT] : [], next = remove ? [] : [MINT];
    await seed(page, initial); await page.goto(`/token/${MINT}`); await ready(page);
    const button = page.locator('#coin-watch');
    await expect(button).toHaveAttribute('aria-pressed', String(remove));
    await fault(page, mode); await button.click();
    await expect(notice(page)).toContainText(/denied|quota|could not|couldn't|cannot|unavailable|account changed/i);
    await expect(button).toHaveAttribute('aria-pressed', String(remove));
    expect(await page.evaluate(() => window.qaWatchEvents)).toBe(0);
    await restore(page);
    expect(await saved(page)).toEqual(initial);
    await button.focus(); await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', String(!remove));
    expect(await saved(page)).toEqual(next);
    await page.reload(); await ready(page);
    await expect(button).toHaveAttribute('aria-pressed', String(!remove));
  });
}
for (const value of ['{', '{"mints":true}', '{"mints":["invalid"],"importId":"bad"}']) {
  test(`malformed guest storage is preserved: ${value}`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: KEY, value });
    await page.goto(`/token/${MINT}`); await ready(page);
    await page.locator('#coin-watch').click();
    await expect(page.locator('#wallet-onboarding-dialog')).toBeVisible();
    await expect(page.locator('#coin-watch')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(value);
  });
}
test('unknown sign-in state does not overwrite legacy guest favorites',async({page})=>{
  await page.route('**/api/x/me',r=>r.fulfill({status:503,json:{}}));
  await page.addInitScript(({KEY,MINT})=>localStorage.setItem(KEY,JSON.stringify({mints:[MINT]})),{KEY,MINT});
  await page.goto('/token/'+MINT);await ready(page);await page.locator('#coin-watch').click();
  await expect(page.locator('#coin-watch')).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).mints,KEY)).toEqual([MINT]);
});
for (const width of [390, 1440]) test(`unavailable token can be removed from Favorites at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await seed(page, [MINT]); await page.goto('/#community'); await ready(page);
  const row = page.locator('.watchlist-unavailable');
  await expect(row).toBeVisible(); await expect(page.locator('#watch-count')).toHaveText('1 favorite');
  await fault(page, 'unavailable'); await row.getByRole('button', { name: 'Remove saved token' }).click();
  await expect(page.locator('#toast')).toContainText('could not be saved');
  await expect(row).toBeVisible(); expect(await saved(page)).toEqual([MINT]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`favorites-${width}.png`) });
  await restore(page);
  await row.getByRole('button', { name: 'Remove saved token' }).click();
  await expect(row).toHaveCount(0); await expect(page.locator('#watch-count')).toHaveText('0 favorites');
  expect(await saved(page)).toEqual([]);
});

const rawMints = async page => JSON.stringify(await saved(page));
async function verifiedFeed(page, { holdingWallet = '', tradingWallet = '' } = {}) {
  const bytes = Buffer.alloc(82); bytes.writeBigUInt64LE(1000000000n, 36); bytes[44] = 6; bytes[45] = 1;
  const account = { data: [bytes.toString('base64'), 'base64'], owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', lamports: 1000000, executable: false, rentEpoch: 0 };
  await page.route('**/api/pump/explore?*', route => route.fulfill({ json: { cluster: 'devnet', items: [{ mint: MINT, name: 'Synthetic watch fixture', symbol: 'WATCH', createdTimestamp: 1, lastTradeTimestamp: 1 }], fetchedAt: new Date().toISOString() } }));
  if (tradingWallet) await page.route(`**/api/tokens/${MINT}/market-activity`, route => route.fulfill({ json: {
    cluster:'devnet', mint:MINT, coverage:'partial', observedCoverage:'partial',
    recentTrades:[{ trader:tradingWallet, side:'buy', signature:'5'.repeat(88), blockTime:Math.floor(Date.now() / 1000), solLamports:'1000000' }],
  } }));
  const rpc = route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: request.method === 'getMultipleAccounts'
      ? { jsonrpc: '2.0', id: request.id, result: { context: { slot: 1 }, value: request.params[0].map(mint => mint === MINT ? account : null) } }
      : request.method === 'getTokenAccountsByOwner'
        ? { jsonrpc:'2.0', id:request.id, result:{ context:{ slot:1 }, value:request.params[0] === holdingWallet && request.params[1]?.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
          ? [{ pubkey:MINT, account:{ data:{ parsed:{ info:{ owner:holdingWallet, mint:MINT, tokenAmount:{ amount:'1000000', decimals:6 } } }, program:'spl-token', space:165 }, executable:false, lamports:2039280, owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', rentEpoch:0 } }] : [] } }
        : { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'No additional evidence in offline fixture' } } });
  };
  await page.route('**/api/solana/rpc*', rpc); await page.route('https://api.devnet.solana.com/**', rpc);
}

for (const [tab, route] of [['favorites', 'explore']]) for (const [width, view] of [[1440, 'grid'], [390, 'table']]) test(`Explore ${tab} filters tokens in place on ${route} at ${width}px with ${view} view`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await seed(page, []); await verifiedFeed(page); await page.goto(`/#${route}`); await ready(page);
  await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
  const watch = page.locator(`#asset-grid .watch-button[data-mint="${MINT}"]`);
  await expect(watch).toHaveCount(1);
  await page.locator('#explore-search').fill('WATCH');
  await page.locator('#explore-sort').selectOption('recent-trade');
  await page.locator('[data-explore-window="6h"]').click();
  await page.locator(`button[data-explore-view="${view}"]`).click();
  const url = page.url();
  await page.evaluate(() => { window.qaExplorePage = document.querySelector('#explore'); });
  const following = page.locator(`button[data-explore-tab="${tab}"]`);
  await following.click();
  await expect(following).toHaveAttribute('aria-pressed', 'true');
  await expect(watch).toHaveCount(0);
  await expect(page).toHaveURL(url);
  expect(await page.evaluate(() => window.qaExplorePage === document.querySelector('#explore'))).toBe(true);
  await expect(page.locator('#explore')).toBeVisible();
  await expect(page.locator('#explore-search')).toHaveValue('WATCH');
  await expect(page.locator('#explore-sort')).toHaveValue('recent-trade');
  await expect(page.locator('[data-explore-window="6h"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`button[data-explore-view="${view}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('button[data-explore-tab="trending"]').click();
  await expect(watch).toHaveCount(1);
  await page.locator('button[data-explore-view="grid"]').click();
  await watch.click();
  await expect(watch).toHaveAttribute('aria-pressed', 'true');
  await page.locator(`button[data-explore-view="${view}"]`).click();
  await following.focus(); await page.keyboard.press('Enter');
  await expect(following).toHaveAttribute('aria-pressed', 'true');
  await expect(watch).toHaveCount(1);
  await expect(page).toHaveURL(url);
  await expect(page.locator('#explore-sort')).toHaveValue('trending');
  if (tab === 'favorites') {
    await page.reload(); await ready(page);
    await expect(following).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`button[data-explore-view="${view}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(url);
    const visibleWatch = view === 'grid' ? watch : page.locator(`.scanner-watch[data-mint="${MINT}"]`);
    await visibleWatch.click();
    await expect(watch).toHaveCount(0);
    await expect(page.locator('#asset-grid')).toContainText('No favorite tokens yet.');
    await expect(page).toHaveURL(url);
  }
});

test('Following shows a tracked wallet holding while Favorites remains star-only', async ({ page }) => {
  await seed(page, []);
  accounts.get(page).preferences.wallets=[{address:FOLLOWED_WALLET,roles:['trader']}];
  await verifiedFeed(page, { holdingWallet:FOLLOWED_WALLET });
  await page.goto('/#explore'); await ready(page);
  await page.locator('[data-explore-tab="following"]').click();
  await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(1);
  await expect(page.locator('#asset-grid .explore-following-source')).toContainText('Held by 1 followed wallet');
  await expect(page.locator('#explore-following-status')).toContainText('1/1 balance checks');
  await page.locator('[data-explore-view="table"]').click();
  await expect(page.locator('#launch-list .explore-following-source')).toContainText('Held by 1 followed wallet');
  await page.setViewportSize({ width:390, height:900 });
  await expect(page.locator('#launch-list .explore-following-source')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-explore-view="grid"]').click();
  await page.locator('[data-explore-tab="favorites"]').click();
  await expect(page.locator('#asset-grid')).toContainText('No favorite tokens yet.');
  await page.locator('[data-explore-tab="trending"]').click();
  await page.locator(`#asset-grid .watch-button[data-mint="${MINT}"]`).click();
  await page.locator('[data-explore-tab="favorites"]').click();
  await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(1);
  await page.locator('[data-explore-tab="following"]').click();
  await expect(page.locator('#asset-grid .explore-following-source')).toContainText('Held by 1 followed wallet');
});

test('Following shows a tracked wallet observed trade without claiming it holds the token', async ({ page }) => {
  await seed(page, []);
  accounts.get(page).preferences.wallets=[{address:FOLLOWED_WALLET,roles:['trader']}];
  await verifiedFeed(page, { tradingWallet:FOLLOWED_WALLET });
  await page.goto('/#explore'); await ready(page);
  await page.locator('[data-explore-tab="following"]').click();
  await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(1);
  await expect(page.locator('#asset-grid .explore-following-source')).toContainText('Traded by 1 followed wallet');
  await expect(page.locator('#asset-grid .explore-following-source')).not.toContainText('Held by');
});

test('A starred token alone appears in Favorites and never in Following', async ({ page }) => {
  await seed(page, [MINT]); await verifiedFeed(page);
  await page.goto('/#explore'); await ready(page);
  await page.locator('[data-explore-tab="following"]').click();
  await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(0);
  await expect(page.locator('#asset-grid')).toContainText('No followed wallets yet.');
  await page.locator('[data-explore-tab="favorites"]').click();
  await expect(page.locator('#asset-grid .explore-launch-card')).toHaveCount(1);
});

test('Explore native watch action does not announce success when saving fails', async ({ page }) => {
  await seed(page, []); await verifiedFeed(page); await page.goto('/#explore'); await ready(page);
  await page.locator('button[data-explore-view="grid"]').click();
  const watch = page.locator(`#asset-grid .watch-button[data-mint="${MINT}"]`); await expect(watch).toBeVisible();
  await fault(page, 'unavailable'); await watch.click();
  await expect(page.locator('#toast')).toContainText(/could not be saved/i);
  await expect(watch).toHaveAttribute('aria-pressed', 'false'); expect(await rawMints(page)).toBe('[]');
  expect(await page.evaluate(() => qaWatchEvents)).toBe(0);
  await restore(page); await watch.click();
  await expect(watch).toHaveAttribute('aria-pressed', 'true'); expect(JSON.parse(await rawMints(page))).toEqual([MINT]);
  expect(await page.evaluate(() => qaWatchEvents)).toBe(1);
});
