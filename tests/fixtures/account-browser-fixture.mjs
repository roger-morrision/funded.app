import {expect} from '@playwright/test';
import {updateAccountPreferences,emptyPreferences} from '../../server/account-preferences.mjs';

// Browser-only authenticated account fixture. No wallet key, signature or RPC
// leaves this test; server authentication is covered separately by route tests.
export async function installAccountFixture(page,{wallet='11111111111111111111111111111111',mints=[]}={}){
  const state={wallet,mints:[...mints],preferences:emptyPreferences(),writes:[]};
  await page.addInitScript(address=>{
    const listeners=new Map(),provider={isPhantom:true,isConnected:false,publicKey:null,
      signMessage:async()=>new Uint8Array(64),signTransaction:async tx=>tx,
      on(event,fn){listeners.set(event,[...(listeners.get(event)||[]),fn]);},
      async connect(options={}){if(options.onlyIfTrusted)throw Error('Explicit fixture connection required');this.publicKey={toBase58:()=>address};this.isConnected=true;for(const fn of listeners.get('connect')||[])fn(this.publicKey);return{publicKey:this.publicKey};},
      async disconnect(){this.publicKey=null;this.isConnected=false;for(const fn of listeners.get('disconnect')||[])fn();}};
    window.phantom={solana:provider};window.solana=provider;
    sessionStorage.setItem('funded.app.wallet.manual-disconnect','1');
  },wallet);
  await page.route('**/api/x/me',r=>r.fulfill({json:{authenticated:false,configured:true}}));
  await page.route('**/api/referrals/session',r=>r.fulfill({json:{authenticated:true,wallet,expiresAt:Date.now()+3600000}}));
  await page.route('**/api/account-preferences?*',r=>{
    expect(new URL(r.request().url()).searchParams.get('wallet')).toBe(wallet);
    if(r.request().method()==='POST'){
      expect(r.request().headers()['x-preferences-csrf']).toBe('fixture-csrf');
      const input=r.request().postDataJSON();expect(input.wallet).toBe(wallet);
      state.writes.push(input);state.preferences=updateAccountPreferences(state.preferences,input);
    }
    return r.fulfill({json:{wallet,csrf:'fixture-csrf',preferences:state.preferences}});
  });
  await page.route('**/api/watchlist?*',r=>{
    const accountId='wallet:'+wallet;expect(new URL(r.request().url()).searchParams.get('accountId')).toBe(accountId);
    if(r.request().method()==='POST'){
      const input=r.request().postDataJSON();expect(input.accountId).toBe(accountId);expect(r.request().headers()['x-watchlist-csrf']).toBe('fixture-watchlist');
      state.writes.push(input);state.mints=input.action==='remove'?state.mints.filter(m=>m!==input.mint):[...new Set([...state.mints,input.mint])];
    }
    return r.fulfill({json:{accountId,csrf:'fixture-watchlist',mints:state.mints}});
  });
  state.connect=async()=>{await page.locator('body.product-flows-ready').waitFor();const preferences=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/account-preferences'&&r.request().method()==='GET'&&r.ok());await page.locator('#connect-button').click();await page.locator('[data-wallet-choice="phantom"]').click();await expect(page.locator('#connect-button')).toHaveClass(/wallet-pill-connected/);await preferences;};
  return state;
}
