import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

const address = '11111111111111111111111111111111';

async function installPhantomFixture(page, { trusted = false, delayMs = 0 } = {}) {
  await page.addInitScript(({ address, trusted, delayMs }) => {
    if (trusted) localStorage.setItem('qa.phantom.trusted', '1');
    const install = () => {
      const listeners = new Map();
      const provider = {
        isPhantom: true,
        isConnected: false,
        publicKey: null,
        signTransaction: async transaction => transaction,
        signMessage: async () => {
          sessionStorage.setItem('qa.phantom.signatures', String(Number(sessionStorage.getItem('qa.phantom.signatures') || 0) + 1));
          return { signature: new Uint8Array(64).fill(7) };
        },
        on(event, callback) { listeners.set(event, [...(listeners.get(event) || []), callback]); },
        async connect(options = {}) {
          const calls = JSON.parse(sessionStorage.getItem('qa.phantom.calls') || '[]');
          calls.push(options.onlyIfTrusted === true ? 'trusted' : 'prompt');
          sessionStorage.setItem('qa.phantom.calls', JSON.stringify(calls));
          if (options.onlyIfTrusted === true && localStorage.getItem('qa.phantom.trusted') !== '1') {
            throw Object.assign(new Error('Not trusted'), { code: 4001 });
          }
          localStorage.setItem('qa.phantom.trusted', '1');
          provider.publicKey = { toBase58: () => address };
          provider.isConnected = true;
          for (const callback of listeners.get('connect') || []) callback(provider.publicKey);
          return { publicKey: provider.publicKey };
        },
        async disconnect() {
          provider.isConnected = false;
          provider.publicKey = null;
          for (const callback of listeners.get('disconnect') || []) callback();
        },
      };
      window.phantom = { solana: provider };
      window.solana = provider;
    };
    if (delayMs) setTimeout(install, delayMs);
    else install();
  }, { address, trusted, delayMs });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/fee-policy', route => route.fulfill({ json:{ split:PROTOCOL_FEE_SPLIT } }));
});

test('Phantom stays connected after reload and explicit disconnect stays disconnected', async ({ page }) => {
  await installPhantomFixture(page);
  await page.goto('/#payments');
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state', 'ready');
  await page.locator('#connect-button').click();
  await page.locator('[data-wallet-choice="phantom"]').click();
  await expect(page.locator('#connect-button')).toHaveClass(/wallet-pill-connected/);
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('qa.phantom.calls') || '[]')))
    .toEqual(['trusted', 'prompt']);

  await page.reload();
  await expect(page.locator('#connect-button')).toHaveClass(/wallet-pill-connected/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa.phantom.calls')))).toEqual(['trusted', 'prompt', 'trusted']);
  expect(await page.evaluate(() => localStorage.getItem('funded.app.wallet.provider'))).toBe('phantom');

  await page.locator('#connect-button').click();
  await page.locator('#wallet-popover-disconnect').click();
  await expect(page.locator('#connect-button')).not.toHaveClass(/wallet-pill-connected/);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state', 'ready');
  await expect(page.locator('#connect-button')).not.toHaveClass(/wallet-pill-connected/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa.phantom.calls')))).toEqual(['trusted', 'prompt', 'trusted']);

  await page.locator('#connect-button').click();
  await page.locator('[data-wallet-choice="phantom"]').click();
  await expect(page.locator('#connect-button')).toHaveClass(/wallet-pill-connected/);
  expect(await page.evaluate(() => localStorage.getItem('funded.app.wallet.manual-disconnect'))).toBeNull();
});

