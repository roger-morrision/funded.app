import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const offlineFixture=route=>new URL(route.request().url()).pathname==='/api/fee-policy'
  ? route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}})
  : route.fulfill({status:503,json:{error:'Offline fixture'}});

for(const width of [390,1440])test(`cold buyback verification updates without waiting a minute at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',offlineFixture);
  let ready=false,requests=0;const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/buyback/status',route=>{
    requests++;
    return route.fulfill({json:{cluster:'devnet',refreshing:!ready,automationEnabled:true,
      executionReady:false,receipts:[],pending:[],dashboard:ready
        ? {status:'verified',collectedLamports:'147100',thresholdLamports:'5000000000',triggerReached:false}
        : {status:'unavailable',thresholdLamports:'5000000000'}}});
  });
  await page.goto('/#buybacks');
  const note=page.locator('#buyback-route-status');
  await expect(note).toContainText('Checking finalized vault balances');
  await expect(page.locator('#buyback-route-balance')).toHaveText('—');
  const before=requests;ready=true;
  await expect(note).toContainText('Verified eligible funds',{timeout:12000});
  expect(requests).toBeGreaterThan(before);
  await expect(page.locator('#buyback-route-balance')).toHaveText('0.0001471 SOL');
  await expect(note).not.toContainText('execution ready');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

for(const [name,status,dashboard,expected] of [
  ['transport failure',503,null,'Waiting for the next burn update'],
  ['unavailable verification',200,{status:'unavailable',lastBurn:null},'Waiting for the next burn update'],
  ['verified empty history',200,{status:'verified',collectedLamports:'0',lastBurn:null},'No burns yet'],
  ['known burn during a vault verification gap',200,{status:'partial',lastBurn:{signature:'3'.repeat(64),burnedAt:'2026-10-18T12:00:00Z'}},/2026/],
]) test(`buyback last-burn panels distinguish ${name}`,async({page})=>{
  await page.route('https://**/*',route=>route.abort());await page.route('**/api/**',offlineFixture);
  await page.route('**/api/buyback/status',route=>route.fulfill({status,json:{cluster:'devnet',receipts:[],pending:[],dashboard}}));
  await page.goto('/#buybacks');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  for(const prefix of ['home-buyback','buyback-route']){
    await expect(page.locator(`#${prefix}-last-time`)).toHaveText(expected);
    const proof=page.locator(`#${prefix}-proof`);
    if(dashboard?.lastBurn)await expect(proof).toHaveAttribute('href',/3{64}\?cluster=devnet$/);
    else {await expect(proof).toHaveAttribute('hidden','');await expect(proof).not.toHaveAttribute('href',/./);}
  }
});
for(const width of [1280,390])test(`small buyback allocations explain retained funds without hiding reconciliation at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',offlineFixture);
  await page.route('**/api/buyback/status',route=>route.fulfill({json:{cluster:'devnet',automationEnabled:true,minimumOrderLamports:'10000',
    dashboard:{status:'verified',thresholdLamports:'100000',collectedLamports:'103938',triggerReached:true},receipts:[],pending:[
      {mint:'52TdgMLp41CtiLrAqqZ1N889RPfWMMzxwpF8MoaZFvN1',amountLamports:'8911',status:'below-minimum-order'},
      {mint:'26ds5kv2n8JuWZ2uRu1goxEw7xy7YirpdsqdiLycy1Zg',amountLamports:'5000',status:'verification-pending'}]}}));
  await page.goto('/#buybacks');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const disclosure=page.locator('.concise-buyback-queue');
  await disclosure.locator('summary').click();
  const rows=page.locator('.reward-buyback-list p');await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('0.000008911 SOL retained');
  await expect(rows.nth(0)).toContainText('below 0.00001 SOL order minimum; retained in its vault');
  await expect(rows.nth(0)).not.toContainText('ready for the next batch');
  await expect(rows.nth(1)).toContainText('in progress');
  await expect(page.locator('.reward-buyback-stats')).toContainText('Recorded unspent allocations');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('aggregate buyback trigger does not claim execution when every source is below its order minimum',async({page})=>{
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',offlineFixture);
  await page.route('**/api/buyback/status',route=>route.fulfill({json:{cluster:'devnet',automationEnabled:true,
    executionReady:false,minimumOrderLamports:'10000',receipts:[],pending:[
      {mint:'52TdgMLp41CtiLrAqqZ1N889RPfWMMzxwpF8MoaZFvN1',amountLamports:'8911',status:'below-minimum-order'},
      {mint:'26ds5kv2n8JuWZ2uRu1goxEw7xy7YirpdsqdiLycy1Zg',amountLamports:'8889',status:'below-minimum-order'}],
    dashboard:{status:'verified',thresholdLamports:'10000',collectedLamports:'17800',triggerReached:true}}}));
  await page.goto('/#buybacks');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  for(const prefix of ['home-buyback','buyback-route']){
    await expect(page.locator(`#${prefix}-status`)).toContainText('individual allocations below 0.00001 SOL order minimum');
    await expect(page.locator(`#${prefix}-policy`)).toContainText('minimum');
  }
});

