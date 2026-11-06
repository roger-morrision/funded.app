import { test, expect } from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

const walletAddress = '11111111111111111111111111111111';
const mint = 'So11111111111111111111111111111111111111112';

test('connected wallet can check its airdrop card without a misleading connect prompt', async ({ page }) => {
  const expiresAt = Math.floor(Date.now() / 1000) + 86_400;
  let proofRequests = 0;
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/launches', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { mint, name: 'Funded Clean QA', symbol: 'FCQA', cluster: 'devnet', onchainVerified: true,
      creatorWallet: walletAddress, communityAirdrop: { allocationPercent: 3, reservedTokens: 30_000_000 } },
  ]) }));
  // Explicit wallet checks refresh only this mint, independently of the directory.
  await page.route('**/api/airdrops/reserves*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cluster: 'devnet', reserves: [
    { mint, verified: true, status: 'drop-active', reservedTokens: 30_000_000, expiresAt,
      snapshotHash: 'fixture-snapshot', migrationSlot: 123, leafCount: 13,
      claimedBaseUnits: '0', totalBaseUnits: '30000000000000000' },
  ] }) }));
  await page.route('**/api/airdrops/allocation**', route => {
    proofRequests++;
    expect(new URL(route.request().url()).searchParams.get('wallet')).toBe(walletAddress);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ineligible', recipient: walletAddress }) });
  });
  await page.route('https://**/*', route => route.abort());
  await page.addInitScript(address => {
    const listeners = new Map();
    const provider = {
      isPhantom: true, isConnected: false, publicKey: null,
      signTransaction: async transaction => transaction,
      on(event, callback) { listeners.set(event, [...(listeners.get(event) || []), callback]); },
      async connect(options = {}) {
        if (options.onlyIfTrusted) throw new Error('Not trusted');
        provider.publicKey = { toBase58: () => address };
        provider.isConnected = true;
        for (const callback of listeners.get('connect') || []) callback(provider.publicKey);
        return { publicKey: provider.publicKey };
      },
      async disconnect() {
        provider.isConnected = false;
        provider.publicKey = null;
        for (const callback of listeners.get('disconnect') || []) callback();
      },
    };
    window.phantom = { solana: provider };
    window.solana = provider;
  }, walletAddress);

  await page.goto('/#airdrops');
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state', 'ready');
  const fundedBalance = page.locator('#airdrop-funded-balance');
  await expect(fundedBalance).toBeHidden();
  await page.locator('[data-public-airdrop-tab="all"]').click();
  const card = page.locator('.airdrop-directory-card');
  await expect(card).toContainText('Connect to check');
  await page.locator('#connect-button').click();
  await page.locator('[data-wallet-choice="phantom"]').click();
  await expect(page.locator('#connect-button')).toHaveClass(/wallet-pill-connected/);
  await expect(fundedBalance).toBeVisible();
  await expect(fundedBalance).toContainText('Current $FUNDED balance');
  await expect(fundedBalance).toContainText('-');
  await expect(card).toContainText('No allocation');
  expect(proofRequests).toBe(1);
  await card.locator('.directory-claim').click();
  await expect(card).toContainText('No allocation');
  await expect.poll(()=>proofRequests).toBe(1);
  // A cached allocation is reused within 30 seconds. Closing the detail while
  // its scoped reserve read is pending must not start
  // another wallet proof request when that obsolete read completes.
  let releaseReserve, reserveStarted;
  const heldReserve = new Promise(resolve => { releaseReserve = resolve; });
  const reserveEntered = new Promise(resolve => { reserveStarted = resolve; });
  await page.route(url => url.pathname === '/api/airdrops/reserves' && url.searchParams.has('mint'), async route => {
    reserveStarted();await heldReserve;await route.fallback();
  });
  await card.locator('.directory-claim').click();await reserveEntered;
  await page.locator('#airdrop-detail-close').click();
  const completedReserve=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/airdrops/reserves'&&new URL(response.url()).searchParams.has('mint'));
  releaseReserve();await (await completedReserve).finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('#airdrop-selected-program')).toBeHidden();expect(proofRequests).toBe(1);
  await page.locator('#connect-button').click();
  await page.locator('#wallet-popover-disconnect').click();
  await expect(fundedBalance).toBeHidden();
  await expect(card).toContainText('Connect to check');
});