test('wallet menu stays open when a trusted connect event refreshes the same wallet', async ({ page }) => {
  await installPhantomFixture(page, { trusted: true });
  await page.goto('/#payments');
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state', 'ready');
  await expect(page.locator('#connect-button')).toHaveClass(/wallet-pill-connected/);
  await page.locator('#connect-button').click();
  await expect(page.locator('#wallet-popover-disconnect')).toBeVisible();
  await page.evaluate(() => window.phantom.solana.connect({ onlyIfTrusted: true }));
  await expect(page.locator('#connect-button')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#wallet-popover-disconnect')).toBeVisible();
  await page.locator('#wallet-popover-disconnect').click();
  await expect(page.locator('#connect-button')).not.toHaveClass(/wallet-pill-connected/);
});

test('trusted Phantom is restored when the extension injects after app startup', async ({ page }) => {
  await installPhantomFixture(page, { trusted: true, delayMs: 2000 });
  await page.goto('/#payments');
  await expect(page.locator('body')).toHaveAttribute('data-bootstrap-state', 'ready');
  await expect(page.locator('#connect-button')).toHaveClass(/wallet-pill-connected/, { timeout: 10000 });
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa.phantom.calls')))).toEqual(['trusted']);
});

test('signed wallet session renders an exact finalized referral payout', async ({ page }) => {
  await page.route('**/api/referrals/session**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/referrals/session') return route.fulfill({ status:200,
      contentType:'application/json', body:JSON.stringify({ authenticated:true, wallet:address }) });
    return route.fallback();
  });
  await page.route('**/api/referral-claims?**', route => route.fulfill({ status:200,
    contentType:'application/json', body:JSON.stringify({ wallet:address, claims:[{
      level:1, amount:0.000057714, amountLamports:'57714', asset:'SOL', status:'paid',
      payoutSignature:'fixture-finalized-signature' }] }) }));
  await page.route('**/api/referrals/dashboard?**', route => route.fulfill({ status:200,
    contentType:'application/json', body:JSON.stringify({ wallet:address,
      networkCreators:3, qualifiedCreators:1, conversionRate:33.3 }) }));
  await installPhantomFixture(page, { trusted:true });
  await page.goto('/#referrals');
  await expect(page.locator('#connect-button')).toHaveClass(/wallet-pill-connected/);
  await expect(page.locator('#referral-paid-total')).toHaveText('0.000057714 SOL');
  await expect(page.locator('#referral-active-creators')).toHaveText('1');
  await expect(page.locator('#referral-ledger-list')).toContainText('0.000057714 SOL');
  const row = page.locator('#referral-ledger-list .referral-ledger-row');
  await expect(row).toHaveCount(1); await expect(row).toBeVisible();
  await expect(row.locator('strong')).toHaveText('Level 1');
  await expect(row.locator('small')).toHaveText('Paid');
  await expect(row.locator('b')).toHaveText('0.000057714 SOL');
  const proof = row.getByRole('link',{name:'Transaction ↗',exact:true});
  await expect(proof).toHaveAttribute('title','fixture-finalized-signature');
  await expect(proof).toHaveAttribute('href', 'https://explorer.solana.com/tx/fixture-finalized-signature?cluster=devnet');
  await expect(proof).toHaveAttribute('rel', 'noopener noreferrer');
});

for (const [name, claims] of [
  ['missing history',null], ['null receipt',[null]],
  ['missing lamports',[{level:1,asset:'SOL',status:'paid',payoutSignature:'fixture'}]],
  ['invalid lamports',[{level:1,asset:'SOL',status:'paid',amountLamports:'invalid',payoutSignature:'fixture'}]],
  ['unsafe numeric lamports',[{level:1,asset:'SOL',status:'paid',amountLamports:9007199254740992,payoutSignature:'fixture'}]],
  ['unsupported asset',[{level:1,asset:'TOKEN',status:'paid',amountLamports:'57714',payoutSignature:'fixture'}]],
]) test(`${name} stays unavailable without a referral render exception`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/referrals/session', route => route.fulfill({ json:{ authenticated:true, wallet:address } }));
  await page.route('**/api/referral-claims?**', route => route.fulfill({ json:{ wallet:address, claims } }));
  await page.route('**/api/referrals/dashboard?**', route => route.fulfill({ json:{ wallet:address,
    networkCreators:3, qualifiedCreators:1, conversionRate:33.3 } }));
  await installPhantomFixture(page, { trusted:true }); await page.goto('/#referrals');
  await expect(page.locator('#referral-claim-center')).toContainText('Referral payout history unavailable');
  await expect(page.locator('#referral-paid-total')).toHaveText('— SOL');
  await expect(page.locator('#referral-active-creators')).toHaveText('1');
  await expect(page.locator('#referral-ledger-list')).toContainText('Receipts unavailable');
  expect(errors).toEqual([]);
});

