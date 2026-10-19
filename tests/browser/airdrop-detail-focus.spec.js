import {test,expect} from '@playwright/test';
import {PublicKey} from '@solana/web3.js';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

const mints=Array.from({length:12},(_,index)=>new PublicKey(new Uint8Array(32).fill(index+1)).toBase58());
const launches=mints.map((mint,index)=>({mint,name:`Focus QA ${index+1}`,symbol:`FQ${index+1}`,
  cluster:'devnet',onchainVerified:true,creatorWallet:'11111111111111111111111111111111',
  communityAirdrop:{allocationPercent:3,reservedTokens:30000000}}));

async function fixture(page){
  let release;
  const delayed=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/launches',route=>route.fulfill({json:launches}));
  await page.route('**/api/airdrops/reserves',async route=>{
    await delayed;
    await route.fulfill({json:{cluster:'devnet',reserves:[{mint:mints[1],verified:true,status:'drop-active',
      reservedTokens:30000000,totalBaseUnits:'30000000000000',claimedBaseUnits:'870114755',
      leafCount:13,snapshotHash:'verified-snapshot',merkleRoot:'verified-root',migrationSlot:512511237,
      migrationAt:Math.floor(Date.now()/1000)-60,expiresAt:Math.floor(Date.now()/1000)+86400,
      snapshotBasis:'pump-migration'}]}});
  });
  await page.route('https://**/*',route=>route.abort());
  await page.goto('/#airdrops');
  await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
  await expect(page.locator('#airdrop-directory [data-directory-mint]')).toHaveCount(10);
  return release;
}

const focusVisible=(page,height)=>expect.poll(()=>page.evaluate(viewportHeight=>{
  const box=document.activeElement.getBoundingClientRect();
  return box.top>=0&&box.bottom<=viewportHeight&&document.documentElement.scrollWidth<=innerWidth;
},height)).toBe(true);

for(const [width,height] of [[390,844],[1440,900]]){
  test(`airdrop selection, passive refresh and close keep focus in context at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height});
    const release=await fixture(page);
    const panel=page.locator('#airdrop-selected-program');
    const first=page.locator(`#airdrop-directory [data-directory-mint="${mints[0]}"]`);
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-mint',mints[0]);
    await expect(page.locator('#airdrop-selected-title')).toBeFocused();
    await expect(first).toHaveAttribute('aria-expanded','true');
    await focusVisible(page,height);
    await page.keyboard.press('Tab');
    await expect(page.locator('#airdrop-detail-close')).toBeFocused();
    const summary=page.locator('#airdrop-selected-stats summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(summary).toBeFocused();
    const scrollBefore=await page.evaluate(()=>scrollY);
    release();
    await expect(page.locator('#airdrop-selected-eyebrow')).toHaveText('Airdrop verification unavailable');
    await expect(summary).toBeFocused();
    await expect(page.locator('#airdrop-selected-stats details')).toHaveAttribute('open','');
    expect(Math.abs((await page.evaluate(()=>scrollY))-scrollBefore)).toBeLessThan(2);
    await page.locator('#airdrop-detail-close').click();
    await expect(panel).toBeHidden();
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('aria-expanded','false');
    await focusVisible(page,height);
    await expect(page.locator('#airdrop-directory-range')).toContainText('page 1 / 2');
    await expect(page.locator('#airdrop-search')).toHaveValue('');
    const second=page.locator(`#airdrop-directory [data-directory-mint="${mints[1]}"]`);
    await second.click();
    await expect(panel).toHaveAttribute('data-mint',mints[1]);
    await expect(page.locator('#airdrop-selected-title')).toBeFocused();
    await expect(page.locator('#airdrop-selected-eyebrow')).toHaveText('Airdrop funding confirmed');
    await expect(second).toHaveAttribute('aria-expanded','true');
    await focusVisible(page,height);
  });

  test(`closing or switching selection before delayed verification never reopens stale detail at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height});
    await page.emulateMedia({reducedMotion:'reduce'});
    const release=await fixture(page);
    const panel=page.locator('#airdrop-selected-program');
    const first=page.locator(`#airdrop-directory [data-directory-mint="${mints[0]}"]`);
    await first.focus();
    await page.keyboard.press('Space');
    await page.locator('#airdrop-detail-close').click();
    await expect(first).toBeFocused();
    release();
    const second=page.locator(`#airdrop-directory [data-directory-mint="${mints[1]}"]`);
    await expect(page.locator(`.airdrop-directory-card[data-logo-mint="${mints[1]}"] .directory-funding-line`)).toHaveText('Funding: Confirmed');
    await expect(panel).toBeHidden();
    await expect(first).toBeFocused();
    await second.click();
    await expect(panel).toHaveAttribute('data-mint',mints[1]);
    await expect(page.locator('#airdrop-selected-title')).toBeFocused();
    await focusVisible(page,height);
    await page.locator(`#airdrop-directory [data-directory-mint="${mints[1]}"]`).evaluate(button=>button.remove());
    await page.locator('#airdrop-detail-close').click();
    await expect(panel).toBeHidden();
    await expect(page.locator('#airdrop-search')).toBeFocused();
    await focusVisible(page,height);
    await page.locator('#airdrop-search').fill('no such token');
    await expect(panel).toBeHidden();
    await expect(page.locator('#airdrop-search')).toHaveValue('no such token');
    await expect(page.locator('#airdrop-search')).toBeFocused();
    await expect(page.locator('#airdrop-directory')).toContainText('No airdrops match your search');
  });
}
