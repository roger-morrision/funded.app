import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const mint = '9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
const packages = [
  { tier: 'standard', amount: 0, artwork: false, profileParent: 'coin-side-column' },
  { tier: 'boost', amount: 25_000, artwork: true, profileParent: 'coin-hero-aside' },
  { tier: 'pro', amount: 100_000, artwork: true, profileParent: 'coin-hero-aside' },
  { tier: 'premier', amount: 250_000, artwork: true, profileParent: 'coin-hero-aside' },
  { tier: 'unknown', claimTier: 'pro', amount: 100_000, artwork: false, profileParent: 'coin-side-column' },
];

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }), headless: true });
try {
  for (const { tier, claimTier, amount, artwork, profileParent } of packages) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    try {
      const signature = `fixture-${tier}-launch`;
      const launch = {
        mint, cluster: 'devnet', onchainVerified: true, creatorWallet: mint,
        signature, name: `${tier} fixture token`, symbol: 'PKG',
        ...(amount ? { creatorLaunchBurn: {
          tier: claimTier || tier, amountTokens: amount, status: 'verified',
          receipt: { verified: true, atomicWithPumpLaunch: true, signature: claimTier ? 'wrong-launch-signature' : signature },
        } } : {}),
      };
      await context.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"mocked offline API"}' }));
      await context.route('**/api/launches', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([launch]) }));
      const page = await context.newPage();
      await page.goto(`${base}/token/${mint}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(expected => document.body.classList.contains('workspace-ready')
        && document.querySelector('.coin-hero-card')?.dataset.launchTier === expected, tier, { timeout: 30_000 });
      const desktop = await page.evaluate(() => {
        const hero = document.querySelector('.coin-hero-card');
        const image = hero.querySelector('.coin-artwork');
        const profile = document.querySelector('#coin-profile');
        return {
          artworkDisplay: getComputedStyle(image).display,
          artworkHeight: image.offsetHeight,
          profileParent: profile.parentElement.className,
          packageText: document.querySelector('#coin-promotion-badge')?.textContent || '',
          proof: document.querySelector('#coin-promotion-badge a')?.getAttribute('href') || '',
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.equal(desktop.artworkDisplay !== 'none', artwork, `${tier} desktop artwork`);
      assert.equal(desktop.profileParent, profileParent, `${tier} profile placement`);
      assert(desktop.packageText.toLowerCase().includes(tier === 'unknown' ? 'unverified' : tier), `${tier} package label`);
      assert.equal(Boolean(desktop.proof), artwork, `${tier} burn proof link`);
      assert.equal(desktop.overflow, false, `${tier} desktop overflow`);

      await page.setViewportSize({ width: 390, height: 844 });
      const mobile = await page.evaluate(() => {
        const hero = document.querySelector('.coin-hero-card');
        const image = hero.querySelector('.coin-artwork');
        return {
          artworkDisplay: getComputedStyle(image).display,
          artworkHeight: image.offsetHeight,
          imageRight: image.getBoundingClientRect().right,
          heroRight: hero.getBoundingClientRect().right,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.equal(mobile.artworkDisplay !== 'none', artwork, `${tier} mobile artwork`);
      assert.equal(mobile.overflow, false, `${tier} mobile overflow`);
      if (artwork) assert(mobile.imageRight <= mobile.heroRight + 1, `${tier} artwork is clipped by the hero`);
      if (tier === 'pro') assert(mobile.artworkHeight > 150, 'Pro banner should be taller than Boost');
      if (tier === 'premier') assert(mobile.artworkHeight > 180, 'Premier banner should be taller than Pro');
      for (const width of [320, 768]) {
        await page.setViewportSize({ width, height: 844 });
        const layout = await page.evaluate(() => {
          const hero = document.querySelector('.coin-hero-card').getBoundingClientRect();
          const image = document.querySelector('.coin-artwork').getBoundingClientRect();
          return {
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            imageVisible: getComputedStyle(document.querySelector('.coin-artwork')).display !== 'none',
            imageRight: image.right,
            heroRight: hero.right,
          };
        });
        assert.equal(layout.overflow, false, `${tier} ${width}px overflow`);
        assert.equal(layout.imageVisible, artwork, `${tier} ${width}px artwork`);
        if (artwork) assert(layout.imageRight <= layout.heroRight + 1, `${tier} ${width}px artwork clipping`);
      }
    } finally {
      await context.close();
    }
  }
  console.log('Coin package UI: four verified tiers, forged receipt rejection, 320/390/768/1440px layout, and overflow passed (mocked API; local-only).');
} finally {
  await browser.close();
}
