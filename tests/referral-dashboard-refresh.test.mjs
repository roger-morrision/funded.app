import { readAppSource } from '../scripts/read-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

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
  const session = { address: 'wallet', provider: { async signMessage() { signatures++; return { signature: new Uint8Array(64).fill(7) }; } } };
  const context = {
    TextEncoder,
    bs58: { encode(bytes) { assert.equal(bytes.length, 64); return 'fixture-signature'; } },
    captureWalletSession: () => session,
    assertWalletSessionCurrent: () => {},
    isWalletSessionCurrent: () => true,
    renderReferralActivityEmpty: () => {},
    renderReferralLedgerEmpty: () => {},
    renderShareInsights: () => {},
    document: {
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
  vm.runInNewContext(source, context);
  return {
    refresh: () => context.refreshReferralClaims(),
    panel,
    calls,
    get signatures() { return signatures; },
    expire() { authenticated = false; },
    mismatch() { authenticated = true; authenticatedWallet = 'another-wallet'; },
  };
}

test('wallet refresh checks the session without requesting a signature', async () => {
  const f = fixture();
  await f.refresh();
  assert.deepEqual(f.calls, ['/api/referrals/session']);
  assert.equal(f.signatures, 0);
  const button = f.panel.children.find(child => child.textContent === 'Verify wallet to view');
  assert(button, 'An explicit approval action is available when the session is absent');

  await button.click();
  assert.equal(f.signatures, 1);
  assert(f.calls.includes('/api/referrals/session/verify'));

  f.calls.length = 0;
  await f.refresh();
  assert.equal(f.signatures, 1, 'A valid session is reused');
  assert(f.calls.includes('/api/referral-claims?wallet=wallet'));

  f.expire();
  f.calls.length = 0;
  await f.refresh();
  assert.deepEqual(f.calls, ['/api/referrals/session']);
  assert.equal(f.signatures, 1, 'An expired session does not sign during refresh');
});

test('a session belonging to another wallet never exposes private claims', async () => {
  const f = fixture();
  f.mismatch();
  await f.refresh();
  assert.deepEqual(f.calls, ['/api/referrals/session']);
  assert.equal(f.signatures, 0);
  assert(f.panel.children.some(child => child.textContent === 'Verify wallet to view'));
});
