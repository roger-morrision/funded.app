import { test, expect } from '@playwright/test';
import { marketingAgencyCapabilities } from '../../server/marketing-agency-policy.mjs';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
import {agencyProtocolSplit} from '../../agency-mint-router-v3.js';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/fee-policy') return route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } });
    if (path === '/api/marketing-agency') return route.fulfill({ json: { ...marketingAgencyCapabilities(),
      funding: { status: 'unavailable', collectedLamports: null, spentLamports: null }, history: [], launches: [] } });
    return route.fulfill({ status: 503, json: { error: 'Offline QA fixture' } });
  });
  await page.route('https://**/*', route => route.abort());
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
  await expect(page.locator('[data-agency-status]')).toContainText('Not activated');
  await expect(page.locator('[data-agency-funded]')).toHaveText('Unavailable');
  await expect(page.locator('[data-agency-history]')).toContainText('No agency execution history has been verified');
  await expect(page.locator('.agency-policy')).toContainText('1% referrals · 2% AI agency');
  await expect(page.locator('.agency-policy')).toContainText('L1 0.6% · L2 0.25% · L3 0.15%');
  await expect(page.locator('.agency-policy')).toContainText('each buy and burn the launched coin once');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (width === 1440) await page.screenshot({ path: 'tmp/agency-desktop.png', fullPage: true, animations: 'disabled' });
  else await page.screenshot({ path: 'tmp/agency-mobile.png', fullPage: true, animations: 'disabled' });
  if (width === 1440) expect(await page.locator('#marketing-agency').evaluate(n => n.getBoundingClientRect().left >= document.querySelector('.sidebar').getBoundingClientRect().right)).toBe(true);
});

test('team preview updates equal selected budgets without altering the active fee policy', async ({ page }) => {
  await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('#token-name').fill('Agency QA');
  await page.locator('#token-symbol').fill('AQA');
  await page.locator('#launch-next').click();
  await expect(page.locator('#launch-agency-options')).toBeVisible();
  await page.locator('[data-launch-agency][value="x-promotion"]').check();
  await expect(page.locator('[data-agency-split]')).toContainText('1 selected agent');
  await page.locator('[data-launch-agency][value="buyback-300k"]').check();
  await expect(page.locator('[data-agency-split]')).toContainText('2 selected agents');
  await expect(page.locator('[data-agency-split]')).toContainText('no funds move');
  await page.locator('[data-launch-agency][value="x-promotion"]').uncheck();
  await page.locator('[data-launch-agency][value="buyback-300k"]').uncheck();
  await expect(page.locator('[data-agency-split]')).toContainText('remains in reserve');
  await page.goto('/#capital-flow');
  await expect(page.locator('#marketing-agency')).not.toBeVisible();
  await expect(page.locator('#capital-flow')).toBeVisible();
});

test('failed capability load is unavailable with working retry, never zero funds or ready', async ({ page }) => {
  await page.route('**/api/marketing-agency', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/#marketing-agency');
  await expect(page.locator('[data-agency-status]')).toContainText('Agency status unavailable');
  await expect(page.locator('[data-agency-funded]')).toHaveText('Unavailable');
  await page.unroute('**/api/marketing-agency');
  await page.locator('[data-agency-refresh]').click();
  await expect(page.locator('[data-agency-status]')).toContainText('Not activated');
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
  await page.route('**/api/marketing-agency',route=>route.fulfill({json:{...marketingAgencyCapabilities(),status:'deployment-verified',active:true,executionEnabled:true,
    agents:marketingAgencyCapabilities().policy.agents.map(row=>({id:row.id,enabled:true,status:'available'})),
    verification:{scope:'reviewed-devnet-program-and-fresh-worker',programId:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm',approvedHash:'a'.repeat(64),build:'b'.repeat(40),configRevision:'1'},
    funding:{status:'worker-verified-snapshots',collectedLamports:'20000000',spentLamports:'1000000'},
    history:[{agent:0,signature:'3'.repeat(88),status:'worker-recorded-finalized',amountLamports:'1000000',finalizedAt:'2026-10-19T12:00:00Z'}]}}));
  await page.goto('/#marketing-agency');await expect(page.locator('[data-agency-status]')).toContainText('execution enabled on Devnet');
  await expect(page.locator('[data-agency-funded]')).toHaveText('0.02 SOL');await expect(page.locator('[data-agency-spent]')).toHaveText('0.001 SOL');
  await expect(page.locator('[data-agency-history]')).toContainText('timestamped finalized worker snapshots');
  await expect(page.locator('[data-agency-history] a')).toHaveAttribute('href',`https://explorer.solana.com/tx/${'3'.repeat(88)}?cluster=devnet`);
});

test('buyback availability stays separate from the suspended X publisher',async({page})=>{
  const policy=marketingAgencyCapabilities();
  await page.route('**/api/marketing-agency',route=>route.fulfill({json:{...policy,status:'deployment-verified',active:true,executionEnabled:true,publishingPaused:true,
    feePolicy:{status:'published',revision:3},agents:policy.policy.agents.map((row,index)=>({id:row.id,enabled:index>0,status:index?'available':'paused'})),
    verification:{scope:'reviewed-devnet-program-and-fresh-worker',programId:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm',approvedHash:'a'.repeat(64),build:'b'.repeat(40),configRevision:'1'},
    funding:{status:'worker-verified-snapshots',collectedLamports:'10000',spentLamports:'0'},history:[]}}));
  await page.goto('/#marketing-agency');await expect(page.locator('[data-agency-status]')).toContainText('X promotion stays paused');
  await expect(page.locator('.agency-agent').nth(0)).toContainText('Paused · X account suspended');
  for(const index of [1,2])await expect(page.locator('.agency-agent').nth(index)).toContainText('Available · execution requires proof');
  await expect(page.locator('#agency-policy-title')).toHaveText('Published new-launch fee policy');
});
