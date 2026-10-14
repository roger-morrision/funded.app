import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { createXIdentityRoutes } from '../server/routes/x-identity.mjs';
import { createCreatorFeesRoutes } from '../server/routes/creator-fees.mjs';

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
  for (const create of [createXIdentityRoutes, createCreatorFeesRoutes]) {
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

test('retired creator claim execution is absent from the active fee handler', async () => {
  const f = fixture(createCreatorFeesRoutes, { solanaCluster: 'mainnet-beta',
    body: () => assert.fail('Unavailable claim body read'), store: { read: () => assert.fail('Unavailable ledger read') } });
  assert.equal(await f.request('/api/tokens/mint/creator-claim/prepare'), false);
  assert.deepEqual(f.responses, []);
});
