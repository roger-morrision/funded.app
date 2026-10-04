import {test,expect} from '@playwright/test';

const CONSENT='funded.diagnostics.enabled',COUNTS='funded.diagnostics.counts';
const errors=new WeakMap();
async function configure(page,found){page.on('pageerror',error=>found.push(error.message));await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));await page.route('https://**/*',route=>route.abort());}
test.beforeEach(async({page})=>{const found=[];errors.set(page,found);await configure(page,found);});
test.afterEach(async({page})=>expect(errors.get(page),'No uncaught browser errors').toEqual([]));
async function open(page){await page.goto('/#my-launches');await expect(page.locator('body')).toHaveClass(/workspace-ready/);await expect(page.locator('#community-preferences')).toBeVisible();}
async function diagnostics(page){await open(page);await page.locator('#community-preferences summary').click();}
async function raw(page,key){return page.evaluate(key=>(window.qaDiagnosticsGet||Storage.prototype.getItem).call(localStorage,key),key);}
async function navigateHome(page){await page.getByRole('link',{name:'Home',exact:true}).first().click();await expect(page).toHaveURL(/#overview$/);}
async function deny(page,method,key){await page.evaluate(({method,key})=>{const original=Storage.prototype[method];window.qaDiagnosticsGet=Storage.prototype.getItem;Storage.prototype[method]=function(name,...args){if(name===key)throw new DOMException('Storage unavailable','SecurityError');return original.call(this,name,...args);};},{method,key});}
const seedCounts={'2026-10-01':{navigation:7}};
async function seed(page){await page.addInitScript(({key,rows})=>localStorage.setItem(key,JSON.stringify(rows)),{key:COUNTS,rows:seedCounts});}

for(const width of [1440,390])test(`Portfolio preferences and diagnostics are wallet-free and keyboard reachable at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const writes=[];page.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(request.url());});
  await open(page);const panel=page.locator('#community-preferences');
  await expect(panel.getByRole('heading',{name:'Following & updates'})).toBeVisible();
  await expect(page.locator('#updates-consent')).toBeVisible();await expect(page.locator('#updates-consent')).not.toBeChecked();
  const summary=panel.locator('summary');await summary.focus();await page.keyboard.press('Enter');
  const consent=page.locator('#diagnostics-consent');await expect(consent).toBeVisible();await expect(consent).not.toBeChecked();expect(await raw(page,COUNTS)).toBeNull();
  await consent.focus();await page.keyboard.press('Space');await expect(consent).toBeChecked();expect(await raw(page,CONSENT)).toBe('true');
  await page.keyboard.press('Space');await expect(consent).not.toBeChecked();expect(await raw(page,CONSENT)).toBe('false');
  await expect(page.locator('#diagnostics-status')).toContainText('off');
  const bounds=await panel.evaluate(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}));
  expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(bounds.width);expect(bounds.overflow).toBe(false);expect(writes).toEqual([]);
  await panel.screenshot({path:test.info().outputPath(`preferences-${width}.png`)});
});

test('failed following page disables stale Next and retries page two without duplicating history',async({page})=>{
  const ids=Array.from({length:21},(_,index)=>String(100+index));await page.addInitScript(ids=>localStorage.setItem('funded.creator.following',JSON.stringify(ids)),ids);
  const requests=[];let secondAttempts=0;
  await page.route('**/api/creator-support/following-updates?*',route=>{const after=new URL(route.request().url()).searchParams.get('after');requests.push(after);if(after&&++secondAttempts===1)return route.fulfill({status:503,contentType:'application/json',body:'{}'});return route.fulfill({contentType:'application/json',body:JSON.stringify({creators:[{id:after||'100',handle:after?'@second':'@first',updates:[{text:after?'Second page update':'First page update',createdAt:'2026-10-04T00:00:00Z'}]}],checkedCount:after?1:20,requestedCount:21,nextCursor:after?null:'120'})});});
  await open(page);await page.locator('#updates-consent').check();await expect(page.locator('#following-updates')).toContainText('First page update');
  await page.locator('#updates-next').click();await expect(page.locator('#following-status')).toContainText('Updates are unavailable');await expect(page.locator('#updates-next')).toBeDisabled();await expect(page.locator('#updates-previous')).toBeEnabled();
  await expect(page.locator('#following-updates article')).toHaveCount(0);expect(requests).toEqual(['','120']);
  await page.getByRole('button',{name:'Retry followed updates'}).click();await expect(page.locator('#following-updates')).toContainText('Second page update');await expect(page.locator('#following-status')).toContainText('Page 2');
  await page.locator('#updates-previous').click();await expect(page.locator('#following-updates')).toContainText('First page update');await expect(page.locator('#following-status')).toContainText('Page 1');await expect(page.locator('#updates-previous')).toBeDisabled();expect(requests).toEqual(['','120','120','']);
  expect(JSON.parse(await raw(page,'funded.creator.following'))).toEqual(ids);
});

test('turning off following updates discards an in-flight page without changing follows',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('funded.creator.following','["100"]'));let pending;
  await page.route('**/api/creator-support/following-updates?*',route=>{pending=route;});await open(page);await page.locator('#updates-consent').check();await expect.poll(()=>Boolean(pending)).toBe(true);
  await page.locator('#updates-consent').uncheck();await pending.fulfill({contentType:'application/json',body:JSON.stringify({creators:[{id:'100',handle:'@late',updates:[{text:'Must remain hidden'}]}],checkedCount:1,requestedCount:1,nextCursor:null})});
  await expect(page.locator('#following-updates article')).toHaveCount(0);await expect(page.locator('#following-status')).toContainText('Enable in-app updates');await expect(page.locator('#updates-next')).toBeDisabled();expect(await raw(page,'funded.creator.following')).toBe('["100"]');
});

for(const revoke of ['native opt-out','site data clear'])test(`${revoke} in another tab stops diagnostics before later native navigation`,async({page,context})=>{
  await diagnostics(page);await page.locator('#diagnostics-consent').check();const other=await context.newPage();await configure(other,errors.get(page));await diagnostics(other);await expect(other.locator('#diagnostics-consent')).toBeChecked();
  if(revoke==='native opt-out')await page.locator('#diagnostics-consent').uncheck();else await page.evaluate(()=>localStorage.clear());
  await expect(other.locator('#diagnostics-consent')).not.toBeChecked();const before=await raw(other,COUNTS);await navigateHome(other);expect(await raw(other,COUNTS)).toBe(before);
  expect(await raw(other,CONSENT)).toBe(revoke==='native opt-out'?'false':null);
  if(revoke==='native opt-out'){
    await page.locator('#diagnostics-consent').check();await expect.poll(()=>raw(other,CONSENT)).toBe('true');
    await expect(other.locator('#diagnostics-consent')).not.toBeChecked();
    await other.locator('#sidebar a[href="#explore"]').click();await expect(other).toHaveURL(/#explore$/);
    expect(await raw(other,COUNTS)).toBe(before);
  }
  await other.close();
});

test('failed diagnostics opt-in stays unchecked without creating counters',async({page})=>{
  await diagnostics(page);await deny(page,'setItem',CONSENT);await page.locator('#diagnostics-consent').click();await expect(page.locator('#diagnostics-consent')).not.toBeChecked();await expect(page.locator('#diagnostics-status')).toContainText('preference could not be saved');expect(await raw(page,CONSENT)).toBeNull();await navigateHome(page);expect(await raw(page,COUNTS)).toBeNull();
});

test('failed diagnostics opt-out stops this tab and reports the retained setting honestly',async({page})=>{
  await diagnostics(page);await page.locator('#diagnostics-consent').check();await deny(page,'setItem',CONSENT);await page.locator('#diagnostics-consent').uncheck();await expect(page.locator('#diagnostics-status')).toContainText('Counting stopped in this tab');await expect(page.locator('#diagnostics-status')).toContainText('saved setting may be unchanged');expect(await raw(page,CONSENT)).toBe('true');const before=await raw(page,COUNTS);await navigateHome(page);expect(await raw(page,COUNTS)).toBe(before);await expect(page.locator('#diagnostics-consent')).not.toBeChecked();
});

for(const [method,action] of [['getItem','read'],['setItem','update'],['removeItem','clear']])test(`diagnostics counter ${action} failure preserves saved data and stops counting`,async({page})=>{
  await seed(page);await diagnostics(page);await page.locator('#diagnostics-consent').check();await deny(page,method,COUNTS);
  if(method==='removeItem')await page.locator('#diagnostics-clear').click();else await navigateHome(page);
  await expect(page.locator('#diagnostics-consent')).not.toBeChecked();await expect(page.locator('#diagnostics-status')).toContainText('Counting stopped in this tab');
  await expect(page.locator('#diagnostics-status')).toContainText(method==='removeItem'?'could not be cleared':'could not be updated');if(method==='removeItem')await expect(page.locator('#diagnostics-status')).toContainText('Saved data may remain');
  expect(JSON.parse(await raw(page,COUNTS))).toEqual(seedCounts);
});

test('diagnostics consent read failure blocks counting despite a previously saved opt-in',async({page})=>{
  await seed(page);await diagnostics(page);await page.locator('#diagnostics-consent').check();await deny(page,'getItem',CONSENT);await navigateHome(page);
  await expect(page.locator('#diagnostics-consent')).not.toBeChecked();await expect(page.locator('#diagnostics-status')).toContainText('Counting stopped in this tab');expect(JSON.parse(await raw(page,COUNTS))).toEqual(seedCounts);expect(await raw(page,CONSENT)).toBe('true');
});

test('clearing local counters keeps successful consent and counts only later navigation',async({page})=>{
  await seed(page);await diagnostics(page);await page.locator('#diagnostics-consent').check();await page.locator('#diagnostics-clear').click();await expect(page.locator('#diagnostics-consent')).toBeChecked();await expect(page.locator('#diagnostics-status')).toContainText('counting remains on');expect(await raw(page,COUNTS)).toBeNull();expect(await raw(page,CONSENT)).toBe('true');await navigateHome(page);const rows=JSON.parse(await raw(page,COUNTS));expect(Object.values(rows).reduce((sum,row)=>sum+row.navigation,0)).toBe(1);
});
