import{test,expect}from'@playwright/test';
const split={operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10};
for(const width of[320,390,1440])test(`launch form stays simple and preserves conditional fields at ${width}px (mocked APIs)`,async({page,baseURL},info)=>{
  test.setTimeout(60000);await page.setViewportSize({width,height:900});
  const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(baseURL).origin?r.fallback():r.abort());
  await page.route('**/api/**',r=>{const q=r.request(),u=new URL(q.url());let read=q.method()==='GET';if(q.method()==='POST'&&u.pathname==='/api/solana/rpc'){try{const b=q.postDataJSON();read=(Array.isArray(b)?b:[b]).every(x=>/^(get|isBlockhashValid$)/.test(x.method));}catch{}}if(!read)writes.push(u.pathname);return r.fulfill({status:503,json:{error:'Offline form review fixture'}});});
  await page.route('**/api/fee-policy',r=>r.fulfill({json:{revision:6,split}}));
  await page.goto('/#launch');await page.locator('body.product-flows-ready').waitFor();
  const creator=page.locator('#creator-wallet-share'),holders=page.locator('#holder-airdrop-share'),x=page.locator('#x-share'),recipient=page.locator('#x-recipient'),next=page.locator('#launch-next');
  await expect(page.locator('#custom-policy-title')).toHaveText('Split your 80%');await expect(recipient).toBeHidden();
  for(const field of[creator,holders,x]){await expect(field).toBeVisible();expect((await field.boundingBox()).height).toBeGreaterThanOrEqual(44);}
  await creator.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`fee-split-${width}.png`)});
  await page.locator('#token-name').fill('Simple launch');await page.locator('#token-symbol').fill('SIMPLE');
  await creator.fill('70');await x.fill('10');await expect(recipient).toBeVisible();await next.click();await expect(recipient).toBeFocused();
  await recipient.fill('@example');await x.fill('0');await creator.fill('80');await expect(recipient).toBeHidden();await expect(recipient).toHaveValue('@example');
  await creator.fill('70');await x.fill('10');await expect(recipient).toBeVisible();await expect(recipient).toHaveValue('@example');await expect(page.locator('#fee-distribution-status')).toBeHidden();
  await next.click();await expect(page.locator('#benefits-step-title')).toBeFocused();
  expect(await page.evaluate(()=>Boolean(document.querySelector('.creator-burn-section').compareDocumentPosition(document.querySelector('.launch-funding-section'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('.launch-tier-balance')).toBeHidden();await expect(page.locator('#launch-tier-quote-status')).toBeHidden();await expect(page.locator('.creator-buy-preview')).toBeHidden();
  await expect(page.locator('#launch-button')).toBeDisabled();
  await page.screenshot({path:info.outputPath(`standard-step-two-${width}.png`)});
  await page.locator('#creator-buy-sol').fill('0.01');await expect(page.locator('.creator-buy-preview')).toBeVisible();await page.locator('#creator-buy-sol').fill('0');await expect(page.locator('.creator-buy-preview')).toBeHidden();
  await page.locator('button[data-burn-tier="pro"]').click();await expect(page.locator('.launch-tier-balance')).toBeVisible();await expect(page.locator('#launch-tier-quote-status')).toBeVisible();
  for(const id of['token-description','token-roadmap','token-banner']){await expect(page.locator('#'+id)).toBeVisible();await expect(page.locator('#'+id)).toHaveAttribute('aria-required','true');}
  await page.locator('#token-description').fill('Describe the project clearly.');await page.locator('#token-roadmap').fill('Launch, build, grow.');
  await page.locator('#launch-back').click();await expect(recipient).toHaveValue('@example');await next.click();await expect(page.locator('#token-description')).toHaveValue('Describe the project clearly.');
  await expect(page.locator('#token-roadmap')).toHaveValue('Launch, build, grow.');
  await page.locator('button[data-burn-tier="standard"]').click();await expect(page.locator('.launch-tier-balance')).toBeHidden();await expect(page.locator('#launch-tier-quote-status')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);expect(writes).toEqual([]);
});
