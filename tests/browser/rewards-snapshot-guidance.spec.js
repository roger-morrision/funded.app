import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

for(const width of [360,390,1440])test(`per-coin snapshot guidance and native Airdrops navigation at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline rewards guidance fixture'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('https://**/*',route=>route.abort());
  await page.goto('/#payments');
  await page.locator('body.workspace-ready.product-experience-ready').waitFor();
  const summary=page.getByText('How to qualify for upcoming rewards',{exact:true});
  const details=summary.locator('..');
  await expect(details).not.toHaveAttribute('open','');
  await summary.focus();await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open','');await expect(summary).toBeFocused();
  const link=page.getByRole('link',{name:'See snapshots and claim deadlines →',exact:true});
  const article=link.locator('..');
  await expect(article.getByRole('heading')).toHaveText('Check each coin’s snapshot and deadline');
  await expect(article).toContainText('verified snapshot and published claim deadline');
  await expect(article).toContainText('Devnet QA cutoffs are separate');
  await expect(article).not.toContainText(/90 days|at migration/);
  await expect(link).toHaveAttribute('href','#airdrops');
  await expect(page.locator('.reward-upcoming-grid article').first()).toContainText('An hourly payout needs finalized holdings');
  await expect(page.locator('.reward-upcoming-note')).toHaveText('Creator, X, and referral SOL depend on collected fees. X rewards require a claim; referral payouts are creator signed and appear after confirmation.');
  await link.focus();await expect(link).toBeFocused();
  await expect.poll(()=>link.evaluate(element=>{
    const r=element.getBoundingClientRect(),style=getComputedStyle(element),m=(parseFloat(style.outlineWidth)||0)+Math.max(0,parseFloat(style.outlineOffset)||0);
    const header=document.querySelector('.topbar'),nav=document.querySelector('.mobile-workspace-nav');
    const top=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0,bottom=nav?.getClientRects().length?Math.min(innerHeight,nav.getBoundingClientRect().top):innerHeight;
    return r.top-m>=top-1&&r.bottom+m<=bottom+1;
  })).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`rewards-guidance-${width}-mocked.png`)});
  await page.keyboard.press('Enter');await expect(page).toHaveURL(/#airdrops$/);await expect(page.locator('#airdrops')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>!!document.activeElement?.getClientRects().length&&!document.activeElement?.closest('[hidden]'))).toBe(true);
});
