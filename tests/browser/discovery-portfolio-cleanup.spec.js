import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z';
async function setup(page,width){
 await page.setViewportSize({width,height:900});
 await page.addInitScript(()=>{performance.setResourceTimingBufferSize(3000);sessionStorage.setItem('funded.app.wallet.manual-disconnect','1');});
 await page.route('https://**/*',r=>r.abort());
 await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Mocked unavailable data'}}));
 await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
}
const ready=async(page,path)=>{await page.goto(path);await expect(page.locator('body')).toHaveClass(/product-flows-ready/);};
const fits=async page=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
for(const width of [320,390,768,1440]){
 test(`Explore and Portfolio task hierarchy at ${width}px (mocked)`,async({page},info)=>{
  await setup(page,width);await ready(page,'/#explore');
  await expect(page.getByRole('navigation',{name:'Explore community'})).toBeVisible();
  const records=page.locator('#explore-public-records');await expect(records.locator('summary')).toHaveCount(0);
  await expect(records.locator('.explore-benefit-leaders')).toBeVisible();await expect(records.getByRole('heading',{name:'Rankings and public payouts',exact:true})).toBeVisible();
  // Quick-buy preferences were retired; trades are reviewed on the coin page.
  await expect(page.locator('#explore-trade-preferences')).toHaveCount(0);await fits(page);
  await page.screenshot({path:info.outputPath(`explore-${width}.png`),fullPage:true});
  await ready(page,'/#my-launches');await expect(page.locator('#my-launches > .purpose-page-nav')).toBeHidden();await expect(page.locator('[data-portfolio-tab="created"]')).toHaveText('My projects');await expect(page.locator('#recovery-inbox')).toBeHidden();await fits(page);
  await page.screenshot({path:info.outputPath(`portfolio-${width}.png`),fullPage:true});
  await page.locator('#portfolio-favorites-tab').click();await expect(page.locator('#portfolio-favorites-tab')).toHaveAttribute('aria-selected','true');await expect(page.locator('#portfolio-favorites-panel')).toBeVisible();
  await ready(page,'/#community');await expect(page.locator('#community')).toBeVisible();await expect(page.locator('#my-launches > .purpose-page-nav')).toBeVisible();await fits(page);
 });
 test(`Coin promotion panel keeps trading controls accessible at ${width}px (mocked)`,async({page},info)=>{
  await setup(page,width);await ready(page,`/token/${mint}`);
  const details=page.locator('.coin-promotion-details');await expect(details.locator('summary')).toHaveCount(0);await expect(page.locator('#coin-watch')).toBeVisible();await expect(page.locator('#coin-boost')).toBeVisible();
  await expect(details.locator('h2,p')).toHaveCount(0);await fits(page);
  if(width>1100){const panel=await details.boundingBox(),identity=await page.locator('.coin-identity-main').boundingBox();expect(panel.x).toBeGreaterThanOrEqual(identity.x+identity.width);}
  await page.evaluate(()=>document.querySelector('#coin-page-title').textContent='A community coin with a longer name');await fits(page);
  const name=await page.locator('#coin-page-title').boundingBox();expect(name.width).toBeGreaterThan(width===320?130:width<700?160:300);
  if(width<=700){await page.locator('.mobile-dock-buy').click();await expect(page.locator('#trade-panel')).toBeVisible();await expect(page.locator('#trade-amount')).toBeVisible();await page.locator('.mobile-trade-close').click();await expect(page.locator('.mobile-dock-buy')).toBeFocused();}
  else await expect(page.locator('#trade-amount')).toBeVisible();
  await page.screenshot({path:info.outputPath(`coin-${width}.png`),fullPage:true});
 });
}
test('Recovery hides empty state while preserving pending actions and wallet isolation (mocked wallets)',async({page})=>{
 await setup(page,390);await ready(page,'/#my-launches');await expect(page.locator('#recovery-inbox')).toBeHidden();
 await page.evaluate(async mint=>{
  const loaded=name=>performance.getEntriesByType('resource').find(row=>new URL(row.name).pathname.endsWith('/'+name)).name;
  const {recordTradeRecovery}=await import(loaded('trade-recovery-store.js'));
  const {initializeRecoveryInbox}=await import(loaded('recovery-inbox.js'));
  recordTradeRecovery({mint,walletAddress:mint,signature:'3'.repeat(64),side:'buy',symbol:'PENDING'});
  document.querySelector('#recovery-inbox').remove();window.fixtureRecoveryApp={connectedWalletAddress:'',pendingTradeVerifications:new Map(),verifyPendingTrade:async()=>{throw Error('Mocked RPC unavailable');}};
  initializeRecoveryInbox(window.fixtureRecoveryApp);
 },mint);
 const inbox=page.locator('#recovery-inbox');await expect(inbox).toBeVisible();await expect(inbox).toContainText('Connect the wallet used');await expect(inbox).not.toContainText('PENDING');
 const switchWallet=async address=>page.evaluate(address=>{window.fixtureRecoveryApp.connectedWalletAddress=address;window.dispatchEvent(new Event('funded:reward-identity-change'));},address);
 await switchWallet(mint);await expect(inbox).toContainText('PENDING');await inbox.getByRole('button',{name:'Check recorded trade',exact:true}).click();await expect(inbox).toContainText('recorded transaction is preserved');
 await inbox.getByRole('button',{name:'Check recorded trade',exact:true}).focus();await switchWallet('So11111111111111111111111111111111111111112');await expect(inbox).toBeHidden();await expect(page.locator('#my-launches > .section-heading :is(h1,h2)')).toBeFocused();
 await switchWallet(mint);await expect(inbox).toBeVisible();await expect(inbox.getByRole('link',{name:'Inspect transaction'})).toHaveAttribute('href',new RegExp('3'.repeat(64)));
});

