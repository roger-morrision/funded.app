import { test, expect } from '@playwright/test';
import { marketingAgencyCapabilities } from '../../server/marketing-agency-policy.mjs';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
import {agencyProtocolSplit} from '../../agency-mint-router-v3.js';

test.beforeEach(async ({ page, baseURL }) => {
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/fee-policy') return route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } });
    if (path === '/api/marketing-agency') return route.fulfill({ json: { ...marketingAgencyCapabilities(),
      funding: { status: 'unavailable', collectedLamports: null, spentLamports: null }, history: [], launches: [] } });
    return route.fulfill({ status: 503, json: { error: 'Offline QA fixture' } });
  });
  await page.route('https://**/*', route => new URL(route.request().url()).origin===new URL(baseURL).origin?route.fallback():route.abort());
});

for (const width of [1440, 390]) test(`dedicated agency menu, clear readiness and own-coin triggers at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/#marketing-agency');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#marketing-agency')).toBeVisible();
  await expect(page.locator('.primary-nav a[href="#marketing-agency"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-route-label]')).toHaveText('AI Marketing');
  await expect(page.locator('.agency-agent')).toHaveCount(3);
  await expect(page.locator('.agency-agent-grid')).toHaveCSS('display', 'grid');
  await expect(page.locator('.agency-agent').nth(1)).toContainText('$100,000');
  await expect(page.locator('.agency-agent').nth(2)).toContainText('$300,000');
  await expect(page.locator('[data-agency-status]')).toContainText('Current agency readiness is unavailable');
  await expect(page.locator('[data-agency-funded]')).toHaveText('Unavailable');
  await expect(page.locator('[data-agency-history]')).toContainText('Earlier receipt history is unavailable');
  await expect(page.locator('.agency-policy')).toContainText('1% referrals · 2% AI marketing & coin buybacks');
  await expect(page.locator('.agency-policy')).toContainText('L1 0.6% · L2 0.25% · L3 0.15%');
  await expect(page.locator('.agency-policy')).toContainText('each buy and burn the launched coin once');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (width === 1440) await page.screenshot({ path: 'tmp/agency-desktop.png', fullPage: true, animations: 'disabled' });
  else await page.screenshot({ path: 'tmp/agency-mobile.png', fullPage: true, animations: 'disabled' });
});

for(const width of [320,390,1440])test(`X promotion is included only with a promotion package at ${width}px (mocked APIs)`, async ({ page },info) => {
  await page.setViewportSize({width,height:900});await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
  await page.locator('#token-name').fill('Agency QA');await page.locator('#token-symbol').fill('AQA');await page.locator('#launch-next').click();
  const team=page.locator('#launch-agency-options');await expect(team).toBeVisible();
  await expect(team.locator('input')).toHaveCount(0);await expect(team.locator('[data-launch-agent]')).toHaveCount(3);
  const check=async promoted=>{await expect(team.locator('.agency-included-badge')).toHaveText([promoted?'Included':'Promotion only','Included','Included']);await expect(team.locator('[data-included="true"]')).toHaveCount(promoted?3:2);await expect(page.locator('[data-agency-split]')).toContainText(`across the ${promoted?3:2} included agents`);};
  await check(false);await expect(page.locator('#launch-button')).toBeDisabled();
  for(const tier of ['pro','premier']){await page.locator(`button[data-burn-tier="${tier}"]`).click();await check(true);await expect(page.locator('#launch-promotion-requirements')).toBeVisible();}
  await team.screenshot({path:info.outputPath(`promoted-agents-${width}.png`)});
  await page.locator('button[data-burn-tier="standard"]').click();await check(false);
  await page.locator('#launch-back').click();await page.locator('#launch-next').click();await check(false);
  await team.screenshot({path:info.outputPath(`standard-agents-${width}.png`)});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('failed capability load is unavailable with working retry, never zero funds or ready', async ({ page }) => {
  await page.route('**/api/marketing-agency', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/#marketing-agency');
  await expect(page.locator('[data-agency-status]')).toContainText('Agency status unavailable');
  await expect(page.locator('[data-agency-funded]')).toHaveText('Unavailable');
  await page.unroute('**/api/marketing-agency');
  await page.locator('[data-agency-refresh]').click();
  await expect(page.locator('[data-agency-status]')).toContainText('Current agency readiness is unavailable');
});

test('unverified active API claims cannot advertise working agency agents', async ({ page }) => {
  await page.route('**/api/marketing-agency', route => route.fulfill({ json: {
    ...marketingAgencyCapabilities(), active: true, executionEnabled: true,
    funding: { status: 'verified', collectedLamports: '100000000000' } } }));
  await page.goto('/#marketing-agency');
  await expect(page.locator('[data-agency-status]')).toContainText('Agency status unavailable');
  await expect(page.locator('[data-agency-funded]')).toHaveText('Unavailable');
});

test('published fee policy does not imply agency execution or get described as unpublished',async({page})=>{
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:agencyProtocolSplit(),revision:3}}));
  await page.goto('/#marketing-agency');
  await expect(page.locator('[data-agency-status]')).toContainText('Agency execution is unavailable');
  await expect(page.locator('[data-agency-status]')).toContainText('New agency launches remain disabled');
  await expect(page.locator('[data-agency-status]')).not.toContainText('split is not active yet');
  await expect(page.locator('#agency-policy-title')).toHaveText('New-launch agency allocation');
  await expect(page.locator('[data-agency-funded]')).toHaveText('Unavailable');
  await page.goto('/#referrals');
  await expect(page.locator('.referral-tier-strip')).toContainText('0.6%');
  await expect(page.locator('.referral-tier-strip')).toContainText('0.25%');
  await expect(page.locator('.referral-tier-strip')).toContainText('0.15%');
  await expect(page.locator('.referral-tier-strip')).toContainText('Published rates');
});

test('verified deployment shows timestamped worker budget scope and finalized receipt links without inventing new payments',async({page})=>{
  await page.route('**/api/marketing-agency',route=>route.fulfill({json:{...marketingAgencyCapabilities(),status:'deployment-verified',historyStatus:'worker-recorded-finalized',active:true,executionEnabled:true,
    agents:marketingAgencyCapabilities().policy.agents.map(row=>({id:row.id,enabled:true,status:'available'})),
    verification:{scope:'reviewed-devnet-program-and-fresh-worker',programId:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm',approvedHash:'a'.repeat(64),build:'b'.repeat(40),configRevision:'1'},
    funding:{status:'worker-verified-snapshots',collectedLamports:'20000000',spentLamports:'1000000'},
    history:[{agent:0,signature:'3'.repeat(88),status:'worker-recorded-finalized',amountLamports:'1000000',finalizedAt:'2026-10-19T12:00:00Z'}]}}));
  await page.goto('/#marketing-agency');await expect(page.locator('[data-agency-status]')).toContainText('execution enabled');
  await expect(page.locator('[data-agency-funded]')).toHaveText('0.02 SOL');await expect(page.locator('[data-agency-spent]')).toHaveText('0.001 SOL');
  await expect(page.locator('[data-agency-history]')).toContainText('timestamped confirmed automation snapshots');
  await expect(page.locator('[data-agency-history] a')).toHaveAttribute('href',`https://explorer.solana.com/tx/${'3'.repeat(88)}?cluster=devnet`);
});

