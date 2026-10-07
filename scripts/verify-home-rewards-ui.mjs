import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await preview({ configLoader: 'runner', preview: { host: '127.0.0.1', port: 0 } });
const previewOrigin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }), headless: true });
const now = Math.floor(Date.now() / 1000);
const mints = Array.from({ length: 7 }, (_, index) => String(index + 1).repeat(32));
const launches = mints.map((mint, index) => ({
  mint, symbol: 'T' + (index + 1), name: 'Token ' + (index + 1),
  imageUri: index === 0 ? 'https://metadata.funded.vip/devnet-images/' + mint : undefined,
  cluster: 'devnet', onchainVerified: true, createdTimestamp: now - index,
  feeDistribution: { creatorDirected: { shares: { holderAirdropPercent: [1, 6].includes(index) ? 0 : 10,
    solClaimPercent: index === 4 ? 30 : 0 }, recipients: { xAccount: index === 4 ? '@qa_x' : null } } },
  communityAirdrop: index < 5 || index === 6 ? {
    eligibility: { asset: '$FUNDED' }, reservedTokens: 250000 + index * 1000,
    allocationPercent: 2.5
  } : undefined
}));
const schedules = [mints[0], mints[5]].map((mint, index) => ({
  mint, asset: 'SOL', kind: 'holder', status: 'prepared',
  periodStart: now - 86400,
  cutoffAt: new Date((now - 20) * 1000).toISOString(),
  payoutAt: new Date((now + 180 + index * 60) * 1000).toISOString(),
  totalAmount: index === 0 ? '1250000000' : '900000000'
}));
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const fixture = async (context, evidenceStatus = 'onchain-indexed') => {
  await context.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Read-only fixture"}' }));
  await context.route('**/api/launches', route => route.fulfill(json(launches)));
  await context.route('**/api/listings/config', route => route.fulfill(json({ cluster:'devnet', fundedMint:mints[5] })));
  await context.route('**/api/tokens/' + mints[5] + '/token-accounts', route => route.fulfill(json({
    cluster:'devnet', mint:mints[5], coverage:'complete-account-list', accounts:[mints[1], mints[2], mints[3]]
      .map((wallet, index) => ({ address:mints[index], wallet, amount:'100' }))
  })));
  await context.route('**/api/rewards/automatic', route => route.fulfill(json({
    status: 'active', serverTime: new Date().toISOString(), schedules
  })));
  await context.route('**/api/rewards/experience', route => route.fulfill(json({
    cluster:'devnet', evidence:{ status:evidenceStatus }, wallet:null, events:[],
    community:{ allocatedLamports:'0', fundedLamports:'0' }, tokens:[
      { mint:mints[0], holderPaidWallets:2, holderPaidLamports:'1230000000', xPaidWallets:0, xPaidLamports:'0' },
      { mint:mints[4], holderPaidWallets:0, holderPaidLamports:'0', xPaidWallets:1, xPaidLamports:'250000000', totals:{ x:'500000000' } },
      ...[mints[2], mints[3], mints[5]].map(mint => ({ mint, holderPaidWallets:0, holderPaidLamports:'0', xPaidWallets:0, xPaidLamports:'0' }))
    ].map(row => ({ ...row, holderSharePercent:0 }))
  })));
  await context.route('**/api/x-fee/status', route => route.fulfill(json({ ready:false, reasons:['X OAuth is not configured'] })));
  await context.route('**/api/airdrops/reserves', route => route.fulfill(json({
    cluster: 'devnet', claimPolicy:{ unclaimedRecipient:mints[3] }, reserves: [{ mint: mints[0], verified: true, status: 'drop-active',
      reservedTokens: 250000, migrationSlot: 123456789, migrationAt: now - 1000, expiresAt: now + 3600,
      leafCount:3, claimedWalletCount:2, totalBaseUnits:'250000', claimedBaseUnits:'50' },
    { mint: mints[1], verified: true, status: 'drop-active', reservedTokens: 251000, expiresAt: now - 60 },
    { mint: mints[2], verified: false, status: 'unfunded', reservedTokens: 252000 },
    { mint: mints[3], verified: true, status: 'drop-closed', reservedTokens: 253000 },
    { mint: mints[4], verified: true, status: 'funded', reservedTokens: 254000 },
    { mint: mints[6], verified: true, status: 'drop-active', reservedTokens: 256000,
      expiresAt: now + 3600, totalBaseUnits:'256000', claimedBaseUnits:'256000' }]
  })));
  await context.route('**/devnet-images/**', route => route.fulfill({
    status: 200, contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#86efac"/></svg>'
  }));
};
await mkdir('.tmp-ui-evidence', { recursive: true });
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 800 }, reducedMotion: 'reduce' });
  await fixture(desktop);
  const page = await desktop.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${previewOrigin}/#overview`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.home-reward-token-card').length === 8);
  await page.waitForFunction(() => document.querySelector('[data-home-reward-grid="funded"]')?.textContent.includes('~2 wallets'));
  await page.waitForFunction(() => document.querySelector('[data-home-reward-grid="coin"]')?.textContent.includes('1.23 SOL'));
  assert.deepEqual(await page.locator('.home-rewards-heading h2').allInnerTexts(), ['$FUNDED holders', 'Coin holders', 'X accounts']);
  const fundedGroup = page.locator('[data-home-reward-grid="funded"]');
  const coinGroup = page.locator('[data-home-reward-grid="coin"]');
  const xGroup = page.locator('[data-home-reward-grid="x"]');
  assert.equal(await fundedGroup.locator('.home-reward-token-card').count(), 2);
  assert.equal(await fundedGroup.locator('.home-reward-token-card[data-reward-mint="' + mints[1] + '"]').count(), 0);
  assert.equal(await fundedGroup.locator('.home-reward-token-card[data-reward-mint="' + mints[3] + '"]').count(), 0);
  assert.equal(await fundedGroup.locator('.home-reward-token-card[data-reward-mint="' + mints[6] + '"]').count(), 0);
  assert.equal(await coinGroup.locator('.home-reward-token-card').count(), 5);
  assert.equal(await xGroup.locator('.home-reward-token-card').count(), 1);
  const sectionBoxes = await Promise.all(['funded','coin','x'].map(kind =>
    page.locator(`[data-home-reward-section="${kind}"]`).boundingBox()));
  assert(sectionBoxes.every(Boolean));
  assert(Math.max(...sectionBoxes.map(box => box.y)) - Math.min(...sectionBoxes.map(box => box.y)) < 3,
    'Desktop reward sections must share one row');
  const visibleCards = await coinGroup.evaluate(track =>
    track.clientWidth / track.querySelector('article').getBoundingClientRect().width);
  assert(visibleCards >= 2 && visibleCards < 2.4, `Desktop should show two coin cards per section (actual ${visibleCards})`);
  assert.equal(await coinGroup.locator('.home-reward-token-card[data-reward-mint="' + mints[1] + '"]').count(), 0);
  const first = fundedGroup.locator('.home-reward-token-card[data-reward-mint="' + mints[0] + '"]');
  assert.match(await first.textContent(), /T1/);
  assert.match(await first.textContent(), /250,000 T1/);
  assert.match(await first.textContent(), /Claims open/);
  assert.match(await first.textContent(), /Recipients3 wallets/);
  assert.match(await first.textContent(), /Paid wallets2 wallets/);
  assert.match(await first.textContent(), /Tokens received50 T1/);
  assert.match(await first.textContent(), /\$FUNDED snapshot · .*slot 123,456,789/);
  assert.doesNotMatch(await first.textContent(), /SOL allocation|holder cutoff/);
  assert.match(await first.locator('.home-reward-clock-label').textContent(), /Claim window closes in/);
  await first.locator('.home-reward-token-logo img').waitFor();
  const coinFirst = coinGroup.locator('.home-reward-token-card[data-reward-mint="' + mints[0] + '"]');
  assert.match(await coinFirst.textContent(), /1.25 SOL/);
  assert.match(await coinFirst.textContent(), /Paid wallets2 wallets/);
  assert.match(await coinFirst.textContent(), /SOL received1\.23 SOL/);
  assert.match(await coinFirst.textContent(), /Holder cutoff ·/);
  assert.doesNotMatch(await coinFirst.textContent(), /Airdrop/);
  const solOnly = coinGroup.locator('.home-reward-token-card[data-reward-mint="' + mints[5] + '"]');
  assert.match(await solOnly.textContent(), /0.9 SOL/);
  assert.match(await solOnly.locator('.home-reward-clock-label').textContent(), /Distribution prepared/);
  assert.equal(await fundedGroup.locator('.home-reward-token-card[data-reward-mint="' + mints[2] + '"]').count(), 0);
  assert.doesNotMatch(await fundedGroup.textContent(), /Vault unverified|Vault unfunded/);
  const upcoming = fundedGroup.locator('.home-reward-token-card[data-reward-mint="' + mints[4] + '"]');
  assert.match(await upcoming.textContent(), /Est\. receivers~2 wallets/);
  assert.match(await upcoming.textContent(), /Paid wallets0 wallets/);
  assert.match(await upcoming.textContent(), /Tokens received0 T5/);
  const xCard = xGroup.locator('.home-reward-token-card');
  assert.match(await xCard.textContent(), /@qa_x/);
  assert.match(await xCard.textContent(), /30%/);
  assert.match(await xCard.textContent(), /X payouts unavailable/);
  assert.match(await xCard.textContent(), /Unclaimed0\.25 SOL/);
  assert.match(await xCard.textContent(), /Claimed0\.25 SOL/);
  assert.doesNotMatch(await xCard.textContent(), /Policy · receipts/);
  const xProfile = xCard.locator('.home-reward-snapshot a');
  assert.equal(await xProfile.getAttribute('href'), 'https://x.com/qa_x');
  assert.equal(await xProfile.getAttribute('target'), '_blank');
  assert.match(await xProfile.getAttribute('rel'), /noopener noreferrer/);
  assert(await xProfile.evaluate(link => {
    const rect = link.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === link;
  }), 'The X profile link must be clickable above the card-wide token link');
  assert.doesNotMatch(await xCard.textContent(), /Paid wallets|SOL received/);
  assert.doesNotMatch(await xCard.textContent(), /Airdrop|SOL allocation/);
  const before = await first.locator('.home-reward-clock').textContent();
  await page.waitForTimeout(1200);
  assert.notEqual(await first.locator('.home-reward-clock').textContent(), before);
  const track = coinGroup;
  assert(await track.evaluate(element => element.scrollWidth > element.clientWidth));
  await track.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  assert(await track.evaluate(element => element.scrollLeft > 0));
  const section = await page.locator('[data-home-reward-section="funded"]').boundingBox();
  await track.evaluate(element => { element.scrollLeft = 0; });
  await page.screenshot({ path: '.tmp-ui-evidence/holder-reward-cards-desktop.png' });
  assert(section && section.height < 420, 'Home rewards section should remain compact');
  assert.equal(errors.length, 0, errors.join('\n'));
  await desktop.close();

  const partial = await browser.newContext({ viewport: { width: 1440, height: 800 }, reducedMotion: 'reduce' });
  await fixture(partial, 'partial');
  const partialPage = await partial.newPage();
  await partialPage.goto(`${previewOrigin}/#overview`, { waitUntil: 'domcontentloaded' });
  await partialPage.waitForFunction(() => document.querySelector('[data-home-reward-grid="x"]')?.textContent.includes('≥0.25 SOL'));
  const partialX = await partialPage.locator('[data-home-reward-grid="x"] .home-reward-token-card').innerText();
  assert.match(partialX, /Unclaimed\s*—/);
  assert.match(partialX, /Claimed\s*≥0\.25 SOL/);
  await partial.close();

  const wide = await browser.newContext({ viewport: { width: 1920, height: 900 }, reducedMotion: 'reduce' });
  await fixture(wide);
  const widePage = await wide.newPage();
  await widePage.goto(`${previewOrigin}/#overview`, { waitUntil: 'domcontentloaded' });
  await widePage.waitForFunction(() => document.querySelectorAll('.home-reward-token-card').length === 8);
  const wideVisible = await widePage.locator('[data-home-reward-grid="coin"]').evaluate(track =>
    track.clientWidth / track.querySelector('article').getBoundingClientRect().width);
  assert(wideVisible >= 3 && wideVisible < 3.4, 'Wide desktop should show three cards per section');
  await wide.close();

  const moving = await browser.newContext({ viewport: { width: 1440, height: 800 }, reducedMotion: 'no-preference' });
  await fixture(moving);
  const movingPage = await moving.newPage();
  await movingPage.goto(`${previewOrigin}/#overview`, { waitUntil: 'domcontentloaded' });
  await movingPage.waitForFunction(() => document.querySelector('[data-home-reward-grid="coin"]')?.scrollLeft > 5,
    null, { timeout: 10000 });
  assert.equal(await movingPage.locator('[data-home-reward-grid="x"]').evaluate(track => track.scrollLeft), 0,
    'A section without overflow must stay still');
  await moving.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await fixture(mobile);
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${previewOrigin}/#overview`, { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForFunction(() => document.querySelectorAll('.home-reward-token-card').length === 8);
  const mobileTrack = mobilePage.locator('[data-home-reward-grid="coin"]');
  assert(await mobileTrack.evaluate(element => element.scrollWidth > element.clientWidth));
  await mobileTrack.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  assert(await mobileTrack.evaluate(element => element.scrollLeft > 0));
  await mobileTrack.evaluate(element => { element.scrollLeft = 0; });
  assert(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await mobilePage.screenshot({ path: '.tmp-ui-evidence/holder-reward-cards-mobile.png' });
  await mobile.close();
  console.log('Holder reward cards passed: per-token values, logo, proof, countdowns, overflow motion, and mobile scrolling (read-only fixtures).');
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
