import {test, expect} from '@playwright/test';
import {Keypair} from '@solana/web3.js';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

// Isolated fixtures only: the address is generated for the test; no key is saved.
const wallet=Keypair.generate().publicKey.toBase58();
const code='FND-123456789ABC';
const signature='3'.repeat(88);
async function fixtures(page) {
  let privateRequests=0;
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Isolated fixture unavailable'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/referrals/session',route=>route.fulfill({json:{authenticated:true,wallet}}));
  await page.route('**/api/referrals/registration/prepare',route=>route.fulfill({json:{challengeId:'mocked-registration'}}));
  await page.route('**/api/referrals/registration/verify',route=>route.fulfill({json:{wallet,code}}));
  await page.route('**/api/referral-claims?*',route=>{privateRequests++;return route.fulfill({json:{claims:[
    {level:1,asset:'SOL',amountLamports:'57714',status:'paid',payoutSignature:signature},
    {level:2,asset:'SOL',amountLamports:'999999999',status:'verification-pending'},
  ]}});});
  await page.route('**/api/referrals/dashboard?*',route=>route.fulfill({json:{networkCreators:3,qualifiedCreators:2,conversionRate:66.67}}));
  await page.route('https://**/*',route=>route.abort());
  await page.addInitScript(address=>{
    const listeners=new Map();
    const provider={isPhantom:true,isConnected:false,publicKey:null,
      on(event,callback){listeners.set(event,[...(listeners.get(event)||[]),callback]);},
      async connect(options={}){if(options.onlyIfTrusted)throw new Error('Not trusted');provider.publicKey={toBase58:()=>address};provider.isConnected=true;for(const cb of listeners.get('connect')||[])cb(provider.publicKey);return{publicKey:provider.publicKey};},
      async disconnect(){provider.publicKey=null;provider.isConnected=false;for(const cb of listeners.get('disconnect')||[])cb();},
      async signMessage(){throw new Error('A mocked authenticated session must not request a new signature');},
      async signTransaction(){throw new Error('Referral dashboard must not submit a transaction');},
    };window.phantom={solana:provider};window.solana=provider;
  },wallet);
  return{privateRequests:()=>privateRequests};
}

for(const width of [320,390,1440])test(`referral invite and private receipt history stay clear at ${width}px`,async({page,context})=>{
  await page.setViewportSize({width,height:900});
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const fixture=await fixtures(page);
  await page.goto('/#referrals');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  const dashboard=page.locator('#referral-command-center');
  await expect(dashboard.getByRole('heading',{name:'Your invite link'})).toBeVisible();
  await expect(dashboard.locator('[data-copy-referral-link]')).toHaveCount(1);
  await expect(dashboard.locator('.referral-progress-panel,.referral-quick-steps')).toHaveCount(0);
  await expect(dashboard.locator('#referral-ledger-list')).toBeHidden();
  expect(fixture.privateRequests()).toBe(0);
  await dashboard.locator('[data-referral-connect]').click();
  await page.locator('[data-wallet-choice="phantom"]').click();
  await expect(dashboard.locator('#referral-paid-total')).toHaveText('0.000057714 SOL');
  await expect(dashboard.locator('#referral-active-creators')).toHaveText('2');
  await expect(dashboard.locator('#referral-conversion-rate')).toHaveText('66.67%');
  await expect(dashboard.locator('#referral-claim-center')).toBeHidden();
  await expect(dashboard.locator('.referral-ledger-row')).toHaveCount(2);
  await expect(dashboard.locator('#referral-history-note')).toContainText('Only paid receipts count');
  await expect(dashboard.getByRole('link',{name:'Transaction ↗'})).toHaveAttribute('href',`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  await expect(dashboard.locator('.share-insights')).not.toHaveAttribute('open','');
  await dashboard.locator('[data-copy-referral-link]').click();
  await expect(dashboard.locator('#referral-link-status')).toHaveText('Ready to share');
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toContain(`?ref=${code}`);
  await dashboard.getByRole('button',{name:'Copy code',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe(code);
  await dashboard.getByRole('button',{name:'Share',exact:true}).click();
  await expect(page.locator('#share-dialog')).toBeVisible();
  await expect(page.locator('#share-title')).toHaveText('Share your invite');
  await expect(page.locator('#share-link')).toHaveValue(new RegExp(`ref=${code}`));
  await page.locator('#share-close').click();
  await dashboard.locator('.share-insights summary').click();
  await expect(dashboard.locator('.share-insights')).toHaveAttribute('open','');
  await expect(dashboard.locator('.share-insights')).toContainText('Qualified creators');
  await dashboard.locator('.share-insights summary').click();
  const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth}));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
  await page.screenshot({path:`tmp/referral-cleanup-${width}-mocked.png`,fullPage:true});
  await page.locator('#connect-button').click();
  await page.locator('#wallet-popover-disconnect').click();
  await expect(dashboard.locator('#referral-paid-total')).toContainText('—');
  await expect(dashboard.locator('#referral-ledger-list')).toBeHidden();
  await expect(dashboard.getByRole('link',{name:'Transaction ↗'})).toHaveCount(0);
});
