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

test('stale launch clients receive a retired router response', async () => {
  const f = fixture(createXIdentityRoutes, { mintRouterReadiness:async () =>
    assert.fail('New V2 launch preflight must not call legacy readiness') });
  assert.equal(await f.request('/api/mint-router/status', {}, 'GET'), true);
  assert.equal(f.responses[0].status, 410);
  assert.match(f.responses[0].data.error, /legacy route is retired/);
});

test('X launch readiness follows the verified V3 gate and OAuth prerequisites', async () => {
  let checks = 0;
  const env = { FUNDED_V3_X_CLAIMS_ENABLED:'false', X_BEARER_TOKEN:'test-only' };
  const f = fixture(createXIdentityRoutes, {
    env, xConfig:() => ({ clientId:'test', clientSecret:'test-only' }),
    xOAuthConfigured:() => true,
    resolveXUser:{ health:() => null },
    v3LaunchConfig:async () => { checks++; return { ready:true, reasons:[] }; },
  });
  await f.request('/api/x-fee/status', {}, 'GET');
  assert.equal(f.responses.at(-1).data.ready, false);
  assert.match(f.responses.at(-1).data.reasons.join(' '), /disabled/);
  env.FUNDED_V3_X_CLAIMS_ENABLED = 'true';
  await f.request('/api/x-fee/status', {}, 'GET');
  assert.equal(f.responses.at(-1).data.ready, true);
  assert.equal(f.responses.at(-1).data.scope, 'per-mint-v3');
  assert.equal(checks, 2);
  f.responses.length = 0;
  f.res.ended = false;
  const closed = fixture(createXIdentityRoutes, {
    env, xConfig:() => ({ clientId:'test', clientSecret:'test-only' }),
    xOAuthConfigured:() => true,
    resolveXUser:{ health:() => null },
    v3LaunchConfig:async () => ({ ready:false, reasons:['V3 program is unavailable'] }),
  });
  await closed.request('/api/x-fee/status', {}, 'GET');
  assert.equal(closed.responses.at(-1).data.ready, false);
  assert.deepEqual(closed.responses.at(-1).data.reasons, ['V3 program is unavailable']);
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

test('enabled V3 X claim listing includes only finalized funding for the signed-in X ID', async () => {
  const previous = process.env.FUNDED_V3_X_CLAIMS_ENABLED;
  process.env.FUNDED_V3_X_CLAIMS_ENABLED = 'true';
  const mint = Keypair.generate().publicKey.toBase58();
  const collection = '3'.repeat(64);
  const f = fixture(createXIdentityRoutes, {
    xSession: async () => ({ user:{ id:'123', username:'qa' } }),
    store:{ readCreatorState:async () => ({ obligations:{}, claims:{}, payouts:{} }),
      read:async () => ({
        launches:{ [mint]:{ mint, cluster:'devnet', xUserId:'123', onchainVerified:true,
          pumpFeeRoute:{scope:'per-mint-v3'} } },
        collections:{ [collection]:{ mint, status:'collected', onchainVerified:true } },
        v3CreatorRewardFunding:{ [collection]:{ mint, status:'finalized', amount:'9000000' },
          ['4'.repeat(64)]:{ mint, status:'verification-pending' } },
        v3Settlements:{ [collection]:{ status:'finalized', mint,
          allocationPlan:{ creatorDirected:{ xLamports:'5000000', holderLamports:'4000000' } } } },
        v3XClaims:{},
      }) },
    readReceiptEvidence:async () => ({ verifiedPayouts:[] }),
    automaticRewardStore:{ read:async () => ({}) },
  });
  try {
    await f.request('/api/x-fee/claims', {}, 'GET');
    assert.equal(f.responses.at(-1).status, 200);
    assert.equal(f.responses.at(-1).data.claims.length, 1);
    assert.equal(f.responses.at(-1).data.claims[0].id, collection);
    assert.equal(f.responses.at(-1).data.claims[0].canPrepare, true);
  } finally {
    if (previous === undefined) delete process.env.FUNDED_V3_X_CLAIMS_ENABLED;
    else process.env.FUNDED_V3_X_CLAIMS_ENABLED = previous;
  }
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
    claims: { claim: { xUserId: 'original', xAttestation: { subject: 'original' }, publicKey: 'wallet', expiresAt: new Date(0).toISOString() } },
    payouts: { receipt },
  }) }, xFeeReadiness: () => assert.fail('Paid receipt replay must not start payout') });
  assert.equal(await f.request('/api/sol-claims/claim/execute'), true);
  assert.equal(f.responses[0].data, receipt);
});

function referralFixture(transfer, reconcile = () => assert.fail('Unexpected reconciliation')) {
  const signer = Keypair.generate(), address = signer.publicKey.toBase58();
  const state = { referralClaims: { claim: { id: 'claim', recipientWallet: address, publicKey: address,
    nonce: 'nonce', amount: 0.01, asset: 'SOL', status: 'wallet-verified',
    expiresAt: new Date(Date.now() + 60000).toISOString() } }, payouts: {} };
  const f = fixture(createReferralClaimsRoutes, { walletKey: value => value, walletSignature: value => value,
    store: { readReferralClaimState: async () => structuredClone(state),
      updateReferralClaimState: async (_id, fn) => fn(state) },
    referralSession: async () => ({ wallet: address }), maxReferralPayoutSol: 1,
    devnetTestMode: true, referralPayoutKeypair: () => ({ fixture: true }),
    executeSolPayout: transfer, reconcileSolPayout: reconcile,
  });
  return { ...f, state, signer, address };
}