test('buyback availability stays separate from the suspended X publisher',async({page})=>{
  const policy=marketingAgencyCapabilities();
  await page.route('**/api/marketing-agency',route=>route.fulfill({json:{...policy,status:'deployment-verified',historyStatus:'worker-recorded-finalized',active:true,executionEnabled:true,publishingPaused:true,
    feePolicy:{status:'published',revision:3},agents:policy.policy.agents.map((row,index)=>({id:row.id,enabled:index>0,status:index?'available':'paused'})),
    verification:{scope:'reviewed-devnet-program-and-fresh-worker',programId:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm',approvedHash:'a'.repeat(64),build:'b'.repeat(40),configRevision:'1'},
    funding:{status:'worker-verified-snapshots',collectedLamports:'10000',spentLamports:'0'},history:[]}}));
  await page.goto('/#marketing-agency');await expect(page.locator('[data-agency-status]')).toContainText('X promotion stays paused');
  await expect(page.locator('.agency-agent').nth(0)).toContainText('Paused · X account suspended');
  for(const index of [1,2])await expect(page.locator('.agency-agent').nth(index)).toContainText('Available · execution requires proof');
  await expect(page.locator('#agency-policy-title')).toHaveText('Published new-launch fee policy');
  await page.goto('/#launch');await page.locator('#token-name').fill('Paused QA');await page.locator('#token-symbol').fill('PQA');await page.locator('#launch-next').click();
  await expect(page.locator('#launch-agency-options .agency-included-badge')).toHaveCount(3);
  await expect(page.locator('[data-agency-status]')).toContainText('X promotion stays paused');
  await expect(page.locator('#launch-agency-help')).toContainText('Actions wait for verified funding');
  await expect(page.locator('#launch-agency-options')).not.toContainText('preview');
});

for(const width of [390,1440])test(`receipt captions retain saved QA triggers and use neutral legacy labels at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  const policy=marketingAgencyCapabilities();
  const history=[
    {agent:1,savedMarketCapUsd:1,signature:'3'.repeat(88)},
    {agent:2,savedMarketCapUsd:2,signature:'4'.repeat(88)},
    {agent:1,signature:'5'.repeat(88)},
    {agent:2,savedMarketCapUsd:'<b>300000</b>',signature:'6'.repeat(88)},
  ].map(row=>({...row,status:'worker-recorded-finalized',amountLamports:'25502',finalizedAt:'2026-10-21T05:04:37.000Z'}));
  await page.route('**/api/marketing-agency',route=>route.fulfill({json:{...policy,status:'deployment-verified',historyStatus:'worker-recorded-finalized',active:true,executionEnabled:true,publishingPaused:true,
    agents:policy.policy.agents.map((row,index)=>({id:row.id,enabled:index>0,status:index?'available':'paused'})),
    verification:{scope:'reviewed-devnet-program-and-fresh-worker',programId:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm',approvedHash:'a'.repeat(64),build:'b'.repeat(40),configRevision:'4'},
    funding:{status:'worker-verified-snapshots',collectedLamports:'51004',spentLamports:'51004'},history}}));
  await page.goto('/#marketing-agency');
  const links=page.locator('[data-agency-history] a');await expect(links).toHaveCount(4);
  await expect(links.nth(0)).toContainText('Agent 2 · Own-coin buyback · Saved trigger $1 ·');
  await expect(links.nth(1)).toContainText('Agent 3 · Own-coin buyback · Saved trigger $2 ·');
  for(const index of [2,3]){
    await expect(links.nth(index)).toContainText('Own-coin buyback');
    await expect(links.nth(index)).not.toContainText('Saved trigger');
  }
  await expect(page.locator('[data-agency-history]')).not.toContainText('$100k');
  await expect(page.locator('[data-agency-history]')).not.toContainText('$300k');
  await expect(page.locator('.agency-agent').nth(1)).toContainText('$100,000');
  await expect(page.locator('.agency-agent').nth(2)).toContainText('$300,000');
  await expect(page.locator('.agency-agent').nth(0)).toContainText('Paused · X account suspended');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
