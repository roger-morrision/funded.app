import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const mint='So11111111111111111111111111111111111111112';
for(const width of [390,1440])test(`selected mint retries without waiting for the directory at ${width}px (mocked)`,async({page})=>{
  await page.setViewportSize({width,height:900});
  let full=0,scoped=0,release;
  const blocked=new Promise(resolve=>{release=resolve;});
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',r=>r.fulfill({status:503,json:{}}));
  await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/launches',r=>r.fulfill({json:[{mint,name:'Scoped QA',symbol:'SQA',cluster:'devnet',onchainVerified:true,
    creatorWallet:'11111111111111111111111111111111',communityAirdrop:{allocationPercent:3,reservedTokens:30000000}}]}));
  await page.route('**/api/airdrops/reserves*',async r=>{
    if(!new URL(r.request().url()).searchParams.has('mint')){full++;await blocked;return r.fulfill({json:{cluster:'devnet',reserves:[]}});}
    scoped++;
    if(scoped===1)return r.fulfill({status:503,json:{}});
    return r.fulfill({json:{cluster:'devnet',reserves:[{mint,verified:true,status:'drop-active',reservedTokens:30000000,
      totalBaseUnits:'30000000000000',claimedBaseUnits:'30056',leafCount:13,snapshotHash:'hash',merkleRoot:'root',migrationSlot:1,
      expiresAt:Math.floor(Date.now()/1000)+86400,snapshotBasis:'pump-migration'}]}});
  });
  try{
    await page.goto(`/?airdropMint=${mint}#airdrops`);
    const retry=page.locator('[data-retry-community-mint]');await expect(retry).toBeVisible();
    await retry.click();await expect(page.locator('#airdrop-selected-status')).toContainText('Connect wallet to check allocation');
    expect(scoped).toBe(2);expect(full).toBe(1);
    release();await expect(page.locator('#airdrop-selected-eyebrow')).toHaveText('Airdrop funding confirmed');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }finally{release();}
});
