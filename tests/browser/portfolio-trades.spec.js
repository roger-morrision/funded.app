import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const fixture=JSON.parse(readFileSync(new URL('../fixtures/wallet-pump-trades.json',import.meta.url)));
const wallet=fixture.wallet;

for (const initialFailure of [false,true]) test(`portfolio owns its trade history with zero Explore coverage, retry=${initialFailure}`,async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let failed=initialFailure,scans=0;
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'mocked unavailable'}}));
  await page.route('**/api/fee-policy',route=>route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route('**/api/launches',route=>route.fulfill({json:[{mint:fixture.mint,symbol:'FPQA',name:'FPQA',
    creatorWallet:wallet,cluster:'devnet',onchainVerified:true}]}));
  await page.route(`**/api/wallets/${wallet}/trades`,async route=>{
    scans++;
    if(failed) return route.fulfill({status:502,json:{error:'mocked provider failure'}});
    await route.fulfill({json:{wallet,cluster:'devnet',source:'finalized-wallet-pump-trades',coverage:'complete',
      scannedSignatures:7,signatureLimit:50,rowLimit:100,trades:fixture.cases.map((item,index)=>({
        trader:wallet,mint:fixture.mint,side:'buy',signature:item.reference.signature,slot:item.reference.slot,
        blockTime:Math.floor(Date.now()/1000)-60-index*60,decimals:6,finalized:true,
        tokenAmountRaw:['76701475546672','134726182334557'][index],solLamports:['247365234','247524751'][index],
      }))}});
  });
  // Isolated mocked provider; no signing key or live wallet is used.
  await page.addInitScript(address=>{
    const listeners=new Map();
    const provider={isPhantom:true,isConnected:false,publicKey:null,signTransaction:async tx=>tx,
      on(event,callback){listeners.set(event,[...(listeners.get(event)||[]),callback]);},
      async connect(options={}){
        if(options.onlyIfTrusted) throw new Error('Not trusted');
        provider.publicKey={toBase58:()=>address};provider.isConnected=true;
        for(const callback of listeners.get('connect')||[])callback(provider.publicKey);
        return {publicKey:provider.publicKey};
      },async disconnect(){provider.publicKey=null;provider.isConnected=false;
        for(const callback of listeners.get('disconnect')||[])callback();}};
    window.phantom={solana:provider};window.solana=provider;
  },wallet);
  await page.goto('/#my-launches');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.locator('#connect-button').click();
  await page.locator('[data-wallet-choice="phantom"]').click();
  await page.locator('[data-portfolio-tab="trades"]').click();
  if(initialFailure){
    await expect(page.locator('#portfolio-trade-rows')).toContainText('Wallet trade history is unavailable');
    await expect(page.locator('#portfolio-trade-rows')).not.toContainText('No trades found');
    failed=false;await page.locator('#portfolio-trades-refresh').click();
  }
  await expect(page.locator('#portfolio-trade-rows .portfolio-trade-row')).toHaveCount(2);
  await expect(page.locator('#portfolio-trade-note')).toContainText('7 wallet transactions checked');
  await expect(page.locator('#portfolio-trade-note')).not.toContainText('coins scanned');
  await expect(page.locator('#portfolio-trade-rows')).toContainText('76,701,475.546672');
  for(const item of fixture.cases) await expect(page.locator(`#portfolio-trade-rows a[href*="${item.reference.signature}"]`)).toHaveAttribute('href',/cluster=devnet/);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('#portfolio-trades-refresh')).toBeVisible();
  await page.screenshot({path:test.info().outputPath('portfolio-wallet-trades-mocked.png'),fullPage:true});
  await page.locator('#connect-button').click();
  await page.locator('#wallet-popover-disconnect').click();
  await expect(page.locator('#portfolio-trade-rows .portfolio-trade-row')).toHaveCount(0);
  await expect(page.locator('#portfolio-trade-rows')).toContainText('Connect a wallet');
  expect(scans).toBeGreaterThan(0);expect(errors).toEqual([]);
});
