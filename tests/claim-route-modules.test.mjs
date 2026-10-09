import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { createXIdentityRoutes } from '../server/routes/x-identity.mjs';
import { createCreatorFeesRoutes } from '../server/routes/creator-fees.mjs';
import { createReferralClaimsRoutes } from '../server/routes/referral-claims.mjs';
import { createSolClaimsRoutes } from '../server/routes/sol-claims.mjs';

function fixture(create, dependencies = {}) {
  const responses = [], headers = {};
  const res = { setHeader: (name, value) => { headers[name] = value; },
    writeHead: (status, values) => { Object.assign(headers, values); responses.push({ status }); },
    end: () => { res.ended = true; } };
  const handler = create({ route: (path, method, pattern) => method && pattern.exec(path)?.[1],
    solanaCluster: 'devnet', body: async req => req.input, ...dependencies,
    respond: (_res, status, data) => responses.push({ status, data }) });
  return { responses, headers, res, request(path, input = {}, method = 'POST') {
    const origin = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*'
      ? process.env.CORS_ORIGIN : 'https://funded.vip';
    return handler({ method, input, headers: { origin, host: 'funded.vip' }, socket: { encrypted: true } },
      res, new URL(path, 'https://funded.vip'));
  } };
}

test('claim route modules pass unrelated paths to the next handler', async () => {
  for (const create of [createXIdentityRoutes, createCreatorFeesRoutes, createReferralClaimsRoutes, createSolClaimsRoutes]) {
    const f = fixture(create);
    assert.equal(await f.request('/api/health', {}, 'GET'), false);
    assert.deepEqual(f.responses, []);
  }
});

test('OAuth redirects and HTML failures stop dispatch exactly once', async () => {
  const pages = [];
  const f = fixture(createXIdentityRoutes, {
    xConfig: () => ({ clientId: 'fixture', clientSecret: 'synthetic' }),
    store: { chargeRpcRate: async () => true }, clientKey: () => 'fixture',
    xOAuthConfigured: () => true, xCallbackUrl: () => 'https://funded.vip/api/x/oauth/callback',
    xAuth: { start: async () => ({ state: 'state', binding: 'binding', challenge: 'challenge' }), consume: async () => null },
    html: (_res, status, title) => { pages.push({ status, title }); },
  });
  assert.equal(await f.request('/api/x/oauth/start', {}, 'GET'), true);
  assert.equal(f.responses[0].status, 302);
  assert.equal(f.res.ended, true);
  assert.equal(f.headers['cache-control'], 'no-store');
  assert.match(f.headers.location, /^https:\/\/x.com\/i\/oauth2\/authorize\?/);
  assert.equal(await f.request('/api/x/oauth/callback?state=expired', {}, 'GET'), true);
  assert.deepEqual(pages, [{ status: 400, title: 'X sign-in expired' }]);
  assert.equal(f.responses.length, 1);
});

test('private X claims reject anonymous access before reading financial data', async () => {
  const f = fixture(createXIdentityRoutes, { xSession: async () => null,
    store: { readCreatorState: () => assert.fail('Anonymous ledger read') } });
  assert.equal(await f.request('/api/x-fee/claims', {}, 'GET'), true);
  assert.equal(f.responses[0].status, 401);
  assert.equal(f.headers['cache-control'], 'no-store');
});

test('SOL obligations reject caller amounts and keeper denial stops dispatch', async () => {
  let denied = 0;
  const f = fixture(createSolClaimsRoutes, { requireAuthorized: () => { denied++; return false; },
    body: () => assert.fail('Denied obligation body read') });
  assert.equal(await f.request('/api/payout-obligations/sol', { amount: 100 }), true);
  assert.equal(f.responses[0].status, 410);
  assert.equal(await f.request('/api/x-fee/obligations'), true);
  assert.equal(denied, 1);
  assert.equal(f.responses.length, 1);
});

test('X claim preparation and wallet binding require the original signed-in identity', async () => {
  const claim = { id: 'claim', xUserId: 'original', recipient: '@original' };
  const f = fixture(createSolClaimsRoutes, { xSession: async () => ({ user: { id: 'other', username: 'other' } }),
    store: { readClaimState: async () => ({ claims: { claim }, obligations: { claim: {
      source: 'verified-per-mint-router-collection', xUserId: 'original',
    } } }), updateClaimState: () => assert.fail('Identity mismatch must not mutate') } });
  await f.request('/api/sol-claims/claim/prepare', { xHandle: '@original' });
  await f.request('/api/sol-claims/claim/prepare', { xHandle: '@other' });
  await f.request('/api/sol-claims/claim/verify', { xHandle: '@other' });
  assert.deepEqual(f.responses.map(row => row.status), [401, 409, 401]);
});

