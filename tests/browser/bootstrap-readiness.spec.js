import {test,expect} from '@playwright/test';

const failures=new WeakMap();
test.beforeEach(async({page})=>{
  const found=[];failures.set(page,found);page.on('pageerror',error=>found.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await page.route('https://**/*',route=>route.abort());
});
test.afterEach(async({page})=>expect(failures.get(page),'No uncaught browser exceptions').toEqual([]));
const gate=page=>page.locator('#bootstrap-status');
const reload=page=>page.locator('#bootstrap-reload');
async function locked(page){
  await expect(gate(page)).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('inert','');
  await expect(page.locator('#launch-dialog')).toHaveAttribute('inert','');
  await expect(page.locator('body')).not.toHaveClass(/workspace-ready/);
  await page.keyboard.press('Tab');await expect(reload(page)).toBeFocused();
  expect(await page.locator('#restore-launch-draft').evaluate(node=>Boolean(node.closest('[inert]')))).toBe(true);
}
async function ready(page){
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state','ready');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('[data-bootstrap-inert]')).toHaveCount(0);
  await expect(gate(page)).toBeHidden();
}
async function restore(page){
  const panel=page.locator('.launch-draft-panel');if(!await panel.evaluate(node=>node.open))await panel.locator('summary').click();
  await page.locator('#restore-launch-draft').click();await expect(page.locator('#launch-draft-status')).toContainText('No saved launch draft');
}

for(const width of [1440,390])test(`static startup guard blocks early interaction and keyboard Reload preserves the route at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});let held,appRequests=0;
  page.on('request',request=>{if(new URL(request.url()).pathname==='/app.js')appRequests++;});
  await page.route('**/bootstrap-gate.js*',route=>{held=route;});
  await page.goto('/?startup=fixture#launch',{waitUntil:'commit'});await expect.poll(()=>Boolean(held)).toBe(true);await locked(page);
  expect(appRequests).toBe(0);await expect(gate(page)).toContainText(/loading|starting/i);
  const box=await gate(page).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath(`startup-loading-${width}.png`)});
  await page.unroute('**/bootstrap-gate.js*');
  await Promise.all([page.waitForURL(url=>url.search==='?startup=fixture'&&url.hash==='#launch',{waitUntil:'domcontentloaded'}),page.keyboard.press('Enter')]);
  await ready(page);await expect(page).toHaveURL(/\?startup=fixture#launch$/);await restore(page);
});

test('a held required app import cannot accept Restore or keyboard focus before handlers exist',async({page})=>{
  let held;await page.route('**/app.js*',route=>{held=route;});await page.goto('/#launch',{waitUntil:'commit'});await expect.poll(()=>Boolean(held)).toBe(true);await locked(page);
  await page.keyboard.press('Tab');expect(await page.evaluate(()=>Boolean(document.activeElement.closest('[inert]')))).toBe(false);
  // Independent sentinel elements prove the gate owns only its own inert markers.
  await page.evaluate(()=>{
    const permanent=document.createElement('section');permanent.id='qa-existing-inert';permanent.inert=true;document.body.append(permanent);
    const dynamic=document.createElement('section');dynamic.id='qa-dynamic-root';document.body.append(dynamic);
    const disabled=document.createElement('button');disabled.id='qa-financial-disabled';disabled.disabled=true;document.querySelector('.app-shell').append(disabled);
    document.activeElement.blur();
    document.addEventListener('keydown',event=>{if(event.ctrlKey&&event.key.toLowerCase()==='r'){window.qaReloadShortcut={trusted:event.isTrusted,prevented:event.defaultPrevented};event.preventDefault();}},{capture:true});
  });
  await expect(page.locator('#qa-dynamic-root')).toHaveAttribute('inert','');
  await expect(page.locator('#qa-dynamic-root')).toHaveAttribute('data-bootstrap-inert','');
  await expect(page.locator('#qa-existing-inert')).not.toHaveAttribute('data-bootstrap-inert','');
  await page.keyboard.press('Control+r');
  expect(await page.evaluate(()=>window.qaReloadShortcut)).toEqual({trusted:true,prevented:false});
  await held.continue();await ready(page);
  await expect(page.locator('#qa-dynamic-root')).not.toHaveAttribute('inert','');
  await expect(page.locator('#qa-existing-inert')).toHaveAttribute('inert','');
  await expect(page.locator('#qa-financial-disabled')).toBeDisabled();
  await expect(reload(page)).not.toBeFocused();
  expect(await page.evaluate(()=>Boolean(document.activeElement.closest('[hidden],[inert]')))).toBe(false);await restore(page);
});

for(const [name,path,state] of [['gate','bootstrap-gate.js','failed'],['entry','bootstrap.js','failed'],['required app','app.js','failed']])test(`${name} import failure leaves an accessible recovery action and reload restores the requested route`,async({page})=>{
  let failed=false;await page.route(`**/${path}*`,route=>{failed=true;return route.abort('failed');});
  await page.goto('/?recover=1#launch',{waitUntil:'domcontentloaded'});await expect.poll(()=>failed).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state',state);await expect(page.locator('.app-shell')).toHaveAttribute('inert','');
  await expect(gate(page)).toBeVisible();await expect(reload(page)).toBeVisible();if(state==='failed')await expect(gate(page)).toContainText(/could not|unable|failed/i);
  await page.keyboard.press('Tab');await expect(reload(page)).toBeFocused();await page.unroute(`**/${path}*`);await page.keyboard.press('Enter');
  await ready(page);await expect(page).toHaveURL(/\?recover=1#launch$/);await restore(page);
});

test('optional module failure reports degraded startup while initialized app controls remain usable',async({page})=>{
  await page.route('**/creator-support-ui.js*',route=>route.abort('failed'));await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state','degraded');
  await expect(page.locator('[data-bootstrap-inert]')).toHaveCount(0);await expect(gate(page)).toBeVisible();await expect(gate(page)).toContainText(/some features|could not/i);await restore(page);
  await expect(reload(page)).toBeVisible();
});

test('an unresolved optional module does not keep already initialized app controls locked',async({page})=>{
  let held;await page.route('**/creator-support-ui.js*',route=>{held=route;});await page.goto('/#launch',{waitUntil:'commit'});await expect.poll(()=>Boolean(held)).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state','ready');await expect(page.locator('[data-bootstrap-inert]')).toHaveCount(0);await expect(gate(page)).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/workspace-ready/);await restore(page);
  await page.locator('#token-name').fill('Kept while optional module loads');await held.continue();await ready(page);
  await expect(page.locator('#token-name')).toHaveValue('Kept while optional module loads');await expect(page.locator('#token-name')).toBeFocused();
});
