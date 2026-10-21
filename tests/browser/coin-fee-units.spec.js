import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

for(const width of [360,390,1440]) test(`token collection and allocation units are exact at ${width}px`, async ({page}) => {
  const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z';
  const amounts=['25887','1','0','18446744073709551615'];
  const values=['0.000025887','0.000000001','0','18446744073.709551615'];
  const displayed=['0.000025887 SOL','0.000000001 SOL','0 SOL','18,446,744,073.709551615 SOL'];
  const signatures=amounts.map((_,i)=>String(i+3).repeat(64));
  await page.setViewportSize({width,height:900});
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline token fee units fixture'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route(`**/api/tokens/${mint}/fee-activity`,route=>route.fulfill({json:{
    mint,cluster:'devnet',coverage:'verified-v3-collections',source:'funded.app-file-ledger',
    overview:{available:true,scope:'per-mint-v3'},
    collections:amounts.map((amount,i)=>({signature:signatures[i],collectedLamports:amount})),
    claims:[...amounts.map((amount,i)=>({claimSignature:signatures[i],grossLamports:amount,grossCreatorFees:values[i],grossCreatorFeesUnit:'SOL',asset:'SOL',status:'finalized'})),
      {claimSignature:'7'.repeat(64),grossCreatorFees:'0.000025887',asset:'SOL',status:'obligations_created'},
      {claimSignature:'8'.repeat(64),grossCreatorFees:'25887',grossCreatorFeesUnit:'unknown',asset:'SOL',status:'recorded'}],
  }}));
  await page.route('https://**/*',route=>route.abort());
  await page.goto(`/token/${mint}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.getByRole('tab',{name:/^Fee claims/}).click();
  const rows=page.locator('#coin-activity-list tbody tr');
  await expect(rows).toHaveCount(4);
  for(const [i,value] of displayed.entries()) {
    await expect(rows.nth(i).locator('td').nth(2)).toHaveText(value);
    await expect(rows.nth(i).getByRole('link')).toHaveAttribute('href',new RegExp(signatures[i]));
  }
  await page.getByRole('tab',{name:/^Allocations/}).click();
  await expect(rows).toHaveCount(6);
  for(const [i,value] of [...displayed,'0.000025887 SOL','—'].entries()) await expect(rows.nth(i).locator('td').nth(2)).toHaveText(value);
  await expect(rows.nth(4)).toContainText('Shares recorded');
  await expect(page.locator('#coin-activity-list')).toContainText('These amounts may not have been paid yet.');
  await expect(rows.first()).not.toContainText('Paid');
  await expect(rows.first().getByRole('link')).toHaveAttribute('href',new RegExp(signatures[0]));
  // Check every significant digit survives responsive cards / horizontal overflow.
  const exactAmount=rows.nth(3).locator('td').nth(2);
  await exactAmount.scrollIntoViewIfNeeded();
  const geometry=await exactAmount.evaluate(node=>{
    const style=getComputedStyle(node), range=document.createRange();range.selectNodeContents(node);
    const bounds=node.getBoundingClientRect();
    return {whiteSpace:style.whiteSpace,overflowWrap:style.overflowWrap,textOverflow:style.textOverflow,rects:[...range.getClientRects()].map(r=>({left:r.left,right:r.right})),left:bounds.left,right:bounds.right,bodyWidth:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  await test.info().attach('amount-geometry',{body:JSON.stringify(geometry),contentType:'application/json'});
  await page.screenshot({path:test.info().outputPath(`fee-units-${width}-mocked.png`),fullPage:true});
  expect(geometry.textOverflow).not.toBe('ellipsis');
  expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewport+1);
  for(const rect of geometry.rects) {expect(rect.left).toBeGreaterThanOrEqual(geometry.left-1);expect(rect.right).toBeLessThanOrEqual(geometry.right+1);}
});
