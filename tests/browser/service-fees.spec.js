import { test, expect } from '@playwright/test';
import { serviceFeeSnapshot } from '../../server/service-fees.mjs';
import { DEFAULT_SERVICE_FEES } from '../../service-fees.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
const TREASURY='CmhmRtKYExJC76R5nsPV9ovPYacoEQFEL7VhaKRZmLy2';
const ADMIN='CG87C9tjCSB9BAoKfoPUM3mLvbg3WAK1NGNQCWi12zcJ';
async function mock(page,policy=DEFAULT_SERVICE_FEES) {
  let snapshot=serviceFeeSnapshot({adminSettings:{serviceFees:{policy,revision:0}}}), saved;
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const send=json=>route.fulfill({json});
    if(path==='/api/service-fees')return send({...snapshot,cluster:'devnet',recipient:TREASURY,tradeRecipient:TREASURY});
    if(path==='/api/fee-policy')return send({split:PROTOCOL_FEE_SPLIT});
    if(path==='/api/listings/config')return send({enabled:false,cluster:'devnet',usd:snapshot.policy.listingUsd});
    if(path==='/api/admin/session')return send({wallet:ADMIN,expiresAt:new Date(Date.now()+600000).toISOString()});
    if(path==='/api/admin/service-fees') {
      if(route.request().method()==='POST'){
        saved=route.request().postDataJSON();
        expect(saved.expectedRevision).toBe(snapshot.revision); expect(saved.expectedHash).toBe(snapshot.hash);
        snapshot=serviceFeeSnapshot({adminSettings:{serviceFees:{policy:saved.policy,revision:snapshot.revision+1}}});
      }
      return send(snapshot);
    }
    if(path==='/api/admin/overview')return send({wallets:[],withdrawalDestinations:[],gates:{},revenue:{verifiedCollectionsLamports:'0',operationsAllocationLamports:'0',finalizedSettlementCount:0}});
    if(path==='/api/admin/audit')return send({entries:[]});
    if(path==='/api/admin/vaults')return send({vaults:[],totalLaunches:0,nextOffset:null});
    return route.fulfill({status:503,json:{error:'Offline test fixture'}});
  });
  return { saved:()=>saved };
}

for(const width of [1440,390])test(`new fee schedule is consistent in launch, listings and docs at ${width}px`,async({page})=>{
  await mock(page); await page.setViewportSize({width,height:1000});
  await page.goto('/#launch'); await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#cost-tier-label')).toContainText('0.02 SOL');
  await expect(page.locator('.creator-burn-section [data-burn-tier="pro"] > span')).toContainText('$150');
  await expect(page.locator('.creator-burn-section [data-burn-tier="premier"] > span')).toContainText('$300');
  await page.goto('/#capital-flow'); await expect(page.locator('#service-fee-guide')).toContainText('0.75% on buys and sells');
  await expect(page.locator('#service-fee-guide')).toContainText('Listing is included');
  await page.goto('/#docs/fees'); await expect(page.locator('#docs')).toContainText('Every coin launch: 0.02 SOL');
  await page.goto('/#list'); await expect(page.locator('#list-burn-disclosure')).toContainText('$300');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('published admin prices replace build defaults across all price displays',async({page})=>{
  await mock(page,{...DEFAULT_SERVICE_FEES,tradeBps:80,launchLamports:'30000000',proUsd:175,premierUsd:350,listingUsd:400});
  await page.goto('/#launch'); await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('.creator-burn-section [data-burn-tier="pro"] > span')).toContainText('$175');
  await expect(page.locator('#cost-tier-label')).toContainText('0.03 SOL');
  await page.goto('/#capital-flow'); await expect(page.locator('#service-fee-guide')).toContainText('0.8% on buys and sells');
  await page.goto('/#list'); await expect(page.locator('#list-burn-disclosure')).toContainText('$400');
});

test('admin edits and reviews service fees with revision and audit reason',async({page})=>{
  const fixture=await mock(page); await page.goto('/admin.html');
  await expect(page.locator('#service-fee-form')).toBeVisible();
  await expect(page.locator('#service-fee-form [name=tradePercent]')).toHaveValue('0.75');
  await page.locator('#service-fee-form [name=tradePercent]').fill('0.8');
  await page.locator('#service-fee-form [name=launchSol]').fill('0.03');
  await page.locator('#service-fee-form [name=reason]').fill('Reviewed Devnet test pricing change');
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Launch: 0.03 SOL');await dialog.accept();});
  await page.locator('#service-fee-form [type=submit]').click();
  await expect(page.locator('[data-service-revision]')).toContainText('Revision 1');
  expect(fixture.saved().policy.tradeBps).toBe(80);
  expect(fixture.saved().policy.launchLamports).toBe('30000000');
  await page.setViewportSize({width:390,height:1000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
