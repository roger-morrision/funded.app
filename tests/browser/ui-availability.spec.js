import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
import {withConfiguredPoolSource,withUnconfiguredPoolSource,withRpcHtmlReads,rpcHtmlBody} from '../fixtures/configured-pool-rpc.js';
const mint='So11111111111111111111111111111111111111112';
const secondMint='11111111111111111111111111111111';
const launch=address=>({mint:address,name:'Availability QA',symbol:'AQA',cluster:'devnet',onchainVerified:true,
  creatorWallet:secondMint,communityAirdrop:{allocationPercent:3,reservedTokens:30_000_000}});
const active=address=>({mint:address,verified:true,status:'drop-active',reservedTokens:30_000_000,
  expiresAt:Math.floor(Date.now()/1000)+86400,snapshotHash:'fixture-snapshot',migrationSlot:123,leafCount:13,
  claimedBaseUnits:'0',totalBaseUnits:'30000000000000000'});
const offline=route=>new URL(route.request().url()).pathname==='/api/fee-policy'
  ? route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}):route.fulfill({status:503,json:{error:'Unavailable fixture'}});

for(const width of [390,1440])test(`RPC HTML errors remain concise and buy controls disabled at ${width}px`,async({page},info)=>{
  test.setTimeout(90_000); // This case starts a fresh Vite server with isolated source transforms.
  await page.setViewportSize({width,height:900});
  await withConfiguredPoolSource(info,async(origin)=>withRpcHtmlReads(page,info,origin,expect,async f=>{
    await page.goto(origin+'/#buybacks');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await expect(page.locator('#funded-buy-status')).toContainText('Solana connection could not be verified');
    await expect.poll(()=>f.configuredPoolReads().some(row=>row.complete&&row.status===502&&row.body===rpcHtmlBody&&row.requestfinishedAt&&row.bodyFinishedAt&&row.identityMatches)).toBe(true);
    await expect(page.locator('#funded-buy-status')).not.toContainText('private-test-value');
    await expect(page.locator('#funded-buy-status')).not.toContainText('<html');
    await expect(page.locator('#funded-burn-status')).toContainText('Burn verification is temporarily unavailable');
    await expect(page.locator('#funded-burn-status')).not.toContainText('private-test-value');
    await expect(page.locator('#funded-burn-status')).not.toContainText('<html');
    await expect(page.locator('#funded-buy-submit')).toBeDisabled();
    await expect(page.locator('#funded-buy-amount')).toBeDisabled();
    expect(await page.evaluate(()=>Boolean(window.phantom?.solana||window.solana))).toBe(false);
  }));
});

for(const width of [390,1440])test(`Canonical pool profile stays unavailable at ${width}px (canonical read-only APIs)`,async({page},info)=>{
  await page.setViewportSize({width,height:900});const origin=new URL(info.project.use.baseURL).origin;
  const declaredMint=String(process.env.VITE_FUNDED_TOKEN_MINT||'').trim(),declaredPool=String(process.env.VITE_FUNDED_SWAP_POOL||'').trim();
  const configured=Boolean(declaredMint&&declaredPool);
  await info.attach('canonical-pool-declared-profile',{body:JSON.stringify({declaredMint,declaredPool,configured,qualification:'Declared runner/build inputs; not inferred from UI or accepted as pool verification.'}),contentType:'application/json'});
  await withRpcHtmlReads(page,info,origin,expect,async f=>{
    await page.goto('/#buybacks');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await expect(page.locator('#funded-buy-status')).toHaveText(configured
      ?'Buy preview is temporarily unavailable. The Solana connection could not be verified. Try again shortly.'
      :'Buy preview is unavailable because the pool could not be verified. Try again shortly.');
    if(configured)await expect.poll(()=>f.configuredPoolReads(declaredPool).some(row=>row.complete&&row.status===502&&row.body===rpcHtmlBody&&row.requestfinishedAt&&row.bodyFinishedAt&&row.identityMatches)).toBe(true);
    else expect(f.rows.filter(row=>new URL(row.url).searchParams.get('purpose')==='trade-preview')).toEqual([]);
    await expect(page.locator('#funded-buy-submit')).toBeDisabled();
    await expect(page.locator('#funded-buy-amount')).toBeDisabled();
    for(const selector of ['#funded-buy-status','#funded-burn-status']){await expect(page.locator(selector)).not.toContainText('private-test-value');await expect(page.locator(selector)).not.toContainText('<html');}
    expect(await page.evaluate(()=>Boolean(window.phantom?.solana||window.solana))).toBe(false);
  });
});

