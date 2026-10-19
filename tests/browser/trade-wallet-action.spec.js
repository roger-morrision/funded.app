import { test, expect } from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

const mint = '7YPFkWDS4rAoXZmv5xmcoMqY6go2UwNc1PN5Wc2bq8x7';
const address = '11111111111111111111111111111111';

for (const [width, height] of [[390, 844], [1440, 900]]) for (const side of ['buy', 'sell']) {
  test(`trade wallet chooser returns to ${side} at ${width}px without signing`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(walletAddress => {
      sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1');
      const listeners = new Map();
      const calls = { connect:0, signMessage:0, signTransaction:0 };
      const provider = {
        isPhantom:true, isConnected:false, publicKey:null,
        on(event, callback) { listeners.set(event, [...(listeners.get(event) || []), callback]); },
        async connect() {
          calls.connect++;
          provider.publicKey = { toBase58:() => walletAddress };
          provider.isConnected = true;
          for (const callback of listeners.get('connect') || []) callback(provider.publicKey);
          return { publicKey:provider.publicKey };
        },
        async signMessage() { calls.signMessage++; throw new Error('Unexpected signMessage'); },
        async signTransaction() { calls.signTransaction++; throw new Error('Unexpected signTransaction'); },
      };
      window.phantom = { solana:provider }; window.solana = provider; window.tradeWalletCalls = calls;
    }, address);
    const writes = [];
    await page.route('**/api/**', route => {
      const request = route.request();
      if(new URL(request.url()).pathname==='/api/fee-policy')return route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}});
      let readonlyRpc=false;
      if(new URL(request.url()).pathname==='/api/solana/rpc')try{
        const payload=request.postDataJSON(),calls=Array.isArray(payload)?payload:[payload];
        readonlyRpc=calls.length>0&&calls.every(call=>/^(get[A-Z][A-Za-z0-9]*|isBlockhashValid|simulateTransaction)$/.test(call?.method||''));
      }catch{ /* Unknown request bodies remain writes and fail this assertion. */ }
      if (request.method() !== 'GET' && !readonlyRpc)
        writes.push(`${request.method()} ${request.url()}`);
      return route.fulfill({ status:503, json:{ error:'Mocked offline API' } });
    });
    await page.route('https://**/*', route => route.abort());
    await page.goto(`/token/${mint}`);
    await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    if (width < 700) await page.locator('.mobile-trade-open').click();
    if (side === 'sell') await page.locator('[data-coin-trade-side="sell"]').click();
    await page.locator('#trade-amount').fill('0.1');
    await page.locator('#trade-slippage').evaluate(input => { input.value = '2'; input.dispatchEvent(new Event('input', { bubbles:true })); });
    await expect(page.locator('#trade-submit')).toBeDisabled();
    const action = page.locator('#trade-connect-wallet');
    await expect(action).toBeVisible();
    expect(await action.evaluate(button => parseFloat(getComputedStyle(button).minHeight))).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await action.click();
    await expect(page.locator('#wallet-onboarding-dialog')).toHaveAttribute('open', '');
    if (width < 700) {
      await expect(page.locator('#trade-panel')).not.toHaveAttribute('aria-modal', 'true');
      await expect(page.locator('#coin-page')).not.toHaveClass(/trade-sheet-open/);
    }
    await expect(page.locator('#wallet-onboarding-dialog')).not.toHaveAttribute('inert', '');
    await page.keyboard.press('Escape');
    await expect(page.locator('#wallet-onboarding-dialog')).not.toHaveAttribute('open', '');
    if (width < 700) await expect(page.locator('#trade-panel')).toHaveAttribute('aria-modal', 'true');
    await expect(action).toBeFocused();
    await expect(page.locator('#trade-mint')).toHaveValue(mint);
    await expect(page.locator('#trade-side')).toHaveValue(side);
    await expect(page.locator('#trade-amount')).toHaveValue('0.1');
    await expect(page.locator('#trade-slippage')).toHaveValue('2');
    expect(await page.evaluate(() => window.tradeWalletCalls)).toEqual({ connect:0, signMessage:0, signTransaction:0 });
    if (width < 700) {
      await page.keyboard.press('Escape');
      await expect(page.locator('#trade-panel')).not.toHaveAttribute('aria-modal', 'true');
      await expect(page.locator('.mobile-trade-open')).toBeFocused();
      await page.locator('.mobile-trade-open').click();
    }
    await action.click();
    await page.locator('[data-wallet-choice="phantom"]').click();
    await expect(page.locator('#connect-button')).toHaveClass(/wallet-pill-connected/);
    await expect(action).toBeHidden();
    if (width < 700) await expect(page.locator('#trade-panel')).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#trade-mint')).toHaveValue(mint);
    await expect(page.locator('#trade-side')).toHaveValue(side);
    await expect(page.locator('#trade-amount')).toHaveValue('0.1');
    await expect(page.locator('#trade-slippage')).toHaveValue('2');
    await expect(page.locator('#trade-submit')).toBeDisabled();
    expect(await page.evaluate(() => window.tradeWalletCalls)).toEqual({ connect:1, signMessage:0, signTransaction:0 });
    expect(writes).toEqual([]);
  });
}
