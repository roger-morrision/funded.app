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

test('public X status and handle lookup use the creator-approved payout route', async () => {
  const calls = [];
  const xFeeReadiness = async options => {
    calls.push(options);
    return { ready: options?.creatorSigned === true, reasons: options?.creatorSigned ? [] : ['unsigned payout unavailable'] };
  };
  const dependencies = { xFeeReadiness, clientKey: () => 'fixture',
    store: { chargeRpcRate: async () => true, read: async () => ({ creatorProfiles: {} }) },
    resolveXUser: async () => ({ id: '123', handle: '@fixture' }) };
  const status = await call(createXIdentityRoutes, dependencies, '/api/x-fee/status');
  assert.equal(status.status, 200);
  assert.equal(status.data.ready, true);
  const lookup = await call(createXIdentityRoutes, dependencies, '/api/x/resolve?handle=%40fixture');
  assert.equal(lookup.status, 200);
  assert.equal(lookup.data.id, '123');
  assert.deepEqual(calls, [{ creatorSigned:true }, { includeLookupHealth:false, creatorSigned:true }]);
});

test('reward status describes the signed X path without promising automatic payout', async () => {
  const response = await call(createRewardStatusRoutes, {
    xFeeReadiness: async options => ({ ready: options?.creatorSigned === true, reasons: [] }),
    automaticRewardStore: { read: async () => ({}) }, store: { read: async () => ({ buybackOrders: {} }) },
    solanaCluster: 'devnet',
  }, '/api/rewards/automatic');
  assert.equal(response.status, 200);
  assert.equal(response.data.routeReadiness.x.ready, true);
  assert.equal(response.data.modes.x, 'creator-approved-after-verified-X-wallet');
});

test('X-linked launch registration advances through signed readiness before lookup', async () => {
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
  let checkedSigned = false;
  const stopAfterLookup = new Error('X lookup reached');
  const handle = createLaunchRegistrationRoutes({ solanaCluster:'devnet', body:async () => policy,
    store:{ readLaunch:async () => null, read:async () => ({ creatorProfiles:{} }) },
    xFeeReadiness:async options => { checkedSigned = options?.creatorSigned === true; return { ready:checkedSigned }; },
    resolveXUser:async () => { throw stopAfterLookup; },
    respond:() => assert.fail('Signed readiness must advance to X lookup.'),
  });
  await assert.rejects(handle({ method:'POST' }, {}, new URL('/api/launches', 'https://funded.vip')), stopAfterLookup);
  assert.equal(checkedSigned, true);
});
