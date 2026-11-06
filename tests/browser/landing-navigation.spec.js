import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/**',r=>new URL(r.request().url()).pathname==='/api/fee-policy'
    ?r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}):r.fulfill({status:503,json:{error:'Offline landing navigation fixture'}}));
});

for(const width of[360,1440])test(`landing section jumps and history keep the correct current item at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:740});await page.goto('/welcome');
  for(const id of['for-you','rewards','discovery','tools','questions','platform']){
    if(width<1000){await page.getByRole('button',{name:'Open navigation'}).click();await page.locator(`#landing-menu nav a[href="#${id}"]`).click();}
    else await page.locator(`.landing-sidebar nav a[href="#${id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    for(const menu of['.landing-sidebar','#landing-menu'])await expect(page.locator(`${menu} nav a[aria-current="location"]`)).toHaveAttribute('href','#'+id);
    const geometry=await page.locator('#'+id).evaluate(e=>({top:e.getBoundingClientRect().top,header:document.querySelector('.landing-topbar').getBoundingClientRect().bottom}));
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.header-1);expect(geometry.top).toBeLessThanOrEqual(geometry.header+32);
  }
  await page.goBack();await expect(page).toHaveURL(/#questions$/);
  await expect(page.locator('.landing-sidebar nav a[aria-current]')).toHaveAttribute('href','#questions');
  await page.locator('#tools').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));
  await expect(page.locator('.landing-sidebar nav a[aria-current]')).toHaveAttribute('href','#tools');
  await expect(page.locator('#landing-menu nav a[aria-current]')).toHaveAttribute('href','#tools');
});

test('short phone drawer keeps focused controls visible and backdrop returns focus',async({page})=>{
  await page.setViewportSize({width:360,height:480});await page.goto('/welcome');
  const trigger=page.getByRole('button',{name:'Open navigation'}),menu=page.getByRole('dialog',{name:'Explore funded.vip'});
  await trigger.focus();await page.keyboard.press('Enter');await expect(menu.getByRole('button',{name:'Close navigation'})).toBeFocused();
  await page.keyboard.press('Shift+Tab');const app=menu.getByRole('link',{name:'Open app'});await expect(app).toBeFocused();
  const box=await app.boundingBox();expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(480);
  await page.mouse.click(354,120);await expect(menu).not.toBeVisible();await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded','false');expect(await page.evaluate(()=>getComputedStyle(document.body).overflow)).not.toBe('hidden');
  await page.setViewportSize({width:1440,height:500});const docs=page.locator('.landing-sidebar .quiet-link');await docs.focus();
  const desktop=await docs.boundingBox();expect(desktop.y).toBeGreaterThanOrEqual(0);expect(desktop.y+desktop.height).toBeLessThanOrEqual(500);
});

for(const width of[390,1440])for(const[kind,name]of[['creator','Creator rewards'],['x','X account rewards']])test(`landing ${kind} benefit selects its reward panel and restores it through history at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.goto('/welcome');
  await page.locator('.reward-grid').getByRole('link',{name,exact:true}).click();
  await page.locator('body.product-flows-ready.page-route-payments').waitFor();await expect(page).toHaveURL(new RegExp(`#payments/${kind}$`));
  const tab=page.locator(`#rewards-${kind}-tab`),panel=page.locator(`#rewards-${kind}`);
  await expect(tab).toHaveAttribute('aria-selected','true');await expect(panel).toBeVisible();
  await expect(page.locator('#route-guide')).toBeHidden();
  const history=page.getByRole('tab',{name:'All Payout History',exact:true});await history.click();
  await page.evaluate(()=>dispatchEvent(new CustomEvent('funded:route-change',{detail:{route:'payments'}})));
  await expect(history).toHaveAttribute('aria-selected','true');await expect(history).toBeFocused();
  await page.locator(width<1000?'.mobile-workspace-nav a[href="#payments"]':'.primary-nav a[href="#payments"]').click();
  await expect(page).toHaveURL(/#payments$/);await page.goBack();
  await expect(tab).toHaveAttribute('aria-selected','true');await expect(tab).toBeFocused();await expect(panel).toBeVisible();
  const rect=await tab.boundingBox(),header=await page.locator('.topbar').boundingBox();expect(rect.y).toBeGreaterThanOrEqual(header.y+header.height);
});
