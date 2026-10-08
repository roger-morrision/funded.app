import {test,expect} from '@playwright/test';
const key='funded.journeys.consent.v1';
test.beforeEach(async({page})=>{
  await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await page.route('https://**/*',r=>r.abort());
});
async function open(page){
  await page.goto('/#community');await expect(page.locator('body')).toHaveClass(/product-experience-ready/);
  await page.locator('.product-details:has(#community-preferences)>summary').click();
  await page.locator('#community-preferences details>summary').click();
}
const emit=(page,name)=>page.evaluate(name=>window.dispatchEvent(new CustomEvent('funded:product-event',{detail:{name}})),name);

for (const width of [390,1440]) test(`device-only consent stays local and separate consent shares only allowed counts at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const sent=[];await page.route('**/api/product-events',r=>{sent.push(r.request().postDataJSON());return r.fulfill({contentType:'application/json',body:'{"accepted":true}'});});
  await page.addInitScript(()=>localStorage.setItem('funded.diagnostics.enabled','true'));
  await open(page);await expect(page.locator('#journey-consent')).not.toBeChecked();await emit(page,'launch_review');
  expect(sent).toEqual([]);
  await page.locator('#journey-consent').check();await emit(page,'launch_review');await expect.poll(()=>sent.length).toBe(1);
  expect(Object.keys(sent[0]).sort()).toEqual(['consent','event','session']);expect(sent[0].event).toBe('launch_review');
  await emit(page,'launch_review');await emit(page,'wallet_address');expect(sent.length).toBe(1);
  await page.locator('#journey-consent').uncheck();await emit(page,'trade_confirmed');expect(sent.length).toBe(1);
  expect(await page.evaluate(()=>sessionStorage.getItem('funded.journeys.session.v1'))).toBeNull();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.journey-preferences').screenshot({path:test.info().outputPath(`journey-privacy-${width}.png`)});
});

test('another tab opting out stops later events and a remote opt-in does not restart this tab',async({page,context})=>{
  const sent=[];await context.route('**/api/product-events',r=>{sent.push(r.request().postDataJSON());return r.fulfill({contentType:'application/json',body:'{"accepted":true}'});});
  // Context route has lower priority than the page-wide API fixture.
  await page.route('**/api/product-events',r=>{sent.push(r.request().postDataJSON());return r.fulfill({contentType:'application/json',body:'{"accepted":true}'});});
  await open(page);await page.locator('#journey-consent').check();
  const other=await context.newPage();await other.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));await other.route('https://**/*',r=>r.abort());await other.goto('/');
  await other.evaluate(key=>localStorage.setItem(key,'false'),key);
  await expect(page.locator('#journey-consent')).not.toBeChecked();
  const count=sent.length;await emit(page,'boost_open');expect(sent.length).toBe(count);
  await other.evaluate(key=>localStorage.setItem(key,'true'),key);await emit(page,'token_view');expect(sent.length).toBe(count);
  await other.close();
});

test('storage or transport failure stops measurement without changing wallet or launch flows',async({page})=>{
  await open(page);
  await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='funded.journeys.consent.v1')throw new DOMException('Denied','SecurityError');return set.call(this,key,value);};});
  await page.locator('#journey-consent').click();await expect(page.locator('#journey-consent')).not.toBeChecked();
  await expect(page.locator('#journey-status')).toContainText('could not be saved');
  await page.reload();await page.locator('.product-details:has(#community-preferences)>summary').click();await page.locator('#community-preferences details>summary').click();
  await page.locator('#journey-consent').check();await emit(page,'boost_open');
  await expect(page.locator('#journey-consent')).not.toBeChecked();await expect(page.locator('#journey-status')).toContainText('paused in this tab');
});
