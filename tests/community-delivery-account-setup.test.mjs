import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { createCommunityDeliveryRuntime } from '../server/community-delivery-runtime.mjs';
import { PROTECTED_V3_PROGRAM_DATA_SHA256 } from '../server/v3-launch-config.mjs';

const programId = '9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';
const authority = Keypair.generate(), mint = Keypair.generate().publicKey.toBase58();

test('delivery worker builds the claim service with the configured community account setup', async () => {
  const launch = { mint, cluster:'devnet', onchainVerified:true, creatorWallet:Keypair.generate().publicKey.toBase58(),
    communityAirdrop:{ reservedTokens:30000000 },
    pumpFeeRoute:{ scope:'per-mint-v3', verified:true, programId, initialAuthority:authority.publicKey.toBase58() } };
  const memory = { communityDrops:{ [mint]:{ mint, snapshotBasis:'pump-migration', openingSignature:null } } };
  const store = { read:async () => ({ launches:{ [mint]:launch } }) };
  const automaticRewardStore = { read:async () => memory, transaction:async fn => fn(memory) };
  const seen = [];
  const runtime = createCommunityDeliveryRuntime({ store, automaticRewardStore, solanaCluster:'devnet', fundedTokenMint:mint,
    v3AuthorityKeypair:() => authority, connection:{}, logger:{ error() {} },
    env:{ SOLANA_CLUSTER:'devnet', FUNDED_COMMUNITY_AUTO_DELIVERY_ENABLED:'true', FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,
      FUNDED_V3_PROGRAM_DATA_SHA256:PROTECTED_V3_PROGRAM_DATA_SHA256, FUNDED_V3_COMMUNITY_ACCOUNT_SETUP:'app' },
    serviceFactory:options => { seen.push(options); return { prepared:async () => memory.communityDrops[mint] }; },
    deliveryFactory:() => ({ open:async () => ({ status:'verification-pending' }) }) });
  await runtime.tick();
  assert.equal(memory.communityDeliveryStatus?.failures?.length, 0, JSON.stringify(memory.communityDeliveryStatus));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].accountSetup, 'app');
});