test('paid X claim replay returns its recorded receipt without invoking a payout service', async () => {
  const receipt = { claimId: 'claim', signature: 'confirmed-receipt', status: 'paid' };
  const f = fixture(createSolClaimsRoutes, { store: { readClaimState: async () => ({
    claims: { claim: { xUserId: 'original', xAttestation: { subject: 'original' }, publicKey: 'wallet' } },
    payouts: { receipt },
  }) }, xFeeReadiness: () => assert.fail('Paid receipt replay must not start payout') });
  assert.equal(await f.request('/api/sol-claims/claim/execute'), true);
  assert.equal(f.responses[0].data, receipt);
});

function referralFixture(transfer) {
  const signer = Keypair.generate(), address = signer.publicKey.toBase58();
  const state = { referralClaims: { claim: { id: 'claim', recipientWallet: address, publicKey: address,
    nonce: 'nonce', amount: 0.01, asset: 'SOL', status: 'wallet-verified',
    expiresAt: new Date(Date.now() + 60000).toISOString() } }, payouts: {} };
  const f = fixture(createReferralClaimsRoutes, { walletKey: value => value, walletSignature: value => value,
    store: { readReferralClaimState: async () => structuredClone(state),
      updateReferralClaimState: async (_id, fn) => fn(state) },
    referralSession: async () => ({ wallet: address }), maxReferralPayoutSol: 1,
    devnetTestMode: true, referralPayoutKeypair: () => ({ fixture: true }),
    executeSolPayout: transfer,
  });
  return { ...f, state, signer, address };
}

test('referral execution locks out concurrent requests and paid receipt replay', async () => {
  let release, submitted;
  const started = new Promise(resolve => { submitted = resolve; });
  let calls = 0;
  const f = referralFixture(async ({ recipientWallet }) => {
    calls++; submitted();
    await new Promise(resolve => { release = resolve; });
    return { signature: 'mock-transfer', to: recipientWallet };
  });
  const pending = f.request('/api/referral-claims/claim/execute');
  await started;
  await f.request('/api/referral-claims/claim/execute');
  assert.equal(f.responses[0].status, 409);
  release(); await pending;
  assert.equal(f.state.referralClaims.claim.status, 'paid');
  await f.request('/api/referral-claims/claim/execute');
  assert.equal(f.responses.at(-1).data.signature, 'mock-transfer');
  assert.equal(calls, 1);
});

test('uncertain referral transfer retains a pending state and rejects replay', async () => {
  let calls = 0;
  const f = referralFixture(async () => { calls++; throw Error('Confirmation unavailable'); });
  await assert.rejects(f.request('/api/referral-claims/claim/execute'), /Confirmation unavailable/);
  assert.equal(f.state.referralClaims.claim.status, 'verification-pending');
  await f.request('/api/referral-claims/claim/execute');
  assert.equal(f.responses.at(-1).status, 409);
  assert.equal(calls, 1);
});

test('referral wallet verification checks the signature before changing status', async () => {
  const f = referralFixture(() => assert.fail('Wallet verification cannot transfer'));
  f.state.referralClaims.claim.status = 'awaiting-wallet-signature';
  await f.request('/api/referral-claims/claim/verify', { publicKey: f.address, signature: new Uint8Array(64) });
  assert.equal(f.responses[0].status, 401);
  assert.equal(f.state.referralClaims.claim.status, 'awaiting-wallet-signature');
  const signature = nacl.sign.detached(new TextEncoder().encode('funded.app referral reward claim claim nonce nonce'), f.signer.secretKey);
  await f.request('/api/referral-claims/claim/verify', { publicKey: f.address, signature });
  assert.equal(f.responses[1].status, 200);
  assert.equal(f.state.referralClaims.claim.status, 'wallet-verified');
});

test('creator claim routes reject unsupported networks before accessing ledger or body', async () => {
  const f = fixture(createCreatorFeesRoutes, { solanaCluster: 'mainnet-beta',
    body: () => assert.fail('Unavailable claim body read'), store: { read: () => assert.fail('Unavailable ledger read') } });
  assert.equal(await f.request('/api/tokens/mint/creator-claim/prepare'), true);
  assert.equal(f.responses[0].status, 403);
});