test('long referral payout receipts fit a mobile wallet dashboard', async ({ page }) => {
  await page.setViewportSize({width:390,height:900});
  await page.route('**/api/referrals/session', route => route.fulfill({json:{authenticated:true,wallet:address}}));
  await page.route('**/api/referral-claims?**', route => route.fulfill({json:{wallet:address,claims:[{
    level:1,asset:'SOL',status:'paid',amount:0.000057714,amountLamports:'57714',payoutSignature:'7'.repeat(88)}]}}));
  await page.route('**/api/referrals/dashboard?**', route => route.fulfill({json:{wallet:address,networkCreators:1,qualifiedCreators:1,conversionRate:100}}));
  await installPhantomFixture(page,{trusted:true});await page.goto('/#referrals');
  const row=page.locator('#referral-ledger-list .referral-ledger-row');await expect(row).toHaveCount(1);await expect(row).toBeVisible();
  await page.screenshot({path:test.info().outputPath('referral-receipt-mobile.png'),fullPage:true});
  expect(await row.evaluate(node=>node.scrollWidth<=node.clientWidth),'Receipt row fits its container').toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile page has no horizontal overflow').toBe(true);
  await expect(row.locator('b')).toHaveText('0.000057714 SOL');
  await expect(row.locator('small')).toHaveText('Paid');
  const proof=row.getByRole('link',{name:'Transaction ↗',exact:true});
  await expect(proof).toHaveAttribute('title','7'.repeat(88));
  await expect(proof).toHaveAttribute('href','https://explorer.solana.com/tx/'+'7'.repeat(88)+'?cluster=devnet');
  await expect(proof).toHaveAttribute('rel','noopener noreferrer');
});

test('explicit wallet connection signs in once and reload never requests another signature', async ({ page }) => {
  let authenticated = false;
  await page.route('**/api/referrals/session**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/referrals/session' && route.request().method() === 'GET') {
      return route.fulfill({ status: authenticated ? 200 : 401, contentType: 'application/json', body: JSON.stringify(authenticated ? { authenticated: true, wallet: address } : { error: 'Approval required' }) });
    }
    if (url.pathname.endsWith('/prepare')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ challengeId: 'fixture', statement: 'fixture referral access' }) });
    if (url.pathname.endsWith('/verify')) {
      authenticated = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true, wallet: address }) });
    }
    return route.fallback();
  });
  await installPhantomFixture(page);
  await page.goto('/#referrals');
  await page.locator('#connect-button').click();
  await page.locator('[data-wallet-choice="phantom"]').click();
  await expect(page.locator('#connect-button')).toHaveClass(/wallet-pill-connected/);
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem('qa.phantom.signatures') || 0))).toBe(1);
  await expect(page.locator('#referral-claim-center button')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('#connect-button')).toHaveClass(/wallet-pill-connected/);
  await expect(page.locator('#referral-claim-center button')).toHaveCount(0);
  expect(await page.evaluate(() => Number(sessionStorage.getItem('qa.phantom.signatures') || 0))).toBe(1);

  authenticated = false;
  await page.reload();
  await expect(page.locator('#referral-claim-center button')).toHaveText('Sign in with wallet');
  expect(await page.evaluate(() => Number(sessionStorage.getItem('qa.phantom.signatures') || 0))).toBe(1);
  await page.locator('#referral-claim-center button').click();
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem('qa.phantom.signatures') || 0))).toBe(2);
});
