import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.FUNDED_VERIFY_ORIGIN || 'https://funded.vip';
const browser = await chromium.launch({ channel:'chrome', headless:true });
try {
  const page = await browser.newPage({ viewport:{ width:1280, height:900 }, reducedMotion:'reduce' });
  await page.goto(`${origin}/#overview`, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('[data-home-reward-grid] .home-reward-token-card');
    return cards.length > 0 && !document.querySelector('[data-home-reward-grid="funded"] .home-rewards-empty')?.textContent.includes('Checking');
  }, null, { timeout:60000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.home-rewards-spotlight .home-rewards-grid')].length === 3
    && [...document.querySelectorAll('.home-rewards-spotlight .home-rewards-grid')]
      .every(track => track.dataset.carouselReady === '1'), null, { timeout:10000 });
  const [launches, reserves, experience] = await Promise.all([
    page.evaluate(() => fetch('/api/launches').then(response => response.json())),
    page.evaluate(() => fetch('/api/airdrops/reserves').then(response => response.json())),
    page.evaluate(() => fetch('/api/rewards/experience').then(response => response.json())),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const completed = new Set((reserves.reserves || []).filter(row => row.status === 'drop-closed'
    || (row.status === 'drop-active' && (Number(row.expiresAt) <= now
      || (/^[0-9]+$/.test(String(row.totalBaseUnits)) && BigInt(row.totalBaseUnits) > 0n
        && String(row.claimedBaseUnits) === String(row.totalBaseUnits))))).map(row => row.mint));
  const counts = await page.evaluate(() => Object.fromEntries(['funded','coin','x'].map(kind => [kind,
    [...document.querySelectorAll(`[data-home-reward-grid="${kind}"] .home-reward-token-card`)]
      .map(card => card.dataset.rewardMint)])));
  const layout = await page.evaluate(() => {
    const sections = [...document.querySelectorAll('.home-rewards-spotlight')];
    const coin = document.querySelector('[data-home-reward-grid="coin"]');
    return {
      tops:sections.map(section => section.getBoundingClientRect().top),
      visibleCoinCards:coin.clientWidth / coin.querySelector('article').getBoundingClientRect().width,
      carouselReady:sections.map(section => section.querySelector('.home-rewards-grid')?.dataset.carouselReady || ''),
    };
  });
  assert(Math.max(...layout.tops) - Math.min(...layout.tops) < 3, 'Reward sections are not on one desktop row');
  assert(layout.visibleCoinCards >= 2 && layout.visibleCoinCards < 2.4, 'Desktop card width is incorrect');
  assert(layout.carouselReady.every(value => value === '1'), `Not all reward sections have a carousel: ${layout.carouselReady}`);
  assert(counts.funded.every(mint => !completed.has(mint)), 'Completed airdrop is still on the overview');
  assert(counts.funded.every(mint => launches.some(launch => launch.mint === mint)), 'Card has no verified launch');
  const xCards = await page.locator('[data-home-reward-grid="x"] .home-reward-token-card').evaluateAll(cards =>
    cards.map(card => ({ mint:card.dataset.rewardMint, text:card.innerText })));
  const paidByMint = new Map((experience.tokens || []).map(row => [row.mint, row]));
  const formatSol = value => {
    const lamports = BigInt(value);
    if (lamports === 0n) return '0 SOL';
    return `${lamports / 1_000_000_000n}.${String(lamports % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '')} SOL`;
  };
  for (const card of xCards) {
    assert(!card.text.includes('Paid wallets') && card.text.includes('Unclaimed') && card.text.includes('Claimed'));
    const row = paidByMint.get(card.mint);
    if (experience.evidence?.status === 'onchain-indexed' && row
      && /^[0-9]+$/.test(String(row.totals?.x)) && /^[0-9]+$/.test(String(row.xPaidLamports))) {
      const unclaimed = BigInt(row.totals.x) - BigInt(row.xPaidLamports);
      if (unclaimed >= 0n) {
        assert(card.text.includes(formatSol(unclaimed)), 'X unclaimed amount differs from verified allocation');
        assert(card.text.includes(formatSol(row.xPaidLamports)), 'X claimed amount differs from verified payouts');
      }
    }
  }
  const fundedState = await page.locator('[data-home-reward-grid="funded"]').innerText();
  console.log(JSON.stringify({ origin, launched:launches.length, completedAirdrops:completed.size,
    displayed:{ funded:counts.funded.length, coin:counts.coin.length, x:counts.x.length },
    fundedState:counts.funded.length ? 'cards' : fundedState.slice(0, 100) }));
} finally {
  await browser.close();
}
