import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
import {agencyProtocolSplit} from '../../agency-mint-router-v3.js';

for(const width of [390,1440])test(`approved referral overview, FAQ and Docs agree at ${width}px while activation is pending`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/fee-policy'
    ?route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}):route.fulfill({status:503,json:{error:'Mocked unavailable API'}}));
  await page.route('https://**/*',route=>route.abort());
  await page.goto('/#referrals');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const strip=page.locator('.referral-tier-strip');
  await expect(strip.locator('> span b')).toHaveText(['0.6%','0.25%','0.15%']);
  await expect(strip).toContainText('1% total');await expect(strip).toContainText('Awaiting V3 agency activation');
  const faq=page.locator('[data-faq="referral-rates"]');if(await faq.getAttribute('open')===null)await faq.locator('summary').click();
  await expect(faq.locator('p')).toBeVisible();
  await expect(faq).toContainText('Level 1: 0.6%');await expect(faq).toContainText('Level 2: 0.25%');await expect(faq).toContainText('Level 3: 0.15%');
  await expect(faq).toContainText('Each payout follows its coin’s saved on-chain policy');
  await expect(page.locator('#referral-faq .data-badge')).toContainText('activation pending');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await strip.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
  await strip.screenshot({path:test.info().outputPath(`referral-rate-card-${width}.png`)});
  await faq.screenshot({path:test.info().outputPath(`referral-rate-faq-${width}.png`)});
  await page.screenshot({path:test.info().outputPath(`approved-referral-rates-${width}.png`),fullPage:true});
  await page.goto('/#docs/referrals');
  await expect(page.locator('#docs-guide-article')).toContainText('Level 1: 0.6%');
  await expect(page.locator('#docs-guide-article')).toContainText('Awaiting V3 agency activation');
});

test('published agency referral policy removes the pending label without repricing historical receipts',async({page})=>{
  await page.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/fee-policy'
    ?route.fulfill({json:{split:agencyProtocolSplit()}}):route.fulfill({status:503,json:{error:'Mocked unavailable API'}}));
  await page.route('https://**/*',route=>route.abort());
  await page.goto('/#referrals');await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const strip=page.locator('.referral-tier-strip');
  await expect(strip.locator('> span b')).toHaveText(['0.6%','0.25%','0.15%']);
  await expect(strip).toContainText('Published rates for new launches');await expect(strip).not.toContainText('Awaiting');
  await expect(strip).toContainText('Existing coins keep their saved rates');
  await expect(page.locator('#referral-faq .data-badge')).toHaveText('Published policy');
});
