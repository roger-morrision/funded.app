import { readAppSource } from '../scripts/read-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { referralStatusLabel, isReferralSignInCancelled } from '../referral-status.js';
import { createWalletSignIn } from '../wallet-signin.js';

const app = await readAppSource();
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from);
  assert(from >= 0 && to > from);
  return app.slice(from, to);
}
const source = [
  section('async function ensureReferralSession(', 'function renderReferralLedgerEmpty('),
  section('async function refreshReferralClaims(', 'function getReferralCode('),
].join('\n');

function element() {
  return {
    children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(_event, handler) { this.click = handler; },
  };
}

function fixture() {
  const panel = element();
  const dashboard = element();
  const calls = [];
  let authenticated = false;
  let authenticatedWallet = 'wallet';
  let signatures = 0;
  let signError = null;
  const session = { address: 'wallet', provider: { async signMessage() { signatures++; if (signError) throw signError; return { signature: new Uint8Array(64).fill(7) }; } } };
  const context = {
    TextEncoder,
    referralStatusLabel, isReferralSignInCancelled,
    paginateHistory: () => {},
    bs58: { encode(bytes) { assert.equal(bytes.length, 64); return 'fixture-signature'; } },
    captureWalletSession: () => session,
    assertWalletSessionCurrent: () => {},
    isWalletSessionCurrent: () => true,
    renderReferralActivityEmpty: () => {},
    renderReferralLedgerEmpty: () => {},
    renderShareInsights: () => {},
    updateTokenChatComposerState: () => {},
    document: {
      documentElement: {dataset:{}},
      body: {classList:{contains:()=>false}},
      querySelectorAll: () => [],
      querySelector(selector) { return selector === '#referral-claim-center' ? panel : selector === '#referral-command-center' ? dashboard : null; },
      createElement: element,
    },
    async apiRequest(path, options = {}) {
      calls.push(path);
      if (path === '/api/referrals/session') {
        if (!authenticated) throw new Error('Approval required');
        return { available: true, data: { authenticated: true, wallet: authenticatedWallet } };
      }
      if (path === '/api/referrals/session/prepare') return { available: true, data: { challengeId: 'fixture', statement: 'fixture referral access' } };
      if (path === '/api/referrals/session/verify') {
        assert.equal(options.body.signature, 'fixture-signature');
        authenticated = true;
        return { available: true, data: { authenticated: true, wallet: session.address } };
      }
      if (path.startsWith('/api/referral-claims?') || path.startsWith('/api/referrals/dashboard?')) return { available: false };
      assert.fail(`Unexpected request: ${path}`);
    },
  };
  context.walletSignIn = createWalletSignIn({ request: context.apiRequest, assertCurrent: context.assertWalletSessionCurrent, encodeSignature: context.bs58.encode });
  vm.runInNewContext(source, context);
  return {
    refresh: () => context.refreshReferralClaims(),
    panel,
    calls,
    get status() { return context.document.documentElement.dataset.referralStatus; },
    get signatures() { return signatures; },
    rejectSigning() { signError = Object.assign(new Error('User rejected the request.'), {code:4001}); },
    allowSigning() { signError = null; },
    expire() { authenticated = false; context.walletSignIn.clear(); },
    mismatch() { authenticated = true; authenticatedWallet = 'another-wallet'; },
  };
}

test('wallet refresh checks the session without requesting a signature', async () => {
  const f = fixture();
  await f.refresh();
  assert.deepEqual(f.calls, ['/api/referrals/session']);
  assert.equal(f.signatures, 0);
  assert.equal(f.status, 'Sign in to view');
  const button = f.panel.children.find(child => child.textContent === 'Sign in with wallet');
  assert(button, 'An explicit approval action is available when the session is absent');

  await button.click();
  assert.equal(f.signatures, 1);
  assert(f.calls.includes('/api/referrals/session/verify'));
  assert.equal(f.status, 'Rewards unavailable');

  f.calls.length = 0;
  await f.refresh();
  assert.equal(f.signatures, 1, 'A valid session is reused');
  assert(f.calls.includes('/api/referral-claims?wallet=wallet'));

  f.expire();
  f.calls.length = 0;
  await f.refresh();
  assert.deepEqual(f.calls, ['/api/referrals/session']);
  assert.equal(f.signatures, 1, 'An expired session does not sign during refresh');
  assert.equal(f.status, 'Sign in to view');
});

test('a session belonging to another wallet never exposes private claims', async () => {
  const f = fixture();
  f.mismatch();
  await f.refresh();
  assert.deepEqual(f.calls, ['/api/referrals/session']);
  assert.equal(f.signatures, 0);
  assert(f.panel.children.some(child => child.textContent === 'Sign in with wallet'));
});

test('declined wallet sign-in gives a truthful retry without loading private rewards', async () => {
  const f = fixture();
  await f.refresh();
  f.rejectSigning();
  await f.panel.children.find(child => child.textContent === 'Sign in with wallet').click();
  assert.equal(f.status, 'Sign-in cancelled');
  assert.equal(f.signatures, 1);
  assert(!f.calls.includes('/api/referrals/session/verify'));
  assert(!f.calls.some(path => path.startsWith('/api/referral-claims?')));
  assert.equal(f.panel.children[0].children[1].textContent, 'Wallet connected · sign-in cancelled');
  f.allowSigning();
  await f.panel.children.find(child => child.textContent === 'Sign in with wallet').click();
  assert.equal(f.signatures, 2);
  assert(f.calls.includes('/api/referrals/session/verify'));
});
