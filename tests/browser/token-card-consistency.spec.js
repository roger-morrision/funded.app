import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const mint = 'So11111111111111111111111111111111111111112';
const name = 'A long test token name that must remain readable on every card';

for (const width of [360, 1440]) test(`shared token cards retain square logos and native actions at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Controlled offline fixture' } }));
  await page.route('**/api/fee-policy', route => route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } }));
  await page.addInitScript(() => {
    sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1');
    window.__cardCopies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => window.__cardCopies.push(value) } });
  });
  await page.goto('/#community');
  await page.locator('body.product-flows-ready').waitFor();
  // Exercise the actual renderers with explicit synthetic display data. No wallet,
  // signature, RPC verification, financial mutation or payment outcome is implied.
  await page.evaluate(async ({ mint, name }) => {
    const { portfolioTokenCardMarkup } = await import('/src/features/portfolio/token-card-view.js');
    const { createTokenCardsController } = await import('/src/app/controllers/token-cards.js');
    const { escapeHtml } = await import('/src/features/shared/display.js');
    const { icon } = await import('/ui-icons.js');
    const controls = createTokenCardsController({ getWatchlist: () => [], escapeHtml, icon });
    const target = document.querySelector('#watchlist-items');
    target.innerHTML = portfolioTokenCardMarkup({ mint, name, symbol: 'TEST', removable: true }, { assets: [], EXPLORE_CLUSTER: 'devnet' }, {
      ...controls,
      exploreStageLabel: () => 'Stage unavailable', formatCoinUsd: () => '—', launchCardVolumeUsd: () => '—',
      portfolioHolderCount: () => '—', exploreBoostAmountMarkup: () => '',
    });
  }, { mint, name });
  const saved = page.locator('#watchlist-items .saved-token-row');
  await expect(saved.locator('.saved-token-identity a > span')).toHaveText(name);
  await saved.locator('[data-copy-address]').click();
  expect(await page.evaluate(() => window.__cardCopies)).toEqual([mint]);
  await saved.locator('.share-asset').click();
  await expect(page.locator('#share-dialog')).toHaveJSProperty('open', true);
  await expect(page.locator('#share-link')).toHaveValue(new RegExp(`/token/${mint}`));
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#community$/);
  const measurements = [];
  const measure = async (selector, logo, label) => {
    await expect(page.locator(selector)).toBeVisible();
    // Resolve and measure the currently mounted record atomically. An ordinary
    // read refresh may replace a locator's previous element between awaits.
    const measured = await page.waitForFunction(({ selector, logo }) => {
      const element = document.querySelector(selector), image = element?.querySelector(logo);
      if (!image || !image.getClientRects().length) return false;
      const rect = image.getBoundingClientRect(), css = getComputedStyle(element);
      return { logo: { width: rect.width, height: rect.height, radius: getComputedStyle(image).borderRadius }, radius: css.borderRadius,
        background: css.backgroundColor, overflow: element.scrollWidth > element.clientWidth + 1,
        controls: [...element.querySelectorAll('button:not([hidden]), .saved-token-view')].filter(button => button.getClientRects().length).map(button => {
          const bounds = button.getBoundingClientRect(); return { name: button.className, width: bounds.width, height: bounds.height };
        }) };
    }, { selector, logo });
    const value = await measured.jsonValue();
    expect(value.logo.width).toBeGreaterThanOrEqual(40);expect(value.logo.width).toBeLessThanOrEqual(56);
    expect(value.logo.height).toBeCloseTo(value.logo.width, 2);
    // Compact paid listings and reward cards intentionally use distinct surfaces.
    expect(value.overflow, label).toBe(false);
    for (const control of value.controls) { expect(control.width, JSON.stringify({label,control})).toBeGreaterThanOrEqual(43.99); expect(control.height, JSON.stringify({label,control})).toBeGreaterThanOrEqual(43.99); }
    measurements.push({ label, ...value });
  };
  await measure('#watchlist-items .saved-token-row', '.portfolio-token-avatar', 'Favorites');
  await page.screenshot({ path: info.outputPath('favorites.png') });
  await page.evaluate(() => { location.hash = 'overview'; });
  await page.locator('body.page-route-overview').waitFor();
  await page.evaluate(async ({ mint, name }) => {
    const { paidListingCardMarkup } = await import('/src/features/home/paid-listing-view.js');
    // The harness uses normal route styling but owns its containers, so the
    // app's independent offline refresh cannot discard this display fixture.
    // Legacy reward renderers use a full-width host, outside the redesigned
    // discovery grid whose second column belongs to chat.
    const board = document.querySelector('.home-launch-board');
    const paid = document.createElement('div'); paid.id = 'qa-paid-cards';
    paid.innerHTML = paidListingCardMarkup({ mint, name, symbol: 'TEST', signature: '5'.repeat(88), listedAt: Date.now() });
    board.after(paid);
    const rewards = document.createElement('div'); rewards.id = 'qa-reward-cards'; rewards.className = 'home-rewards-stack';
    rewards.innerHTML = '<div class="home-rewards-grid" data-home-reward-grid="coin"></div><div class="home-rewards-grid" data-home-reward-grid="funded"></div>';
    board.after(rewards);
    const { renderSimpleRewardCards } = await import('/src/features/rewards/sol-cards-view.js');
    renderSimpleRewardCards('coin', { homeSpotlight: rewards,
      homeVerifiedLaunches: [{ mint, name, symbol: 'TEST', feeDistribution: { creatorDirected: { shares: { holderAirdropPercent: 10 } } } }],
      homeLaunchPolicyStatus: 'ready', homePaidSummary: { tokens: new Map(), status: 'unavailable' }, scheduleRows: [], offset: 0, homeXRouteReady: false,
    }, { loadFundedTokenLogo: () => {} });
    const { renderHomeRewardCards } = await import('/src/features/rewards/airdrop-cards-view.js');
    const launch = { mint, name, symbol: 'TEST', communityAirdrop: { reservedTokens: 100 } };
    renderHomeRewardCards({ homeSpotlight: rewards, homeFundedTokens: [launch], homeVerifiedLaunches: [launch],
      homeReserves: { cluster: 'devnet', reserves: [{ mint, verified: true, status: 'funded', reservedTokens: 100 }] },
      offset: 0, homeLaunchPolicyStatus: 'ready', homeReceiverEstimate: { wallets: new Set() }, EXPLORE_CLUSTER: 'devnet',
    }, { renderSimpleRewardCards: () => {}, loadFundedTokenLogo: () => {}, renderHomeClocks: () => {} });
  }, { mint, name });
  await measure('#qa-paid-cards .paid-listing-card', '.home-launch-card-media', 'Paid listing');
  await measure('#qa-reward-cards [data-home-reward-grid="coin"] .home-reward-token-card', '.home-reward-token-logo', 'SOL reward');
  await measure('#qa-reward-cards [data-home-reward-grid="funded"] .home-reward-token-card', '.home-reward-token-logo', 'Token airdrop reward');
  await page.evaluate(() => { location.hash = 'airdrops'; });
  await page.locator('body.page-route-airdrops').waitFor();
  await page.evaluate(async ({ mint, name }) => {
    const { createAirdropDirectoryController } = await import('/src/app/controllers/airdrop-directory.js');
    const { createTokenCardsController } = await import('/src/app/controllers/token-cards.js');
    const { escapeHtml } = await import('/src/features/shared/display.js');
    const { icon } = await import('/ui-icons.js');
    const controls = createTokenCardsController({ getWatchlist: () => [], escapeHtml, icon });
    const app = { escapeHtml, ...controls, airdropDirectoryStatus: 'all', airdropDirectoryPage: 1, AIRDROP_DIRECTORY_PAGE_SIZE: 10,
      verifiedLaunchPoliciesStatus: 'ready', communityReserveStatus: 'unavailable', communityWalletAllocations: new Map(), connectedWalletAddress: null,
      verifiedLaunchPolicyForMint: () => null, tokenCardData: () => ({ reserveState: 'unverified' }),
      formatPolicyTokenCount: String, tokenCardEvidenceLabel: () => 'Display fixture; no verification', exploreBoostAmountMarkup: () => '',
      exploreSocialLinksMarkup: () => '', tokenCardAddressesMarkup: () => '', directoryWalletAmount: () => 'Connect to check', loadVerifiedTokenLogos: () => {},
    };
    const controller = createAirdropDirectoryController(app);
    controller.renderAirdropDirectory([{ id: mint, name, symbol: 'TEST', reservedTokens: 100, status: 'upcoming', statusLabel: 'Pending', claimVerification: 'unavailable' }]);
  }, { mint, name });
  await measure('#airdrop-directory .airdrop-directory-card', '.claim-token-mark', 'Airdrop directory');
  await page.evaluate(async ({ mint, name }) => {
    const { createAirdropReportingController } = await import('/src/app/controllers/airdrop-reporting.js');
    const { createTokenCardsController } = await import('/src/app/controllers/token-cards.js');
    const { escapeHtml } = await import('/src/features/shared/display.js'); const { icon } = await import('/ui-icons.js');
    const list = document.querySelector('#airdrop-claim-list') || document.createElement('div');
    list.id = 'airdrop-claim-list'; document.querySelector('#airdrops').append(list);
    list.hidden = false;
    const app = { ...createTokenCardsController({ getWatchlist: () => [], escapeHtml, icon }), escapeHtml,
      getPreviewClaims: () => ({}), previewAirdrop: { id: 'preview' }, activeAirdropFilter: 'all',
      getAirdropPrograms: () => [{ id: mint, name, symbol: 'TEST', status: 'upcoming', allocationPercent: 3, reservedTokens: 100 }],
      formatTokenAmount: String, loadVerifiedTokenLogos: () => {}, verifiedLaunchPoliciesStatus: 'ready', renderAirdropSummary: () => {}, renderAirdropDirectory: () => {}, renderAirdropAnalytics: () => {},
    };
    createAirdropReportingController(app).renderAirdropClaims();
  }, { mint, name });
  await measure('#airdrop-claim-list .claim-card', '.claim-token > span', 'Claim card');
  await expect(page.locator('#airdrop-claim-list .claim-token strong')).toHaveText('TEST');
  await expect(page.locator('#airdrop-claim-list .claim-token small').first()).toHaveText(name);
  await page.screenshot({ path: info.outputPath('airdrop-directory.png') });
  await page.route('**/api/creators/123', route => route.fulfill({ json: {
    id: '123', handle: '@DisplayFixture', name: 'Display fixture', cluster: 'devnet', receipts: [], updates: [], evidenceStatus: 'unavailable',
    coins: [{ mint, name, symbol: 'TEST', sharePercent: 10, authorization: 'fan-created' }],
  } }));
  await page.evaluate(() => { location.hash = 'creator/123'; });
  await measure('#creator-support-page .creator-coin-card', '.creator-coin-logo', 'Creator profile');
  await expect(page.locator('#creator-support-page .creator-coin-card h3 small')).toHaveText(name);
  await page.screenshot({ path: info.outputPath('creator-profile.png') });
  await page.route('**/api/rewards/experience', route => route.fulfill({ json: {
    evidence: { status: 'onchain-indexed' }, tokens: [{ mint, name, symbol: 'TEST', holderSharePercent: 10,
      totals: { holder: '1000000000' }, holderPaidLamports: '0', holderPaidWallets: 0, status: 'holder-fees-allocated' }],
  } }));
  await page.evaluate(() => { location.hash = 'payments/holders'; window.dispatchEvent(new Event('funded:reward-identity-change')); });
  await measure('#reward-discovery .reward-discovery-card', '.reward-token-avatar', 'Reward discovery');
  await expect(page.locator('#reward-discovery .reward-token-info > a small')).toHaveText(name);
  await page.screenshot({ path: info.outputPath('reward-discovery.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
  await info.attach('renderer-measurements', { body: JSON.stringify({ width, measurements, scope: 'Controlled actual renderers and native local actions; no chain evidence' }), contentType: 'application/json' });
});