test('expired unsigned referral claims renew without opening paid or pending entitlements', async () => {
  const recipient = Keypair.generate().publicKey.toBase58();
  const old = { id: 'old', settlementSignature: 'collection', level: 1, recipientWallet: recipient,
    amount: 0.01, asset: 'SOL', nonce: 'old-nonce', status: 'wallet-verified', publicKey: recipient,
    expiresAt: new Date(Date.now() - 60_000).toISOString() };
  const state = { settlements: { collection: { asset: 'SOL', fundedApp: { referralLevels: [
    { level: 1, recipient, amount: 0.01, status: 'claimable' },
  ] } } }, referralClaims: { old }, payouts: {} };
  let nextId = 0;
  const f = fixture(createReferralClaimsRoutes, { walletKey: value => value, id: () => `new-${++nextId}`,
    referralClaimExpiryMs: 60_000, store: { update: async fn => fn(state),
      readReferralClaimState: async () => structuredClone(state) } });
  const input = { settlementSignature: 'collection', recipientWallet: recipient, level: 1 };
  await f.request('/api/referral-claims/prepare', input);
  const renewed = f.responses.at(-1).data;
  assert.equal(renewed.id, 'new-1');
  assert.notEqual(renewed.nonce, old.nonce);
  assert.equal(state.referralClaims.old.status, 'wallet-verified');
  await f.request('/api/referral-claims/prepare', input);
  assert.equal(f.responses.at(-1).data.id, renewed.id);
  await f.request('/api/referral-claims/old/verify');
  assert.equal(f.responses.at(-1).status, 409);
  state.referralClaims[renewed.id].status = 'verification-pending';
  await f.request('/api/referral-claims/prepare', input);
  assert.equal(f.responses.at(-1).data.id, renewed.id);
  state.referralClaims[renewed.id].status = 'paid';
  await f.request('/api/referral-claims/prepare', input);
  assert.equal(f.responses.at(-1).data.id, renewed.id);
  assert.equal(nextId, 1);
});

test('referral execution locks out concurrent requests and paid receipt replay', async () => {
  let release, submitted;
  const started = new Promise(resolve => { submitted = resolve; });
  let calls = 0;
  const f = referralFixture(async ({ recipientWallet, onSigned }) => {
    calls++; submitted();
    await new Promise(resolve => { release = resolve; });
    await onSigned({ signature: 'mock-transfer', from: f.signer.publicKey.toBase58() });
    return { signature: 'mock-transfer', to: recipientWallet, amountLamports: 10_000_000,
      recipientDeltaLamports: 10_000_000, from: f.signer.publicKey.toBase58(), finalized: true };
  });
  const pending = f.request('/api/referral-claims/claim/execute');
  await started;
  await f.request('/api/referral-claims/claim/execute');
  assert.equal(f.responses[0].status, 409);
  release(); await pending;
  assert.equal(f.state.referralClaims.claim.status, 'paid');
  assert.equal(f.state.referralClaims.claim.pendingSignature, 'mock-transfer');
  assert.equal(f.state.referralClaims.claim.pendingFrom, f.signer.publicKey.toBase58());
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

test('pending signed referral reconciles to one paid receipt without resending', async () => {
  let checks = 0;
  const f = referralFixture(() => assert.fail('Reconciliation must not resend'),
    async ({ recipientWallet, signature, from }) => {
      checks++;
      assert.equal(from, f.signer.publicKey.toBase58());
      return { signature, from, to: recipientWallet, amountLamports: 10_000_000,
        recipientDeltaLamports: 10_000_000, finalized: true };
    });
  f.state.referralClaims.claim.status = 'verification-pending';
  f.state.referralClaims.claim.pendingSignature = 'signed-transfer';
  f.state.referralClaims.claim.pendingFrom = f.signer.publicKey.toBase58();
  await f.request('/api/referral-claims/claim/execute');
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.state.referralClaims.claim.status, 'paid');
  await f.request('/api/referral-claims/claim/execute');
  assert.equal(checks, 1);
});

test('referral preflight failure keeps the wallet-verified claim retryable', async () => {
  const f = referralFixture(async () => { const error = new Error('Fund the recipient wallet first.'); error.safeToRetry = true; throw error; });
  await f.request('/api/referral-claims/claim/execute');
  assert.equal(f.responses.at(-1).status, 409);
  assert.match(f.responses.at(-1).data.error, /Fund the recipient wallet/);
  assert.equal(f.state.referralClaims.claim.status, 'wallet-verified');
  assert.equal(f.state.referralClaims.claim.pendingSignature, undefined);
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

test('retired creator claim execution is absent from the active fee handler', async () => {
  const f = fixture(createCreatorFeesRoutes, { solanaCluster: 'mainnet-beta',
    body: () => assert.fail('Unavailable claim body read'), store: { read: () => assert.fail('Unavailable ledger read') } });
  assert.equal(await f.request('/api/tokens/mint/creator-claim/prepare'), false);
  assert.deepEqual(f.responses, []);
});
