import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const KEY = 'funded.vip.pending-listing-burn.v1';
const MINT = new PublicKey(new Uint8Array(32).fill(3)).toBase58();
const FUNDED = new PublicKey(new Uint8Array(32).fill(2)).toBase58();
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const found = []; errors.set(page, found); page.on('pageerror', error => found.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'No uncaught browser exceptions').toEqual([]));

async function api(page) {
  const state = { verified: false, posts: [] };
  await page.route('**/api/listings**', async route => {
    const url = new URL(route.request().url()); let body;
    if (url.pathname.endsWith('/quote')) {
      const input = route.request().postDataJSON();
      const now = Date.now();
      body = { id:`listing_${now}_0123456789abcdef`, mint:input.mint, payer:input.payer,
        fundedMint:FUNDED, usd:200, amountTokens:1, amountBaseUnits:'1000000', decimals:6, tokenPriceUsd:200,
        createdAt:new Date(now).toISOString(), expiresAt:new Date(now + 600_000).toISOString() };
    } else if (route.request().method() === 'POST') {
      const receipt = route.request().postDataJSON(); state.posts.push(receipt);
      if (!state.verified) return route.fulfill({ status: 503, json: { error: 'Fixture verifier unavailable' } });
      body = { ...receipt, onchainVerified: true, cluster: 'devnet' };
    } else if (url.pathname.endsWith('/config')) body = { enabled: true, cluster: 'devnet', fundedMint: FUNDED, usd:200, burnTokens: 1, tokenPriceUsd:200 };
    else if (url.pathname.includes('/mint/')) body = { cluster: 'devnet', mint: MINT, name: 'Fixture token', symbol: 'FIX' };
    else body = { cluster: 'devnet', listings: [] };
    await route.fulfill({ json: body });
  });
  return state;
}

async function component(page, mode = 'send-unknown') {
  const state = await api(page);
  await page.route('**/qa-listing-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('/qa-listing-fixture');
  await page.evaluate(async ({ html, mode, key }) => {
    const original = new DOMParser().parseFromString(html, 'text/html');
    document.body.append(original.querySelector('#list'), original.querySelector('#list-review'));
    // The isolated component starts after the app gate; financial controls retain
    // their original hidden/disabled attributes and are enabled only by initPaidListing.
    const dialog = document.querySelector('#list-review'); dialog.inert = false; dialog.removeAttribute('data-bootstrap-inert');
    const { Buffer, Keypair, PublicKey, Transaction, bs58 } = await import('/tests/browser/listing-fixture-deps.js');
    window.Buffer = Buffer;
    const { initPaidListing } = await import('/list-page.js');
    // Deterministic, in-memory cryptographic fixture. No connection object or
    // external signing service is created; every RPC below is a local function.
    const signer = Keypair.fromSeed(new Uint8Array(32).fill(1));
    const funded = new PublicKey(new Uint8Array(32).fill(2));
    const mint = new PublicKey(new Uint8Array(32).fill(3));
    const source = new PublicKey(new Uint8Array(32).fill(4));
    const program = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const fixture = window.listingFixture = { mode, signs: 0, sends: 0, confirmations: 0, savedBeforeSend: false, signature: null, confirmed: false };
    function account(isSource) {
      const data = Buffer.alloc(isSource ? 165 : 82);
      if (isSource) {
        data.set(funded.toBytes(), 0); data.set(signer.publicKey.toBytes(), 32);
        data.writeBigUInt64LE(fixture.confirmed ? 9000000n : 10000000n, 64); data[108] = 1;
      } else { data.writeBigUInt64LE(fixture.confirmed ? 99000000n : 100000000n, 36); data[44] = 6; data[45] = 1; }
      return { data, owner: program, executable: false, lamports: 2039280, rentEpoch: 0 };
    }
    const provider = { publicKey: signer.publicKey, signTransaction: async tx => { fixture.signs++; tx.partialSign(signer); return tx; } };
    const session = { provider, address: signer.publicKey.toBase58(), version: 1 };
    const rpc = {
      getGenesisHash: async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      getAccountInfo: async address => account(address.equals(source)),
      getTokenAccountsByOwner: async () => ({ value: [{ pubkey: source, account: account(true) }] }),
      getLatestBlockhash: async () => ({ blockhash: new PublicKey(new Uint8Array(32).fill(5)).toBase58(), lastValidBlockHeight: 999 }),
      sendRawTransaction: async raw => {
        fixture.sends++; fixture.signature = bs58.encode(Transaction.from(raw).signature);
        fixture.savedBeforeSend = JSON.parse(sessionStorage.getItem(key))?.signature === fixture.signature;
        if (fixture.mode === 'send-unknown') throw new Error('Fixture RPC timed out after accepting bytes');
        return fixture.signature;
      },
      getSignatureStatuses: async () => {
        fixture.confirmations++;
        if (fixture.mode === 'confirmation-unknown') throw new Error('Fixture confirmation transport unavailable');
        fixture.confirmed = true; return { value: [{ confirmationStatus: 'finalized', err: null }] };
      },
      getBlockHeight: async () => 100,
    };
    initPaidListing({ getSolana: async () => ({}), getConnection: () => rpc, getSession: () => session,
      assertSession: value => { if (value !== session) throw new Error('Wallet changed'); }, connectWallet: async () => {},
      cluster: 'devnet', fundedMint: funded.toBase58(), mainnetReadOnly: false });
  }, { html, mode, key: KEY });
  await page.locator('#list-mint').fill(MINT);
  await expect(page.locator('#list-pay')).toBeEnabled();
  return state;
}
async function approve(page) {
  await page.locator('#list-pay').click(); await expect(page.locator('#list-review')).toBeVisible();
  await page.locator('#list-review-confirm').click(); await expect(page.locator('#list-review')).not.toBeVisible();
}
async function fault(page, method) {
  await page.evaluate(({ key, method }) => {
    const original = Storage.prototype[method];
    Storage.prototype[method] = function (name, ...args) {
      if (this === sessionStorage && name === key) throw new DOMException('Fixture storage denied', 'SecurityError');
      return original.call(this, name, ...args);
    };
  }, { key: KEY, method });
}

for (const mode of ['send-unknown', 'confirmation-unknown']) test(`component retains the original burn through ${mode} and verification retry never burns again`, async ({ page }) => {
  const state = await component(page, mode); await approve(page);
  await expect(page.locator('#list-payment-status')).toContainText('Burn outcome is uncertain');
  const pending = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), KEY);
  expect(await page.evaluate(() => listingFixture.savedBeforeSend)).toBe(true);
  await expect(page.locator('#list-payment-status a')).toHaveAttribute('href', `https://explorer.solana.com/tx/${pending.signature}?cluster=devnet`);
  await expect(page.locator('#list-pay')).toBeDisabled();
  await page.locator('#list-retry').click(); await expect(page.locator('#list-payment-status')).toContainText('verification is pending');
  state.verified = true; await page.locator('#list-retry').click();
  await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), KEY)).toBe(null);
  expect(state.posts).toEqual([pending, pending]);
  expect(await page.evaluate(() => ({ signs: listingFixture.signs, sends: listingFixture.sends }))).toEqual({ signs: 1, sends: 1 });
});

