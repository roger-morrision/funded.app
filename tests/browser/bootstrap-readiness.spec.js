import {test,expect} from '@playwright/test';

const failures=new WeakMap();
test.beforeEach(async({page})=>{
  const found=[];failures.set(page,found);page.on('pageerror',error=>found.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/x/me',route=>route.fulfill({json:{authenticated:false,configured:true}}));
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
  expect(await page.locator('#token-name').evaluate(node=>Boolean(node.closest('[inert]')))).toBe(true);
}
async function ready(page){
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state','ready');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('[data-bootstrap-inert]')).toHaveCount(0);
  await expect(gate(page)).toBeHidden();
}
async function launchReady(page){
  await expect(page.locator('#token-name')).toBeVisible();
  await expect(page.locator('.launch-draft-panel')).toHaveCount(0);
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
  await ready(page);await expect(page).toHaveURL(/\?startup=fixture#launch$/);await launchReady(page);
});

test('a held required app import cannot accept launch input or keyboard focus before handlers exist',async({page})=>{
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
  expect(await page.evaluate(()=>Boolean(document.activeElement.closest('[hidden],[inert]')))).toBe(false);await launchReady(page);
});

test('slow successful startup unlocks after the loading reminder without requiring a reload',async({page})=>{
  let held;
  await page.clock.install();
  await page.route('**/app.js*',route=>{held=route;});
  await page.goto('/#launch',{waitUntil:'commit'});
  await expect.poll(()=>Boolean(held)).toBe(true);
  await locked(page);
  await page.clock.fastForward(10_001);
  await expect(gate(page)).toContainText('Still loading');
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state','loading');
  await expect(page.locator('.app-shell')).toHaveAttribute('inert','');
  await held.continue();
  await ready(page);
  await launchReady(page);
  await expect(page).toHaveURL(/#launch$/);
});

for(const [name,path,state] of [['gate','bootstrap-gate.js','failed'],['entry','bootstrap.js','failed'],['required app','app.js','failed']])test(`${name} import failure leaves an accessible recovery action and reload restores the requested route`,async({page})=>{
  let failed=false;await page.route(`**/${path}*`,route=>{failed=true;return route.abort('failed');});
  await page.goto('/?recover=1#launch',{waitUntil:'domcontentloaded'});await expect.poll(()=>failed).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state',state);await expect(page.locator('.app-shell')).toHaveAttribute('inert','');
  await expect(gate(page)).toBeVisible();await expect(reload(page)).toBeVisible();if(state==='failed')await expect(gate(page)).toContainText(/could not|unable|failed/i);
  await page.keyboard.press('Tab');await expect(reload(page)).toBeFocused();await page.unroute(`**/${path}*`);await page.keyboard.press('Enter');
  await ready(page);await expect(page).toHaveURL(/\?recover=1#launch$/);await launchReady(page);
  if (name !== 'required app') failures.set(page, failures.get(page).filter(message => !/Failed to fetch dynamically imported module: .*\/bootstrap\.js/.test(message)));
});

test('optional module failure reports degraded startup while initialized app controls remain usable',async({page})=>{
  await page.route('**/creator-support-ui.js*',route=>route.abort('failed'));await page.goto('/#launch');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state','degraded');
  await expect(page.locator('[data-bootstrap-inert]')).toHaveCount(0);await expect(gate(page)).toBeVisible();await expect(gate(page)).toContainText(/some features|could not/i);await launchReady(page);
  await expect(reload(page)).toBeVisible();
});

test('an unresolved optional module does not keep already initialized app controls locked',async({page})=>{
  let held;await page.route('**/creator-support-ui.js*',route=>{held=route;});await page.goto('/#launch',{waitUntil:'commit'});await expect.poll(()=>Boolean(held)).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state','ready');await expect(page.locator('[data-bootstrap-inert]')).toHaveCount(0);await expect(gate(page)).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/workspace-ready/);await launchReady(page);
  await page.locator('#token-name').fill('Kept while optional module loads');await held.continue();await ready(page);
  await expect(page.locator('#token-name')).toHaveValue('Kept while optional module loads');await expect(page.locator('#token-name')).toBeFocused();
});

const HANDOFF_KEY='funded.pendingTradeMint';
const TOKEN_MINT='So11111111111111111111111111111111111111112';
const OTHER_MINT='11111111111111111111111111111111';
for(const denial of ['pending-read','all-session-methods','session-getter'])test(`optional ${denial} denial does not prevent wallet-free startup or navigation`,async({page})=>{
  await page.addInitScript(({denial,key})=>{
    const store=window.sessionStorage;
    if(denial==='session-getter'){Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('Session storage denied','SecurityError');}});return;}
    for(const method of denial==='all-session-methods'?['getItem','setItem','removeItem']:['getItem']){
      const original=Storage.prototype[method];Storage.prototype[method]=function(name,...args){if(this===store&&(denial==='all-session-methods'||name===key))throw new DOMException('Session storage denied','SecurityError');return original.call(this,name,...args);};
    }
  },{denial,key:HANDOFF_KEY});
  await page.goto('/#overview');await ready(page);
  await page.locator('#sidebar a[href="#explore"]').click();await expect(page).toHaveURL(/#explore$/);
  await page.locator('#explore-search').fill('Wallet-free search');await expect(page.locator('#explore-search')).toHaveValue('Wallet-free search');
});

test('failed optional handoff removal preserves stored data while the explicit token URL selects the mint',async({page})=>{
  await page.addInitScript(({key,mint})=>{sessionStorage.setItem(key,mint);const original=Storage.prototype.removeItem;Storage.prototype.removeItem=function(name){if(this===sessionStorage&&name===key)throw new DOMException('Removal denied','SecurityError');return original.call(this,name);};},{key:HANDOFF_KEY,mint:OTHER_MINT});
  await page.goto(`/token/${TOKEN_MINT}`);await ready(page);
  await expect(page.locator('#trade-mint')).toHaveValue(TOKEN_MINT);
  expect(await page.evaluate(key=>sessionStorage.getItem(key),HANDOFF_KEY)).toBe(OTHER_MINT);
  await expect(page).toHaveURL(new RegExp(`/token/${TOKEN_MINT}$`));
});

test('a failed optional handoff write still opens the selected watchlist token through native Trade',async({page})=>{
  await page.addInitScript(({key,mint})=>{
    localStorage.setItem('funded.app.community.watchlist',JSON.stringify([mint]));
    const original=Storage.prototype.setItem;Storage.prototype.setItem=function(name,value){if(this===sessionStorage&&name===key)throw new DOMException('Quota exceeded','QuotaExceededError');return original.call(this,name,value);};
  },{key:HANDOFF_KEY,mint:TOKEN_MINT});
  // Synthetic registry and mint-account bytes exercise the real verification/render path.
  // No RPC request leaves the browser, and no synthetic evidence is a chain proof.
  const mintBytes=Buffer.alloc(82);mintBytes.writeBigUInt64LE(1_000_000_000n,36);mintBytes[44]=6;mintBytes[45]=1;
  const account={data:[mintBytes.toString('base64'),'base64'],owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',lamports:1_000_000,executable:false,rentEpoch:0};
  await page.route('**/api/pump/explore?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({cluster:'devnet',items:[{mint:TOKEN_MINT,name:'Synthetic navigation fixture',symbol:'FIXTURE',createdTimestamp:1,lastTradeTimestamp:1}],fetchedAt:new Date().toISOString()})}));
  const rpcMethods=[];
  const mockRpc=route=>{
    const request=route.request().postDataJSON();rpcMethods.push(request.method);
    const body=request.method==='getMultipleAccounts'?{jsonrpc:'2.0',id:request.id,result:{context:{slot:1},value:request.params[0].map(mint=>mint===TOKEN_MINT?account:null)}}:{jsonrpc:'2.0',id:request.id,error:{code:-32000,message:'Offline fixture has no additional RPC evidence'}};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  };
  await page.route('**/api/solana/rpc*',mockRpc);
  await page.route('https://api.devnet.solana.com/**',mockRpc);
  await page.goto('/#community');await ready(page);
  const trade=page.locator(`#watchlist-items [data-trade-mint="${TOKEN_MINT}"]`);await expect(trade).toBeVisible();
  await trade.click();await expect(page).toHaveURL(new RegExp(`/token/${TOKEN_MINT}$`));await ready(page);
  await expect(page.locator('#trade-mint')).toHaveValue(TOKEN_MINT);expect(await page.evaluate(key=>sessionStorage.getItem(key),HANDOFF_KEY)).toBeNull();
  expect(rpcMethods).toContain('getMultipleAccounts');expect(rpcMethods.some(method=>/sendTransaction|requestAirdrop/i.test(method))).toBe(false);
});
