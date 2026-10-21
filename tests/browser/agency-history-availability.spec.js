import {test,expect} from '@playwright/test';
import {marketingAgencyCapabilities} from '../../server/marketing-agency-policy.mjs';
import {AGENCY_RECEIPT_PROGRAM,AGENCY_RECEIPT_SCOPE} from '../../config/agency-history.js';

const policy=marketingAgencyCapabilities(),hash='a'.repeat(64),build='b'.repeat(40);
const history=[1,2].map(agent=>({agent,signature:String(agent+2).repeat(88),savedMarketCapUsd:agent,
  status:'worker-recorded-finalized',amountLamports:'25502',finalizedAt:`2026-10-21T05:04:${agent===1?'37':'57'}.000Z`}));
function blocked(){return{...policy,status:'activation-blocked',active:false,executionEnabled:false,publishingPaused:true,
  feePolicy:{status:'published',revision:6},agents:policy.policy.agents.map((row,i)=>({id:row.id,enabled:false,status:i?'not-activated':'paused'})),
  funding:{status:'unavailable',collectedLamports:null,spentLamports:null},history:structuredClone(history),historyStatus:'worker-recorded-finalized',
  historyVerification:{scope:AGENCY_RECEIPT_SCOPE,programId:AGENCY_RECEIPT_PROGRAM,approvedHash:hash}};}
function ready(){const data=blocked();return{...data,status:'deployment-verified',active:true,executionEnabled:true,
  agents:data.agents.map((row,i)=>({...row,enabled:i>0,status:i?'available':'paused'})),
  verification:{scope:'reviewed-devnet-program-and-fresh-worker',programId:AGENCY_RECEIPT_PROGRAM,approvedHash:hash,build,configRevision:'4'},
  funding:{status:'worker-verified-snapshots',collectedLamports:'10000',spentLamports:'0'}};}
async function fixture(page,getData){
  const requests=[];
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;requests.push({path,method:request.method()});
    if(path==='/api/marketing-agency'){const data=getData();return data===null?route.abort():route.fulfill({json:data});}
    return route.fulfill({status:503,json:{error:'Offline deterministic fixture'}});
  });await page.route('https://**/*',route=>route.abort());return requests;
}
async function assertRows(page){
  const links=page.locator('[data-agency-history] a');await expect(links).toHaveCount(2);
  for(const [i,row]of history.entries()){
    await expect(links.nth(i)).toHaveText(`Agent ${row.agent+1} · Own-coin buyback · Saved trigger $${row.agent} · 0.000025502 SOL · ${row.finalizedAt} ↗`);
    await expect(links.nth(i)).toHaveAttribute('href',`https://explorer.solana.com/tx/${row.signature}?cluster=devnet`);
  }
}
for(const width of [360,390,1440])test(`earlier receipts survive unavailable readiness and native recovery at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===1440?900:844});let data=blocked();const requests=await fixture(page,()=>data);
  await page.goto('/#marketing-agency');await expect(page.locator('[data-agency-status]')).toContainText('Current agency readiness is unavailable');
  await assertRows(page);await expect(page.locator('[data-agency-history]')).toContainText('do not establish current execution readiness');
  for(const key of ['funded','spent'])await expect(page.locator(`[data-agency-${key}]`)).toHaveText('Unavailable');
  await expect(page.locator('.agency-agent').nth(0)).toContainText('Paused');
  for(const i of [1,2])await expect(page.locator('.agency-agent').nth(i)).toContainText('Readiness unavailable');
  await expect(page.locator('.agency-agent').nth(1)).toContainText('$100,000');await expect(page.locator('.agency-agent').nth(2)).toContainText('$300,000');
  await page.screenshot({path:`tmp/agency-history-unready-${width}.png`,fullPage:true});
  const refresh=page.getByRole('button',{name:'Refresh status',exact:true});data=ready();await refresh.click();
  await expect(page.locator('[data-agency-funded]')).toHaveText('0.00001 SOL');await assertRows(page);await expect(refresh).toBeFocused();
  data=blocked();await refresh.click();await expect(page.locator('[data-agency-funded]')).toHaveText('Unavailable');await assertRows(page);await expect(refresh).toBeFocused();
  data=null;await refresh.click();await expect(page.locator('[data-agency-status]')).toContainText('Agency status unavailable');
  await expect(page.locator('[data-agency-history]')).toHaveText('Earlier receipt history is unavailable.');await expect(page.locator('[data-agency-history] a')).toHaveCount(0);
  data=blocked();await refresh.click();await assertRows(page);await expect(refresh).toBeFocused();
  data={...blocked(),history:[]};await refresh.click();await expect(page.locator('[data-agency-history]')).toContainText('No earlier verified agency receipt has been recorded');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(requests.filter(x=>x.path==='/api/marketing-agency').length).toBe(6);expect(requests.every(x=>x.method==='GET')).toBe(true);
});
test('unavailable and malformed historical context never invents empty or current verified history',async({page})=>{
  let data=blocked();await fixture(page,()=>data);await page.goto('/#marketing-agency');await assertRows(page);
  const refresh=page.getByRole('button',{name:'Refresh status',exact:true});
  for(const mutate of [d=>delete d.historyVerification,d=>d.historyVerification.programId='So11111111111111111111111111111111111111112',
    d=>d.historyVerification.approvedHash='wrong',d=>d.historyStatus='unavailable',d=>d.history=null]){
    data=blocked();mutate(data);await refresh.click();await expect(page.locator('[data-agency-history]')).toHaveText('Earlier receipt history is unavailable.');
    await expect(page.locator('[data-agency-funded]')).toHaveText('Unavailable');
  }
  data=blocked();data.history=[null,{...history[0],signature:'bad'},{...history[0],agent:99},{...history[0],agent:'1'},
    {...history[0],status:'submitted'},{...history[0],savedMarketCapUsd:'<b>1</b>'},{...history[1],savedMarketCapUsd:1000000001}];
  await refresh.click();const links=page.locator('[data-agency-history] a');await expect(links).toHaveCount(2);
  for(const i of [0,1]){await expect(links.nth(i)).toContainText('Own-coin buyback');await expect(links.nth(i)).not.toContainText('Saved trigger');}
  expect(await page.locator('[data-agency-history] b').count()).toBe(0);
});
