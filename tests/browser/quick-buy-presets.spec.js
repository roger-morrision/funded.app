import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const mint='So11111111111111111111111111111111111111112';
for(const width of [320, 1440]) test(`Buy presets preserve amounts and review at ${width}px (mocked APIs)`,async({page},info)=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>{localStorage.setItem('funded.review-buy-sol.v1','0.35');sessionStorage.setItem('funded.app.wallet.manual-disconnect','1');});
  await page.route('https://**/*',r=>r.abort());
  const writes=[];
  await page.route('**/api/**',r=>{
    const request=r.request(),path=new URL(request.url()).pathname;
    if(request.method()!=='GET'&&path!=='/api/solana/rpc')writes.push(path);
    if(path==='/api/fee-policy')return r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}});
    if(path==='/api/launches')return r.fulfill({json:[{mint,name:'Preset fixture',symbol:'PRESET',cluster:'devnet',onchainVerified:true,creatorWallet:'11111111111111111111111111111111'}]});
    if(path==='/api/pump/explore')return r.fulfill({json:{items:[],fetchedAt:new Date().toISOString()}});
    return r.fulfill({status:503,json:{error:'Mocked unavailable'}});
  });
  for(const amount of ['0.2','0.5']){
    await page.goto('/#explore');await page.locator('body.product-flows-ready').waitFor();
    await expect(page.getByRole('textbox',{name:'Quick buy amount in SOL',exact:true})).toHaveCount(0);
    const card=page.locator('#asset-grid .home-launch-card').first();
    await expect(card.locator('[data-review-amount]')).toHaveText(['Buy 0.2 SOL','Buy 0.5 SOL']);
    const actions=await card.locator('.home-launch-card-actions > :is(.card-review-buy,.token-card-action-share,.token-card-action-boost)').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {top:r.top,height:r.height,width:r.width};}));
    expect(actions).toHaveLength(4);expect(Math.max(...actions.map(r=>r.top))-Math.min(...actions.map(r=>r.top))).toBeLessThan(1);
    for(const rect of actions){expect(rect.height).toBeGreaterThanOrEqual(44);expect(rect.width).toBeGreaterThanOrEqual(44);}
    const button=card.getByRole('link',{name:`Buy ${amount} SOL`,exact:true});
    await button.focus();await expect(button).toHaveAttribute('href',`/token/${mint}?reviewBuy=${amount}`);
    expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await button.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    if(amount==='0.2')await page.screenshot({path:info.outputPath(`presets-${width}.png`)});
    await button.press('Enter');await page.locator('body.product-flows-ready').waitFor();
    await expect(page).toHaveURL(new RegExp(`reviewBuy=${amount.replace('.','\\.')}$$`));
    await expect(page.locator('#trade-amount')).toHaveValue(amount);
    await expect(page.locator('#trade-panel')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  await page.goto(`/token/${mint}`);await page.locator('body.product-flows-ready').waitFor();
  await expect(page.locator('#trade-amount')).toHaveValue('0.35');
  expect(writes).toEqual([]);
});
