import {test,expect} from '@playwright/test';
const feePolicy={revision:6,split:{operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10}};

for(const width of [320,390,768,1440])test(`launch review keeps amounts readable and page extras together at ${width}px (mocked APIs)`,async({page,baseURL},info)=>{
  const errors=[],writes=[];await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    return url.origin===new URL(baseURL).origin&&request.method()==='GET'?route.fallback():route.abort();
  });
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    let read=request.method()==='GET';
    if(request.method()==='POST'&&path==='/api/solana/rpc'){
      try{const body=request.postDataJSON(),calls=Array.isArray(body)?body:[body];read=calls.length>0&&calls.every(call=>/^(get|isBlockhashValid$)/.test(call.method));}catch{}
    }
    if(!read)writes.push(path);
    return route.fulfill({status:503,json:{error:'Offline launch review fixture'}});
  });
  await page.route('**/api/fee-policy',route=>route.fulfill({json:feePolicy}));
  await page.goto('/#launch');await page.locator('body.product-flows-ready').waitFor();
  await page.locator('#token-name').fill('A long community token name');await page.locator('#token-symbol').fill('COMMUNITY');
  await page.locator('#launch-next').click();await page.locator('#creator-wallet-share').fill('60');await page.locator('#holder-airdrop-share').fill('20');
  const panel=page.locator('.launch-preview-panel'),summary=page.locator('.launch-preview-sticky');
  await expect(panel.locator('#launch-summary-name')).toHaveText('A long community token name');
  await expect(panel.locator('#launch-summary-creator')).toHaveText('60%');await expect(panel.locator('#launch-summary-holders')).toHaveText('20%');await expect(panel.locator('#launch-summary-x')).toHaveText('0%');
  await expect(panel.locator('[data-fee-fixed-list] dd')).toHaveText(['8%','1%','4%','5%','2%']);
  expect(await panel.locator('dd').evaluateAll(nodes=>nodes.reduce((sum,e)=>sum+Number.parseFloat(e.textContent),0))).toBe(100);
  const bounds=await panel.evaluate(e=>{
    const box=e.getBoundingClientRect();return [...e.querySelectorAll('.launch-summary-specs span,.launch-summary-specs strong,dt,dd')].filter(n=>n.getClientRects().length).map(n=>{
      const r=n.getBoundingClientRect();return{text:n.textContent,readable:parseFloat(getComputedStyle(n).fontSize)>=12,fits:r.left>=box.left&&r.right<=box.right};
    });
  });for(const item of bounds)expect(item,item.text).toMatchObject({readable:true,fits:true});
  expect(await summary.evaluate(e=>Math.abs(e.getBoundingClientRect().width-e.parentElement.getBoundingClientRect().width)<2)).toBe(true);
  await page.locator('#launch-story-options > summary').click();
  await page.locator('#token-tagline').fill('A clear community project');await page.locator('#token-roadmap').fill('Launch the community\nShip the first release');
  const preview=page.locator('#launch-presentation-preview');await expect(preview).not.toHaveAttribute('open','');
  await expect(page.locator('.launch-enhanced-preview,.preview-quality')).toHaveCount(0);
  await preview.locator(':scope > summary').focus();await page.keyboard.press('Enter');await expect(preview.locator('.launch-package-preview')).toBeVisible();
  await expect(preview.locator('#preview-tagline')).toHaveText('A clear community project');await expect(page.locator('#token-roadmap')).toHaveValue('Launch the community\nShip the first release');
  await preview.locator(':scope > summary').focus();await page.keyboard.press('Space');await expect(preview).not.toHaveAttribute('open','');
  await page.locator('#launch-next').click();await expect(page.locator('#launch-dialog')).toHaveAttribute('data-step','3');
  await page.locator('#fee-route-agree').focus();await expect(page.locator('#fee-route-agree')).toBeFocused();await page.keyboard.press('Tab');await expect(page.locator('#terms-agree')).toBeFocused();
  await expect(page.locator('#fee-route-agree')).not.toBeChecked();await expect(page.locator('#terms-agree')).not.toBeChecked();await expect(page.locator('#launch-button')).toBeDisabled();
  await panel.screenshot({path:info.outputPath(`launch-summary-${width}.png`)});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);expect(writes).toEqual([]);
});