for(const width of [390,1440])test(`Unconfigured source pool stays unavailable at ${width}px (explicit empty source defines)`,async({page},info)=>{
  test.setTimeout(90_000); // The isolated source server builds its own dependency cache.
  await page.setViewportSize({width,height:900});
  await withUnconfiguredPoolSource(info,async origin=>withRpcHtmlReads(page,info,origin,expect,async f=>{
    await page.goto(origin+'/#buybacks');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await expect(page.locator('#funded-buy-status')).toHaveText('Buy preview is unavailable because the pool could not be verified. Try again shortly.');
    expect(f.rows.filter(row=>new URL(row.url).searchParams.get('purpose')==='trade-preview')).toEqual([]);
    await expect(page.locator('#funded-buy-submit')).toBeDisabled();
    await expect(page.locator('#funded-buy-amount')).toBeDisabled();
    for(const selector of ['#funded-buy-status','#funded-burn-status']){await expect(page.locator(selector)).not.toContainText('private-test-value');await expect(page.locator(selector)).not.toContainText('<html');}
    expect(await page.evaluate(()=>Boolean(window.phantom?.solana||window.solana))).toBe(false);
  }));
});

for(const mode of ['outage','partial','pending','active'])test(`airdrop ${mode} state has truthful counts and snapshot labels`,async({page})=>{
  await page.setViewportSize({width:390,height:900});
  await page.route('https://**/*',route=>route.abort());await page.route('**/api/**',offline);
  await page.route('**/api/launches',route=>route.fulfill({json:mode==='partial'?[launch(mint),launch(secondMint)]:[launch(mint)]}));
  await page.route('**/api/airdrops/reserves',route=>mode==='outage'?route.fulfill({status:503,json:{error:'RPC unavailable'}})
    :route.fulfill({json:{cluster:'devnet',reserves:mode==='partial'?[active(mint),{mint:secondMint,verified:false,status:'unavailable'}]
      :mode==='active'?[active(mint)]:[{mint,verified:true,status:'funded',reservedTokens:30_000_000}]}}));
  await page.goto('/#airdrops');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const list=page.locator('#airdrop-directory'),distributed=page.locator('[data-public-airdrop-tab="distributed"]');
  await expect(list.locator('.airdrop-directory-card')).toHaveCount(mode==='partial'?2:1);
  // An open distribution with no delivered tokens is not a completed airdrop.
  await expect(distributed.locator('span')).toHaveText(['outage','partial'].includes(mode)?'—':'0');
  await list.getByRole('button',{name:'View airdrop',exact:true}).first().click();
  const panel=page.locator('#airdrop-selected-program');
  await panel.locator('.airdrop-verification-details summary').click();
  if(mode==='outage'){
    await expect(panel.locator('.airdrop-proof-value')).toHaveText(['-','-']);
    await expect(panel).not.toContainText('Not taken yet');
    await expect(panel.locator('[data-retry-community-mint]')).toBeVisible();
  }else if(mode==='pending'){
    await expect(panel).toContainText('Not taken yet');
    await expect(panel).toContainText('Automatic delivery follows migration');
  }else{
    await expect(panel).toContainText('slot 123');
    await expect(panel.locator('.airdrop-proof-value').first()).toHaveText('fixture-snapshot');
    await expect(panel).not.toContainText('Claim tokens');
  }
  await distributed.click();await expect(distributed).toHaveAttribute('aria-selected','true');
  await expect(list.locator('.airdrop-directory-card')).toHaveCount(0);
  await expect(page.locator('[data-public-airdrop-tab="curve"] span')).toHaveText('—');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('recorded buyback history does not imply current execution readiness',async({page})=>{
  await page.route('https://**/*',route=>route.abort());await page.route('**/api/**',offline);
  await page.route('**/api/buyback/status',route=>route.fulfill({json:{cluster:'devnet',executionReady:true,automationEnabled:true,
    dashboard:{status:'unavailable'},pending:[],receipts:[{mint,signature:'3'.repeat(64),slot:123,status:'finalized',
      vaultDebitVerified:true,burnInstructionVerified:true,burnedBaseUnits:'1000',spentLamports:'10000'}]}}));
  await page.goto('/#buybacks');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('.reward-buyback-stats')).toContainText('Recorded buybacks1');
  await expect(page.locator('.reward-source-note')).toHaveText('-');
  await expect(page.locator('#buyback-route-last-time')).toHaveText('Waiting for the next burn update');
  await expect(page.locator('#buyback-ledger')).toContainText('0.001 $FUNDED bought and burned');
});
