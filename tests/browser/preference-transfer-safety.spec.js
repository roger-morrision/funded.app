import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
import {installAccountFixture} from '../fixtures/account-browser-fixture.mjs';

// Replaces retired device import/export with cloud account isolation coverage.
const target='So11111111111111111111111111111111111111112';
async function setup(page,width){
  await page.setViewportSize({width,height:900});
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Offline account fixture'}}));
  await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  const account=await installAccountFixture(page);
  await page.goto('/wallet/'+target);await page.locator('body.product-flows-ready').waitFor();
  return account;
}
for(const width of [390,1440]){
  test(`cloud follows save and survive reload without device transfer at ${width}px`,async({page})=>{
    const account=await setup(page,width);await account.connect();
    const follow=page.locator('#wallet-follow');await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed','true');
    expect(account.preferences.wallets.map(row=>row.address)).toEqual([target]);
    expect(account.writes).toHaveLength(1);expect(account.writes[0]).toMatchObject({kind:'wallets',action:'add'});
    await page.reload();await account.connect();await expect(follow).toHaveAttribute('aria-pressed','true');
    await follow.click();await expect(follow).toHaveAttribute('aria-pressed','false');
    expect(account.preferences.wallets).toEqual([]);
    await page.goto('/#profile');await page.locator('body.product-flows-ready').waitFor();
    await expect(page.locator('#preference-transfer')).toHaveCount(0);
  });
  test(`failed cloud save never marks wallet followed at ${width}px`,async({page})=>{
    const account=await setup(page,width);await account.connect();
    await page.route('**/api/account-preferences?*',r=>r.request().method()==='POST'
      ?r.fulfill({status:503,json:{error:'Controlled save outage'}}):r.fallback());
    const follow=page.locator('#wallet-follow');await follow.click();
    await expect(page.locator('#toast')).toContainText('Controlled save outage');
    await expect(follow).toHaveAttribute('aria-pressed','false');
    expect(account.preferences.wallets).toEqual([]);expect(account.writes).toEqual([]);
  });
  test(`guest ignores legacy follows and provider disconnect clears private cloud rows at ${width}px`,async({page})=>{
    await page.addInitScript(target=>localStorage.setItem('funded.app.followed.wallets.v1',JSON.stringify([{address:target,roles:['creator']}])) ,target);
    const account=await setup(page,width);account.preferences.wallets=[{address:target,roles:['creator']}];
    const follow=page.locator('#wallet-follow');await expect(follow).toHaveAttribute('aria-pressed','false');
    await account.connect();await expect(follow).toHaveAttribute('aria-pressed','true');
    await page.evaluate(()=>window.solana.disconnect());
    await expect(page.locator('#connect-button')).not.toHaveClass(/wallet-pill-connected/);
    await expect(follow).toHaveAttribute('aria-pressed','false');
    expect(account.preferences.wallets).toHaveLength(1);expect(account.writes).toEqual([]);
  });
}
