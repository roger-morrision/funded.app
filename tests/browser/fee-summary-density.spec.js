import {test,expect} from '@playwright/test';
const split={operationsPercent:40,referralLevelPercents:[3,1.25,0.75],communityPercent:20,buybackPercent:25,agencyPercent:10};

for(const width of[320,390,700,1440])test(`task fee summaries retain all rates and native details at ${width}px (mocked policy)`,async({page,baseURL},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());return q.method()==='GET'&&u.origin===new URL(baseURL).origin?r.fallback():r.abort();});
  await page.route('**/api/**',r=>{
    const q=r.request(),path=new URL(q.url()).pathname;let read=q.method()==='GET';
    if(q.method()==='POST'&&path==='/api/solana/rpc'){try{const body=q.postDataJSON(),calls=Array.isArray(body)?body:[body];read=calls.length>0&&calls.every(call=>/^(get|isBlockhashValid$)/.test(call?.method||''));}catch{}}
    if(!read)writes.push({method:q.method(),path});return r.fulfill({status:503,json:{error:'Offline fee-summary fixture'}});
  });
  await page.route('**/api/fee-policy',r=>r.fulfill({json:{revision:6,split}}));
  await page.goto('/#buybacks');await page.locator('body.product-experience-ready.workspace-ready').waitFor();
  const title=page.locator('#burn-center-title'),nav=page.getByRole('navigation',{name:'$FUNDED sections',exact:true}),fees=page.locator('#paid > [data-fee-distribution]');
  const heading=await title.boundingBox(),header=await page.locator('.topbar').boundingBox();expect(heading.y).toBeGreaterThan(header.y+header.height);expect(heading.y).toBeLessThan(360);
  expect((await nav.boundingBox()).y).toBeLessThan(heading.y);expect(await fees.evaluate(e=>Boolean(document.querySelector('#buybacks').compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.screenshot({path:info.outputPath(`buyback-first-screen-${width}.png`)});
  const verify=async root=>{
    await expect(root.locator('.fee-distribution-summary--compact')).toBeVisible();
    await expect(root.locator('[data-fee-category] > strong')).toHaveText(['80%','8%','1%','4%','5%','2%']);
    for(const label of await root.locator('[data-fee-category] > span').all())await expect(label).toBeVisible();
    const details=root.locator('.fee-distribution-details'),summary=details.locator(':scope > summary');await expect(details).not.toHaveAttribute('open','');await expect(details.locator('dl')).toBeHidden();
    await root.scrollIntoViewIfNeeded();expect((await root.locator('.fee-distribution-summary').boundingBox()).height).toBeLessThan(width===320?650:width===390?590:500);expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await summary.focus();await page.keyboard.press('Enter');await expect(details).toHaveAttribute('open','');await expect(summary).toBeFocused();
    await expect(details).toContainText('eligible coin holders and a named X account');await expect(details).toContainText('top 3 per category');await expect(details).toContainText('Unused budgets stay reserved');await expect(details).not.toContainText('collected creator fees, not trade volume');
    const benefits=details.locator('[data-fee-benefit]');await expect(benefits).toHaveCount(6);
    for(const benefit of await benefits.all()){await expect(benefit).toContainText('Who receives it');await expect(benefit).toContainText('When it is received');await expect(benefit).toContainText('How to receive it');}
    const creator=details.locator('[data-fee-benefit="creator"]'),bonus=details.locator('[data-fee-benefit="community"]');
    await expect(creator).toContainText('closing balance');await expect(creator).toContainText('link a wallet and claim');await expect(bonus).toContainText('00:00 UTC');await expect(bonus).toContainText('only when automatic bonus payouts are enabled');await expect(bonus).toContainText('1st receives 50%, 2nd 30% and 3rd 20%');
    await expect(details.locator('[data-fee-benefit="referrals"]')).toContainText('do not submit a separate claim');await expect(details.locator('[data-fee-benefit="buyback"]')).toContainText('not a guaranteed hourly, daily or every-trade burn');
    await expect(details.locator('[data-fee-benefit="agency"]')).toContainText('Default milestones are $100,000 and $300,000');await expect(details).not.toContainText('Separate community token airdrops');
    const rules=creator.locator('.fee-benefit-rules'),rulesSummary=rules.locator(':scope > summary');
    await expect(rules).not.toHaveAttribute('open','');await expect(rules.locator('.fee-benefit-rule-body')).toBeHidden();await rulesSummary.focus();await page.keyboard.press('Enter');await expect(rules.locator('.fee-benefit-rule-body')).toBeVisible();await expect(rules).toContainText('closing balance');await page.keyboard.press('Space');await expect(rules).not.toHaveAttribute('open','');await expect(rulesSummary).toBeFocused();await summary.focus();
    await page.keyboard.press('Space');await expect(details).not.toHaveAttribute('open','');await expect(summary).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  };
  for(const[route,selector]of[['paid','#paid > [data-fee-distribution]'],['capital-flow','#capital-flow [data-fee-distribution]'],['launch','.launch-fixed-distribution']]){
    await page.evaluate(hash=>location.hash=hash,route);const root=page.locator(selector);await verify(root);await root.screenshot({path:info.outputPath(`compact-fees-${route}-${width}.png`)});
  }
  await page.locator('.launch-fixed-distribution .fee-distribution-details > summary').click();await page.evaluate(()=>location.hash='paid');await expect(fees.locator('.fee-distribution-details')).not.toHaveAttribute('open','');await page.evaluate(()=>location.hash='launch');await expect(page.locator('.launch-fixed-distribution .fee-distribution-details')).toHaveAttribute('open','');await expect(page.locator('#launch-button')).toBeDisabled();
  const bonusLink=page.locator('.launch-fixed-distribution [data-fee-benefit="community"] a');await bonusLink.focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(/#bonuses$/);await expect(page.locator('#bonuses')).toBeVisible();
  expect(errors).toEqual([]);expect(writes).toEqual([]);
});
