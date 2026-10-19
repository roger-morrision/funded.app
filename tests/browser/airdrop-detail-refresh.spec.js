import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const mint='So11111111111111111111111111111111111111112';
for(const width of [1440,390])test(`open airdrop details refresh when delayed reserve verification completes at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  let release;const delayed=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/launches',route=>route.fulfill({json:[{mint,name:'Delayed QA',symbol:'DQA',cluster:'devnet',onchainVerified:true,
    creatorWallet:'11111111111111111111111111111111',communityAirdrop:{allocationPercent:3,reservedTokens:30000000}}]}));
  await page.route('**/api/airdrops/reserves',async route=>{await delayed;await route.fulfill({json:{cluster:'devnet',reserves:[{mint,verified:true,status:'drop-active',
    reservedTokens:30000000,totalBaseUnits:'30000000000000',claimedBaseUnits:'870114755',leafCount:13,snapshotHash:'verified-snapshot',merkleRoot:'verified-root',migrationSlot:512511237,
    migrationAt:Math.floor(Date.now()/1000)-60,expiresAt:Math.floor(Date.now()/1000)+86400,snapshotBasis:'pump-migration'}]}});});
  await page.route('https://**/*',route=>route.abort());
  await page.goto('/#airdrops');const card=page.locator(`.airdrop-directory-card[data-logo-mint="${mint}"]`);await expect(card).toBeVisible();
  await card.locator('.directory-claim').click();const panel=page.locator('#airdrop-selected-program');await expect(panel).toBeVisible();
  await expect(page.locator('#airdrop-selected-stats')).toContainText('Checking');release();
  const claimed=page.locator('#airdrop-selected-stats > span').filter({has:page.locator('small').filter({hasText:/^Claimed$/})}).locator('strong');
  await expect(claimed).toHaveText('870.114755');await expect(panel).toContainText('Connect wallet to check allocation');
  await expect(page.locator('#airdrop-selected-eyebrow')).toHaveText('Airdrop funding confirmed');
});
