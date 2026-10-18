import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { createV3LaunchConfig, PROTECTED_V3_PROGRAM_DATA_SHA256,
  V3_BENEFICIARY_RELEASE_BLOCKER } from '../server/v3-launch-config.mjs';
import { createLaunchRegistrationRoutes } from '../server/routes/launch-registration.mjs';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';

test('V3 new launches stay closed for old program bytes even when every operator switch is enabled', async () => {
  let networkCalls = 0;
  const config = createV3LaunchConfig({
    solanaCluster:'devnet', solanaRpcUrl:'https://example.invalid',
    automaticRewardStore:{ read:async () => ({ serviceStatus:{ constrainedPayouts:true,
      checkedAt:new Date().toISOString(), reasons:[] } }) },
    v3AuthorityKeypair:() => Keypair.generate(),
    env:{ FUNDED_V3_LAUNCH_ENABLED:'true', FUNDED_V3_COLLECTION_ENABLED:'true',
      FUNDED_V3_SETTLEMENT_ENABLED:'true', FUNDED_V3_HOLDER_WORKER_ENABLED:'true',
      FUNDED_V3_BUYBACK_ENABLED:'true',
      FUNDED_V3_FEE_ROUTER_PROGRAM_ID:Keypair.generate().publicKey.toBase58(),
      FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64),
      FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE:Keypair.generate().publicKey.toBase58(),
      FUNDED_V3_BUYBACK_LOOKUP_TABLE:Keypair.generate().publicKey.toBase58() },
    connectionFactory:() => { networkCalls++; throw new Error('No network needed while blocked'); },
  });
  const result = await config();
  assert.equal(result.ready, false);
  assert.equal(result.beneficiaryRoutingOnChainEnforced, false);
  assert.ok(result.reasons.includes(V3_BENEFICIARY_RELEASE_BLOCKER));
  assert.equal(networkCalls, 0);
});

test('exact protected ProgramData and current Devnet router permit launch readiness', async () => {
  const authority = Keypair.generate();
  const program = Keypair.generate().publicKey.toBase58();
  const lookup = Keypair.generate().publicKey.toBase58();
  const config = createV3LaunchConfig({
    solanaCluster:'devnet', solanaRpcUrl:'https://example.invalid',
    automaticRewardStore:{ read:async () => ({ serviceStatus:{ constrainedPayouts:true,
      checkedAt:new Date().toISOString(), reasons:[] } }) },
    v3AuthorityKeypair:() => authority,
    env:{ FUNDED_V3_LAUNCH_ENABLED:'true', FUNDED_V3_COLLECTION_ENABLED:'true',
      FUNDED_V3_SETTLEMENT_ENABLED:'true', FUNDED_V3_HOLDER_WORKER_ENABLED:'true',
      FUNDED_V3_BUYBACK_ENABLED:'true', FUNDED_V3_FEE_ROUTER_PROGRAM_ID:program,
      FUNDED_V3_PROGRAM_DATA_SHA256:PROTECTED_V3_PROGRAM_DATA_SHA256,
      FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE:lookup, FUNDED_V3_BUYBACK_LOOKUP_TABLE:lookup },
    connectionFactory:() => ({
      getGenesisHash:async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      getAddressLookupTable:async () => ({ value:{ state:{
        deactivationSlot:BigInt('18446744073709551615') } } }),
    }),
    programEvidence:async () => ({ account:{ executable:true },
      sha256:PROTECTED_V3_PROGRAM_DATA_SHA256 }),
    verifyRouter:async () => ({ verified:true, authority:authority.publicKey }),
  });
  const result = await config();
  assert.equal(result.ready, true);
  assert.equal(result.beneficiaryRoutingOnChainEnforced, true);
  assert.deepEqual(result.reasons, []);
});

test('launch reserve route rejects a ready flag without beneficiary enforcement', async () => {
  let response;
  const handler = createLaunchRegistrationRoutes({
    solanaCluster:'devnet', solanaRpcUrl:'https://example.invalid',
    automaticRewardStore:{}, v3AuthorityKeypair:() => Keypair.generate(),
    env:{ FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE:Keypair.generate().publicKey.toBase58() },
    v3LaunchConfig:async () => ({ ready:true, reasons:[],
      programId:Keypair.generate().publicKey.toBase58() }),
    respond:(_res, status, data) => { response = { status, data }; },
  });
  await handler({ method:'GET' }, {}, new URL('https://funded.vip/api/launch-reserve-config'));
  assert.equal(response.status, 503);
});

test('registration rejects a complete V3 request before launch verification', async () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  let response;
  const handler = createLaunchRegistrationRoutes({
    solanaCluster:'devnet', solanaRpcUrl:'https://example.invalid',
    automaticRewardStore:{}, v3AuthorityKeypair:() => Keypair.generate(),
    body:async req => req.input,
    store:{ readLaunch:async () => null },
    v3LaunchConfig:async () => ({ ready:true, reasons:[], programId:wallet }),
    respond:(_res, status, data) => { response = { status, data }; },
  });
  await handler({ method:'POST', input:{ mint, chain:'solana', cluster:'devnet',
    creatorWallet:wallet, communityAllocation:3, signature:'qa-signature',
    feeDistribution:{ creatorDirected:{ shares:{ creatorWalletPercent:80,
      holderAirdropPercent:0, solClaimPercent:0 } } },
    pumpFeeRoute:{ scope:'per-mint-v3', programId:wallet,
      initialAuthority:wallet, router:wallet, protocolSplit:PROTOCOL_FEE_SPLIT } },
  }, {}, new URL('https://funded.vip/api/launches'));
  assert.equal(response.status, 503);
  assert.match(response.data.error, /not ready to accept a new launch/);
});