test('buyback history shows the newest eight confirmed receipts with their matching proof links',async({page})=>{
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',offlineFixture);
  const receipts=Array.from({length:10},(_,i)=>({mint:'52TdgMLp41CtiLrAqqZ1N889RPfWMMzxwpF8MoaZFvN1',
    signature:'3456789ABC'[i].repeat(64),slot:i+1,status:'finalized',vaultDebitVerified:true,burnInstructionVerified:true,burnedBaseUnits:String(1000+i)}));
  await page.route('**/api/buyback/status',route=>route.fulfill({json:{cluster:'devnet',automationEnabled:true,minimumOrderLamports:'10000',pending:[],receipts,
    dashboard:{status:'verified',thresholdLamports:'100000',collectedLamports:'0',triggerReached:false}}}));
  await page.goto('/#buybacks');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('.concise-buyback-queue summary').click();
  const rows=page.locator('.reward-buyback-list p');await expect(rows).toHaveCount(8);
  await expect(rows.first()).toContainText('1009 $FUNDED base units burned');
  await expect(rows.first().getByRole('link',{name:'Proof ↗'})).toHaveAttribute('href',/\/C{64}\?cluster=devnet$/);
  await expect(rows.last()).toContainText('1002 $FUNDED base units burned');
  const ledger=page.locator('#buyback-ledger');
  await expect(ledger.locator(':scope > .buyback-ledger-row').first()).toContainText('0.001009 $FUNDED bought and burned');
  await expect(ledger.locator(':scope > .buyback-ledger-row').first().getByRole('link')).toHaveAttribute('href',/\/C{64}\?cluster=devnet$/);
});

test('buyback disclosures preserve open and closed choices across polling and temporary outages',async({page})=>{
  await page.clock.install();
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',offlineFixture);
  let unavailable=false,revision=0,requests=0;
  await page.route('**/api/buyback/status',route=>{
    requests++;
    if(unavailable)return route.fulfill({status:503,json:{error:'Temporarily unavailable'}});
    const receipts=Array.from({length:5},(_,i)=>({mint:'52TdgMLp41CtiLrAqqZ1N889RPfWMMzxwpF8MoaZFvN1',
      signature:'34567'[i].repeat(64),slot:i+1,status:'finalized',vaultDebitVerified:true,burnInstructionVerified:true,
      burnedBaseUnits:String(1000+revision+i),spentLamports:'10000'}));
    return route.fulfill({json:{cluster:'devnet',automationEnabled:true,pending:[],receipts}});
  });
  await page.goto('/#buybacks');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const queue=page.locator('.concise-buyback-queue'),more=page.locator('.concise-ledger-more');
  const policy=page.locator('#buyback-route-panel .buyback-policy-disclosure'),policySummary=policy.locator('summary'),originalPolicy=await policy.elementHandle();
  await expect(policy).not.toHaveAttribute('open','');expect((await policySummary.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await policySummary.focus();await page.keyboard.press('Enter');await expect(policy.locator('p')).toBeVisible();
  await queue.locator('summary').click();await more.locator('summary').click();
  revision=100;
  await page.clock.fastForward(60_001);
  await expect(queue).toHaveAttribute('open','');await expect(more).toHaveAttribute('open','');await expect(policy).toHaveAttribute('open','');
  expect(await originalPolicy.evaluate(e=>e===document.querySelector('#buyback-route-panel .buyback-policy-disclosure'))).toBe(true);
  await expect(page.locator('.reward-buyback-list p').first()).toContainText('1104 $FUNDED base units burned');
  await expect(page.locator('#buyback-ledger')).toContainText('0.001104 $FUNDED bought and burned');
  unavailable=true;await page.clock.fastForward(60_001);
  await expect(page.locator('[data-buyback-flow]')).toHaveText('Buyback status is unavailable.');
  await expect(page.locator('#buyback-ledger')).toContainText('temporarily unavailable');
  unavailable=false;revision=200;await page.clock.fastForward(120_001);
  await expect(page.locator('.reward-buyback-list p').first()).toContainText('1204 $FUNDED base units burned');
  await expect(queue).toHaveAttribute('open','');await expect(more).toHaveAttribute('open','');
  await queue.locator('summary').click();await more.locator('summary').click();
  await policySummary.focus();await page.keyboard.press('Space');await expect(policy.locator('p')).toBeHidden();await expect(policySummary).toBeFocused();
  const before=requests;revision=300;await page.clock.fastForward(60_001);
  await expect.poll(()=>requests).toBeGreaterThan(before);
  await expect(page.locator('.reward-buyback-list p').first()).toContainText('1304 $FUNDED base units burned');
  await expect(queue).not.toHaveAttribute('open','');await expect(more).not.toHaveAttribute('open','');await expect(policy).not.toHaveAttribute('open','');
});

test('a verified buyback scan lasting more than eight seconds fills both history views',async({page})=>{
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',offlineFixture);
  await page.route('**/api/buyback/status',async route=>{
    await new Promise(resolve=>setTimeout(resolve,9000));
    return route.fulfill({json:{cluster:'devnet',automationEnabled:true,pending:[],receipts:[{
      mint:'52TdgMLp41CtiLrAqqZ1N889RPfWMMzxwpF8MoaZFvN1',signature:'3'.repeat(64),slot:512496644,
      status:'finalized',vaultDebitVerified:true,burnInstructionVerified:true,burnedBaseUnits:'1034450',spentLamports:'74257'}]}});
  });
  await page.goto('/#buybacks');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#buyback-ledger')).toContainText('1.03445 $FUNDED bought and burned');
  await page.locator('.concise-buyback-queue summary').click();
  await expect(page.locator('.reward-buyback-list')).toContainText('1034450 $FUNDED base units burned');
  await expect(page.locator('#buyback-ledger a')).toHaveAttribute('href',/\/3{64}\?cluster=devnet$/);
});
