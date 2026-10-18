import { readAppSource } from '../scripts/read-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { referralStatusLabel, referralClaimStatusLabel, isReferralSignInCancelled } from '../referral-status.js';
import { createWalletSignIn } from '../wallet-signin.js';
import { formatReferralLamports, readReferralHistory } from '../referral-amount.js';

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

function fixture({ claims = null } = {}) {
  const panel = element();
  const dashboard = element();
  const paidNode = element();
  const activeNode = element();
  const conversionNode = element();
  const ledger = element();
  const calls = [];
  const shared = [];
  let authenticated = false;
  let authenticatedWallet = 'wallet';
  let signatures = 0;
  let signError = null;
  let claimsAvailable = true;
  let dashboardAvailable = true;
  const session = { address: 'wallet', provider: { async signMessage() { signatures++; if (signError) throw signError; return { signature: new Uint8Array(64).fill(7) }; } } };
  const context = {
    TextEncoder,
    URL,
    location:{origin:'https://funded.vip'},
    formatReferralLamports,
    readReferralHistory,
    exploreExplorer: path => `https://explorer.solana.com/${path}?cluster=devnet`,
    FEE_ROUTER_PROGRAM_ID:'fixture-router', EXPLORE_NETWORK_LABEL:'Devnet',
    getSolana:async () => ({PublicKey:class {constructor(value){this.value=value;}toBase58(){return this.value;}}}),
    connection:{getParsedTransaction:async () => ({meta:{err:null,preBalances:[1000],postBalances:[58714]},
      transaction:{message:{accountKeys:[{pubkey:'wallet'}],instructions:[{programId:'fixture-router'}]}}})},
    registeredShareCode:() => '',
    openShareComposer:value => shared.push(value),
    showToast:message => { throw new Error(message); },
    referralStatusLabel, referralClaimStatusLabel, isReferralSignInCancelled,
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
      querySelector(selector) { return selector === '#referral-claim-center' ? panel : selector === '#referral-command-center' ? dashboard : selector === '#referral-paid-total' ? paidNode : selector === '#referral-active-creators' ? activeNode : selector === '#referral-conversion-rate' ? conversionNode : selector === '#referral-ledger-list' ? ledger : null; },
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
      if (path.startsWith('/api/referral-claims?')) return claims && claimsAvailable ? { available:true, data:{ claims } } : { available:false };
      if (path.startsWith('/api/referrals/dashboard?')) return claims && dashboardAvailable ? { available:true, data:{ networkCreators:1, qualifiedCreators:1, conversionRate:100 } } : { available:false };
      assert.fail(`Unexpected request: ${path}`);
    },
  };
  context.walletSignIn = createWalletSignIn({ request: context.apiRequest, assertCurrent: context.assertWalletSessionCurrent, encodeSignature: context.bs58.encode });
  vm.runInNewContext(source, context);
  return {
    refresh: () => context.refreshReferralClaims(),
    panel,
    paidNode,
    activeNode,
    conversionNode,
    ledger,
    calls,
    shared,
    get status() { return context.document.documentElement.dataset.referralStatus; },
    get signatures() { return signatures; },
    rejectSigning() { signError = Object.assign(new Error('User rejected the request.'), {code:4001}); },
    allowSigning() { signError = null; },
    expire() { authenticated = false; context.walletSignIn.clear(); },
    mismatch() { authenticated = true; authenticatedWallet = 'another-wallet'; },
    authenticate() { authenticated = true; },
    failClaims() { claimsAvailable = false; },
    failDashboard() { dashboardAvailable = false; },
    setClaims(value) { claims = value; },
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

test('a signed referral dashboard displays exact small finalized payouts', async () => {
  const f = fixture({ claims:[{ level:2, amount:0.000017314, amountLamports:'17314',
    asset:'SOL', status:'paid', payoutSignature:'finalized-qa-signature' }] });
  f.authenticate();
  await f.refresh();
  assert.equal(f.paidNode.textContent, '0.000017314 SOL');
  assert.equal(f.ledger.children[0].children[2].textContent, '0.000017314 SOL');
  assert.equal(f.panel.children[1].children[0].textContent, 'Level 2 · 0.000017314 SOL · Paid');
  assert.equal(f.signatures, 0, 'A valid wallet session needs no new signature');
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

const paidClaims = [{ level:1, amount:0.000057714, amountLamports:'57714',
  asset:'SOL', status:'paid', payoutSignature:'finalized-qa-signature' }];

test('expired sign-in clears previously displayed private referral totals', async () => {
  const f = fixture({ claims:paidClaims }); f.authenticate(); await f.refresh();
  assert.equal(f.paidNode.textContent, '0.000057714 SOL');
  f.expire(); await f.refresh();
  assert.equal(f.paidNode.textContent, '— SOL');
  assert.equal(f.activeNode.textContent, '—');
  assert.equal(f.conversionNode.textContent, '—');
});

test('independent referral request failures clear only their unavailable metrics', async () => {
  const f = fixture({ claims:paidClaims }); f.authenticate(); await f.refresh();
  f.failDashboard(); await f.refresh();
  assert.equal(f.activeNode.textContent, '—');
  assert.equal(f.conversionNode.textContent, '—');
  assert.equal(f.paidNode.textContent, '0.000057714 SOL');
  f.failClaims(); await f.refresh();
  assert.equal(f.paidNode.textContent, '— SOL');
});

test('paid referral receipts link directly to the configured network explorer', async () => {
  const f = fixture({ claims:paidClaims }); f.authenticate(); await f.refresh();
  const link = f.panel.children[1].children.find(child => child.href);
  assert(link);
  assert.equal(link.href, 'https://explorer.solana.com/tx/finalized-qa-signature?cluster=devnet');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
});

test('malformed claim history is unavailable rather than a zero payout or thrown render', async () => {
  const f = fixture({ claims:{} }); f.authenticate();
  await f.refresh();
  assert.equal(f.status, 'Rewards unavailable');
  assert.equal(f.paidNode.textContent, '— SOL');
});

for (const [name, row] of [
  ['null receipt', null],
  ['missing amount', {...paidClaims[0],amountLamports:undefined}],
  ['invalid amount', {...paidClaims[0],amountLamports:'invalid'}],
  ['negative pending amount', {...paidClaims[0],status:'verification-pending',amountLamports:'-1'}],
  ['unsafe numeric amount', {...paidClaims[0],amountLamports:Number.MAX_SAFE_INTEGER+1}],
  ['unsupported asset', {...paidClaims[0],asset:'TOKEN'}],
]) test(`${name} clears stale payout totals without a render exception`, async () => {
  const f = fixture({claims:paidClaims}); f.authenticate(); await f.refresh();
  f.setClaims([row]); await f.refresh();
  assert.equal(f.status,'Rewards unavailable');
  assert.equal(f.paidNode.textContent,'— SOL');
  assert.equal(f.activeNode.textContent,'1','Independent network metrics remain available');
});

test('pending allocations do not enter paid totals or receive a finalized-history description', async () => {
  const f = fixture({claims:[...paidClaims,{...paidClaims[0],status:'verification-pending',amountLamports:'999999999'}]});
  f.authenticate(); await f.refresh();
  assert.equal(f.paidNode.textContent,'0.000057714 SOL');
  assert.equal(f.panel.children[0].children[1].textContent,'Recorded referral allocations and finalized payout receipts.');
});

for (const amount of [undefined,10]) test(`share receipt derives its amount from verified lamports when the float is ${amount}`, async () => {
  const f = fixture({claims:[{...paidClaims[0],amount}]}); f.authenticate(); await f.refresh();
  const share = f.panel.children[1].children.find(node=>node.textContent==='Share receipt card');
  assert(share); await share.click();
  assert.equal(f.shared.length,1);
  assert.equal(f.shared[0].result.amount,0.000057714);
  assert.match(f.shared[0].text,/0\.000057714 SOL/);
});
