import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { launchPolicyStatement } from '../launch-policy-auth.js';
import { createLaunchRegistrationRoutes } from '../server/routes/launch-registration.mjs';
import { createRewardStatusRoutes } from '../server/routes/reward-status.mjs';
import { createXIdentityRoutes } from '../server/routes/x-identity.mjs';

function call(create, dependencies, path, method = 'GET') {
  const responses = [];
  const handle = create({ ...dependencies, respond: (_res, status, data) => responses.push({ status, data }) });
  const req = { method, headers: { origin: 'https://funded.vip' } };
  return handle(req, { setHeader() {} }, new URL(path, 'https://funded.vip'))
    .then(() => responses.at(-1));
}

test('public X launch status stays closed without the V3 claim gate while handle lookup remains usable', async () => {
  const dependencies = { xFeeReadiness:async () => assert.fail('V2 payout readiness must not gate X identity lookup'), clientKey: () => 'fixture',
    solanaCluster:'devnet', env:{ FUNDED_V3_X_CLAIMS_ENABLED:'false' },
    store: { chargeRpcRate: async () => true, read: async () => ({ creatorProfiles: {} }) },
    resolveXUser: async () => ({ id: '123', handle: '@fixture' }) };
  const status = await call(createXIdentityRoutes, dependencies, '/api/x-fee/status');
  assert.equal(status.status, 200);
  assert.equal(status.data.ready, false);
  assert.match(status.data.reasons[0], /V3 X claims are disabled/);
  const lookup = await call(createXIdentityRoutes, dependencies, '/api/x/resolve?handle=%40fixture');
  assert.equal(lookup.status, 200);
  assert.equal(lookup.data.id, '123');
});

test('reward status does not claim V3 X payout readiness from V2 configuration', async () => {
  const response = await call(createRewardStatusRoutes, {
    xFeeReadiness: async options => ({ ready: options?.creatorSigned === true, reasons: [] }),
    automaticRewardStore: { read: async () => ({}) }, store: { read: async () => ({ buybackOrders: {} }) },
    solanaCluster: 'devnet',
  }, '/api/rewards/automatic');
  assert.equal(response.status, 200);
  assert.equal(response.data.routeReadiness.x.ready, false);
  assert.equal(response.data.modes.x, 'unavailable');
});

test('public X payout status requires one consistent finalized V3 payment record', async () => {
  const mint = Keypair.generate().publicKey.toBase58();
  const wallet = Keypair.generate().publicKey.toBase58();
  const source = '3'.repeat(88), signature = '4'.repeat(88), programId = 'approved-v3-program';
  const payment = { status:'paid', amount:'123127', signature,
    finalized:true, balanceDeltaVerified:true };
  const state = {
    launches:{ [mint]:{ mint, cluster:'devnet', onchainVerified:true, xUserId:'123',
      pumpFeeRoute:{ scope:'per-mint-v3', programId, verified:true } } },
    collections:{ [source]:{ signature:source, mint, cluster:'devnet', scope:'per-mint-v3',
      status:'collected', onchainVerified:true, programId } },
    v3Settlements:{ [source]:{ status:'finalized', cluster:'devnet', mint, collectionSignature:source,
      allocationPlan:{ creatorDirected:{ xUserId:'123', xLamports:'123127',
        holderLamports:'0' } } } },
    v3CreatorRewardFunding:{ [source]:{ status:'finalized', mint,
      signature:'funding-signature', amount:'123127', balanceDeltaVerified:true } },
    v3XClaims:{ [source]:{ status:'paid', mint, wallet, xUserId:'123',
      amountLamports:'123127', fundingSignature:'funding-signature', payment } },
  };
  const rewards = { schedules:{ [`direct:x:${source}`]:{ kind:'x', sourceId:source,
    mint, asset:'SOL', fundingSignature:'funding-signature', status:'paid',
    manifest:{ totalAmount:'123127', leaves:[{ recipient:wallet, amount:'123127' }] },
    payments:{ [wallet]:payment } } } };
  const dependencies = { store:{ read:async () => state },
    automaticRewardStore:{ read:async () => rewards }, solanaCluster:'devnet',
    env:{ FUNDED_V3_X_CLAIMS_ENABLED:'true', FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,
      FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64) } };
  const verified = await call(createRewardStatusRoutes, dependencies, '/api/rewards/automatic');
  assert.equal(verified.data.routeReadiness.x.ready, true);
  assert.equal(verified.data.routeReadiness.x.verifiedV3Payments, 1);
  assert.equal(verified.data.modes.x, 'v3-x-payout-recorded');
  state.v3XClaims[source].payment = { ...payment, balanceDeltaVerified:false };
  const unverified = await call(createRewardStatusRoutes, dependencies, '/api/rewards/automatic');
  assert.equal(unverified.data.routeReadiness.x.ready, false);
  assert.equal(unverified.data.modes.x, 'unavailable');
});

test('X-linked V2 launch is retired before signed readiness or lookup', async () => {
  const creator = Keypair.generate();
  const router = Keypair.generate().publicKey.toBase58();
  const policy = {
    chain:'solana', cluster:'devnet', mint:Keypair.generate().publicKey.toBase58(),
    signature:'4bz6vBafFbHSwwnJRTd5Ju9QB9mQvFTsqkhDVHjhXZcQZGfnyqh1UDEW2uWqzRYMeTqUdcJXmbLDUyn3fk5FFoKr',
    creatorWallet:creator.publicKey.toBase58(), communityAllocation:50, xUserId:'123',
    pumpFeeRoute:{ router, scope:'per-mint-v2', transaction:'4bz6vBafFbHSwwnJRTd5Ju9QB9mQvFTsqkhDVHjhXZcQZGfnyqh1UDEW2uWqzRYMeTqUdcJXmbLDUyn3fk5FFoKr' },
    feeDistribution:buildFeeDistributionPolicy({ creatorWalletPercent:60, holderAirdropPercent:10,
      solClaimPercent:10, xRecipient:'@fixture', feeRouterAddress:router }),
  };
  policy.policySignature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(launchPolicyStatement(policy)), creator.secretKey));
  let checkedSigned = false, lookedUp = false;
  const handle = createLaunchRegistrationRoutes({ solanaCluster:'devnet', body:async () => policy,
    store:{ readLaunch:async () => null, read:async () => ({ creatorProfiles:{} }) },
    xFeeReadiness:async options => { checkedSigned = options?.creatorSigned === true; return { ready:checkedSigned }; },
    resolveXUser:async () => { lookedUp = true; },
    respond:(_res, status, data) => { assert.equal(status, 410); assert.match(data.error, /V2 launch registration is retired/); },
  });
  await handle({ method:'POST' }, {}, new URL('/api/launches', 'https://funded.vip'));
  assert.equal(checkedSigned, false);
  assert.equal(lookedUp, false);
});
