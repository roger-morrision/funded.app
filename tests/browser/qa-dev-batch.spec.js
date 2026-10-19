import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

test.beforeEach(async ({page})=>{
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>new URL(route.request().url()).pathname === '/api/fee-policy'
    ? route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}})
    : route.fulfill({status:503,json:{error:'Offline deterministic fixture'}}));
});

for (const width of [390,1440]) {
  test(`UX-002 required fields and optional link recovery at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:width===390?844:900});
    await page.goto('/#launch');
    await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state','ready');
    await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
    const details=page.locator('#launch-project-links'),summary=details.locator('summary');
    expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(details).not.toHaveAttribute('open','');
    const boxes=await page.evaluate(()=>Object.fromEntries(['token-symbol','token-image-picker','launch-project-links']
      .map(id=>[id,document.getElementById(id).getBoundingClientRect().top])));
    expect(boxes['token-image-picker']).toBeGreaterThan(boxes['token-symbol']);
    expect(boxes['launch-project-links']).toBeGreaterThan(boxes['token-image-picker']);
    await summary.focus();await page.keyboard.press('Enter');await expect(details).toHaveAttribute('open','');
    const values={'token-website':'https://example.org','token-x':'https://x.com/fixture',
      'token-telegram':'https://t.me/fixture','token-discord':'https://discord.gg/fixture'};
    for(const [id,value] of Object.entries(values)) await page.locator(`#${id}`).fill(value);
    await summary.click();await expect(details).not.toHaveAttribute('open','');
    await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    await expect(details).toHaveAttribute('open','');
    await page.locator('#token-name').fill('UI Fixture');await page.locator('#token-symbol').fill('UIF');
    await page.locator('#token-website').fill('javascript:alert(1)');await summary.click();
    await page.locator('#launch-next').click();
    await expect(details).toHaveAttribute('open','');
    await expect(page.locator('#token-website')).toBeFocused();
    await expect(page.locator('#token-website-error')).toBeVisible();
    await expect(page.locator('#token-website')).toHaveAttribute('aria-invalid','true');
    await page.locator('#token-website').fill(values['token-website']);
    await page.locator('#launch-next').click();await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','2');
    await page.locator('#launch-back').click();
    for(const [id,value] of Object.entries(values)) await expect(page.locator(`#${id}`)).toHaveValue(value);
    await expect(page.locator('#launch-button')).toBeDisabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/UX-002-${width}.png`,fullPage:true});
  });

  test(`UX-001 coverage stays scoped and readable at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:width===390?844:900});
    const group={status:'partial',paidLamports:'1000000000',payoutCount:1};
    let scenario='partial';
    await page.route('**/api/analytics/summary',route=>route.fulfill({json:{
      homeFeeAllocations:{cluster:'devnet'},
      payoutEvidenceAt:scenario==='stale'?'2020-01-01T00:00:00Z':new Date().toISOString(),
      recordedPayouts:2,verifiedPayoutCount:scenario==='invalid'?3:1,
      payoutCoverage:{scope:'v3-sol-recipient-receipts',status:'partial'},
      feePayoutStats:{cluster:'devnet',commitment:'finalized',creator:group,x:group,holder:group},
    }}));
    for(const value of ['partial','invalid','stale']){
      scenario=value;await page.goto('/#explore');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
      await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state','ready');
      await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
      const stats=page.locator('#explore-payout-stats');
      await expect(stats).toContainText(value==='partial'?'1 of 2 payouts verified':'Receipt coverage unavailable');
      await expect(stats).toContainText('1 SOL');
      await expect(stats).not.toContainText('3/2');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.screenshot({path:`test-results/UX-001-${width}.png`,fullPage:true});
  });
}
