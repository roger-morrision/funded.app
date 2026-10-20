import { test, expect } from '@playwright/test';
import { PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const launches = [66, 67].map((value, index) => ({
  mint: new PublicKey(new Uint8Array(32).fill(value)).toBase58(),
  name: `Tier focus QA ${index}`, symbol: `TF${index}`, cluster: 'devnet', onchainVerified: true,
  creatorWallet: '11111111111111111111111111111111',
}));
const savedMint = new PublicKey(new Uint8Array(32).fill(68)).toBase58();

async function prepare(page, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.addInitScript(mint => {
    localStorage.setItem('funded.app.community.watchlist', JSON.stringify([mint]));
    localStorage.setItem('funded.app.followed.wallets.v1', '[]');
  }, savedMint);
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Controlled unavailable fixture' } }));
  await page.route('**/api/x/me', route => route.fulfill({ json: { authenticated: false, configured: false } }));
  await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
  await page.route('**/api/launches', route => route.fulfill({ json: launches }));
  await page.route('**/api/pump/explore?*', route => route.fulfill({ json: { items: [], fetchedAt: new Date().toISOString() } }));
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
  await page.locator('button[data-explore-view="table"]').click();
  await expect(page.locator('#launch-list [data-tier-info-mint]')).toHaveCount(2);
}

async function open(page) {
  const trigger = page.locator('#launch-list [data-tier-info-mint]').first();
  await trigger.click();
  const dialog = page.locator('#explore-tier-dialog');
  await expect(dialog).toHaveJSProperty('open', true);
  expect(await dialog.evaluate(node => node.matches(':modal'))).toBe(true);
  await expect(page.locator('#explore-tier-close')).toBeFocused();
  return { trigger, dialog };
}

async function close(page, activation) {
  if (activation === 'pointer') await page.locator('#explore-tier-close').click();
  else await page.keyboard.press(activation);
  await expect(page.locator('#explore-tier-dialog')).toHaveJSProperty('open', false);
}

// Invoke the real Table renderer with deterministic launch records. This replaces
// the row in the same way as a completed background refresh, without touching DOM
// nodes directly or waiting for the timer/network in the regression test.
async function renderTableAgain(page, { dropFocused = false } = {}) {
  return page.evaluate(async ({ dropFocused }) => {
    const { renderRegistry } = await import('/src/features/explore/registry-view.js');
    const buttons = [...document.querySelectorAll('#launch-list [data-tier-info-mint]')];
    const before = buttons.map(button => ({ mint: button.dataset.tierInfoMint, node: button }));
    const focusedMint = document.activeElement.dataset.tierInfoMint;
    const rows = buttons.filter(button => !dropFocused || button.dataset.tierInfoMint !== focusedMint)
      .map((button, index) => ({
        address: button.dataset.tierInfoMint, symbol: `TF${index}`, name: `Tier focus QA ${index}`,
        icon: 'T', complete: false,
      }));
    const state = { registryLaunches: rows, registryPage: 1, registryCriteriaKey: '',
      exploreProviderStatus: 'Ready', exploreLastVerifiedAt: Date.now(),
      assets: rows, exploreFeedAvailable: true, verifiedBoosts: {}, EXPLORE_CLUSTER: 'devnet' };
    renderRegistry('', state, {
      getWatchlist: () => [], getFollowingTokenSources: () => new Map(),
      filterExploreTabRecords: records => records,
      exploreOutageCopy: () => ({ title: 'Unavailable', detail: '' }),
      exploreEmptyReason: () => null, exploreStageLabel: () => 'New', formatOnchainAge: () => 'Now',
      explorePaidListingBagMarkup: () => '', exploreBoostAmountMarkup: () => '',
      exploreSocialLinksMarkup: () => '',
      exploreTierBadgeMarkup: mint => before.find(row => row.mint === mint)?.node.outerHTML || '',
      exploreMarketCapUsd: () => '—', formatExploreTradeCount: () => '—',
      formatExploreUsd: () => '—', exploreAirdropMarkup: () => '',
      loadVerifiedTokenLogos: () => {}, renderWatchlist: () => {},
    });
    return before.every(row => !row.node.isConnected);
  }, { dropFocused });
}

for (const width of [390, 1440]) {
  test(`UX-010 restored tier focus survives a later real Table render at ${width}px (deterministic rows)`, async ({ page }) => {
    await prepare(page, width);
    const { trigger } = await open(page);
    await close(page, 'Escape');
    await expect(trigger).toBeFocused();
    const scrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    expect(await renderTableAgain(page)).toBe(true);
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(scrollBefore);
    await expect(page.locator('#explore-tier-dialog')).toHaveJSProperty('open', false);
    await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test(`UX-010 real Table render keeps superseding focus at ${width}px (deterministic rows)`, async ({ page }) => {
    await prepare(page, width);
    const { trigger } = await open(page);
    await close(page, 'Escape');
    await expect(trigger).toBeFocused();
    await page.locator('#explore-search').focus();
    expect(await renderTableAgain(page)).toBe(true);
    await expect(page.locator('#explore-search')).toBeFocused();
  });

  test(`UX-010 real Table render reveals fallback after focused mint disappears at ${width}px (deterministic rows)`, async ({ page }) => {
    await prepare(page, width);
    const { trigger } = await open(page);
    await close(page, 'Escape');
    await expect(trigger).toBeFocused();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await renderTableAgain(page, { dropFocused: true })).toBe(true);
    await expect(page.locator('#explore-search')).toBeFocused();
    const visible = await page.locator('#explore-search').evaluate(node => {
      const rect = node.getBoundingClientRect();
      const header = document.querySelector('.topbar');
      const top = header?.getClientRects().length && ['fixed', 'sticky'].includes(getComputedStyle(header).position)
        ? header.getBoundingClientRect().bottom : 0;
      const nav = document.querySelector('.mobile-workspace-nav');
      const bottom = nav?.getClientRects().length && getComputedStyle(nav).position === 'fixed'
        ? nav.getBoundingClientRect().top : innerHeight;
      return rect.top >= top && rect.bottom <= bottom;
    });
    expect(visible).toBe(true);
  });

  for (const activation of ['pointer', 'Enter', 'Space', 'Escape']) {
    for (const replaced of [false, true]) {
      test(`UX-010 ${replaced ? 'replaced' : 'current'} tier trigger returns focus after ${activation} at ${width}px (mocked APIs)`, async ({ page }) => {
        await prepare(page, width);
        await page.locator('#explore-search').fill('Tier focus');
        const saved = await page.evaluate(() => localStorage.getItem('funded.app.community.watchlist'));
        const { trigger } = await open(page);
        if (replaced) {
          const detached = await trigger.evaluate(node => {
            const replacement = node.cloneNode(true);
            node.replaceWith(replacement);
            return !node.isConnected && replacement.isConnected;
          });
          expect(detached).toBe(true);
        }
        await close(page, activation);
        await expect(trigger).toBeFocused();
        await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#explore-search')).toHaveValue('Tier focus');
        expect(await page.evaluate(() => localStorage.getItem('funded.app.community.watchlist'))).toBe(saved);
        const visibleFocus = await trigger.evaluate(node => {
          const rect = node.getBoundingClientRect();
          const scroll = node.closest('.scanner-scroll').getBoundingClientRect();
          const nav = document.querySelector('.mobile-workspace-nav');
          const bottom = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : innerHeight;
          return rect.left >= scroll.left && rect.right <= scroll.right && rect.top >= 0 && rect.bottom <= bottom;
        });
        expect(visibleFocus).toBe(true);
      });
    }
  }

  test(`UX-010 missing tier trigger returns to visible Search at ${width}px (mocked list rerender)`, async ({ page }) => {
    await prepare(page, width);
    const { trigger } = await open(page);
    await trigger.evaluate(node => node.remove());
    await close(page, 'Escape');
    await expect(page.locator('#explore-search')).toBeFocused();
    await expect(page.locator('button[data-explore-view="table"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test(`UX-010 route change prevents late tier focus at ${width}px (mocked route)`, async ({ page }) => {
    await prepare(page, width);
    await open(page);
    await page.evaluate(() => { location.hash = '#overview'; });
    await expect(page.locator('body')).toHaveClass(/page-route-overview/);
    await close(page, 'Escape');
    await expect(page.locator('#explore-search')).not.toBeFocused();
    await expect(page).toHaveURL(/#overview$/);
  });

  test(`UX-010 superseding control keeps focus at ${width}px (mocked close timing)`, async ({ page }) => {
    await prepare(page, width);
    await open(page);
    await page.evaluate(() => {
      document.querySelector('#explore-tier-dialog').close();
      document.querySelector('#explore-search').focus();
    });
    await expect(page.locator('#explore-search')).toBeFocused();
  });

  test(`UX-010 queued close does not consume a newer tier dialog at ${width}px (mocked rapid reopen)`, async ({ page }) => {
    await prepare(page, width);
    await open(page);
    await page.evaluate(() => {
      document.querySelector('#explore-tier-dialog').close();
      const next = document.querySelectorAll('#launch-list [data-tier-info-mint]')[1];
      next.focus();
      next.click();
    });
    await expect(page.locator('#explore-tier-dialog')).toHaveJSProperty('open', true);
    await page.waitForTimeout(50);
    await page.locator('#launch-list [data-tier-info-mint]').nth(1).evaluate(node => node.replaceWith(node.cloneNode(true)));
    await close(page, 'Escape');
    await expect(page.locator('#launch-list [data-tier-info-mint]').nth(1)).toBeFocused();
  });
}