test('component storage denial before broadcast reports no submission and sends no transaction', async ({ page }) => {
  await component(page); await fault(page, 'setItem'); await approve(page);
  await expect(page.locator('#list-payment-status')).toContainText('Signed burn recovery could not be saved. No transaction was sent');
  expect(await page.evaluate(() => ({ signs: listingFixture.signs, sends: listingFixture.sends }))).toEqual({ signs: 1, sends: 0 });
  expect(await page.evaluate(key => sessionStorage.getItem(key), KEY)).toBe(null);
});

test('component verified receipt with failed cleanup retains proof and blocks another burn', async ({ page }) => {
  const state = await component(page, 'confirmed'); state.verified = true; await fault(page, 'removeItem'); await approve(page);
  await expect(page.locator('#list-payment-status')).toContainText('Listing receipt verified, but recovery cleanup is incomplete');
  const pending = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), KEY);
  await expect(page.locator('#list-payment-status a')).toHaveAttribute('href', `https://explorer.solana.com/tx/${pending.signature}?cluster=devnet`);
  await expect(page.locator('#list-pay')).toBeDisabled(); await page.locator('#list-retry').click();
  await expect.poll(() => state.posts.length).toBe(2);
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), KEY)).toEqual(pending);
  expect(await page.evaluate(() => ({ signs: listingFixture.signs, sends: listingFixture.sends }))).toEqual({ signs: 1, sends: 1 });
});

test('actual app pauses listing on unreadable recovery and reload preserves the original receipt', async ({ page }) => {
  await api(page);
  const pending = { mint: MINT, wallet: FUNDED, name: 'Fixture token', symbol: 'FIX', signature: bs58.encode(new Uint8Array(64).fill(7)), cluster: 'devnet' };
  await page.addInitScript(({ key, pending }) => {
    if (!sessionStorage.getItem('qa-listing-seeded')) {
      sessionStorage.setItem(key, JSON.stringify(pending)); sessionStorage.setItem('qa-listing-seeded', 'true');
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (name) { if (this === sessionStorage && name === key) throw new DOMException('Fixture read denied', 'SecurityError'); return original.call(this, name); };
    }
  }, { key: KEY, pending });
  await page.goto('/#list'); await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#list-payment-status')).toContainText('Listing recovery storage cannot be read');
  await expect(page.locator('#list-retry')).toBeDisabled(); await expect(page.locator('#list-pay')).toBeDisabled();
  await expect(page.locator('#list-recovery p')).toContainText('Keep this tab open');
  await expect(page.locator('#list-recovery p')).toContainText('tab closure');
  await page.reload(); await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#list-payment-status')).toContainText('signed burn');
  await expect(page.locator('#list-payment-status a')).toHaveAttribute('href', `https://explorer.solana.com/tx/${pending.signature}?cluster=devnet`);
  await expect(page.locator('#list-pay')).toBeDisabled(); await expect(page.locator('#list-retry')).toBeEnabled();
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), KEY)).toEqual(pending);
});
