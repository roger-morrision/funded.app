import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { deriveCommunityRewardVaultV3, deriveMintRouterV3 } from '../mint-router-v3.js';
import { v3AllocationPlan } from '../server/v3-allocation-plan.mjs';
import { createV3XClaimRoutes } from '../server/routes/v3-x-claims.mjs';

const key = byte => Keypair.fromSeed(new Uint8Array(32).fill(byte));
const creator = key(41), authority = key(42), program = key(43), mint = key(44);
const wallet = key(45), otherWallet = key(46);
const collectionSignature = '3'.repeat(64);
const settlementSignature = '4'.repeat(64);
const fundingSignature = '5'.repeat(64);
const mintAddress = mint.publicKey.toBase58();
const vault = deriveCommunityRewardVaultV3(program.publicKey, mint.publicKey, authority.publicKey);

function fixture({ enabled = true, xUserId = '12345', proof = true,
  sessionUsername = 'qa' } = {}) {
  const launch = { mint:mintAddress, onchainVerified:true, cluster:'devnet',
    creatorWallet:creator.publicKey.toBase58(), xUserId,
    pumpFeeRoute:{ scope:'per-mint-v3', programId:program.publicKey.toBase58(),
      router:deriveMintRouterV3(program.publicKey, mint.publicKey).address.toBase58(),
      initialAuthority:authority.publicKey.toBase58() },
    feeDistribution:{ creatorDirected:{ shares:{ creatorWalletPercent:60,
      holderAirdropPercent:15, solClaimPercent:5 }, recipients:{ xAccount:'@qa' } } } };
  const settlement = { signature:settlementSignature, mint:mintAddress,
    claimId:Buffer.alloc(32, 9).toString('hex'), expectedLamports:'100',
    categoryLamports:['80','10','2','1','0','2','5'] };
  const allocationPlan = v3AllocationPlan({ launch, settlement:{ ...settlement,
    programId:program.publicKey.toBase58(), collectionSignature,
    settlementSignature } });
  const state = { launches:{ [mintAddress]:launch },
    collections:{ [collectionSignature]:{ signature:collectionSignature,
      mint:mintAddress, scope:'per-mint-v3', cluster:'devnet',
      status:'collected', onchainVerified:true, attribution:'mint-verified',
      programId:program.publicKey.toBase58(), claimId:settlement.claimId,
      collectedLamports:100 } },
    v3Settlements:{ [collectionSignature]:{ status:'finalized', mint:mintAddress,
      collectionSignature, settlementSignature, allocationPlan } },
    v3CreatorRewardFunding:{ [collectionSignature]:{ status:'finalized',
      signature:fundingSignature, mint:mintAddress, amount:'20',
      recipient:vault.toBase58(), finalizedAt:'2026-10-13T00:00:00Z' } },
    v3XClaims:{} };
  const rewards = { schedules:{} };
  const responses = [];
  let enrolled = 0, submitted = 0;
  const handle = createV3XClaimRoutes({
    body:async req => req.input, store:{ read:async () => state,
      update:async mutator => mutator(state) },
    rewardStore:{ read:async () => rewards },
    xSession:async () => ({ user:{ id:'12345', username:sessionUsername } }),
    walletSignature:signature => bs58.decode(signature),
    v3AuthorityKeypair:() => authority, solanaCluster:'devnet',
    solanaRpcUrl:'https://unused.invalid',
    env:{ FUNDED_V3_X_CLAIMS_ENABLED:enabled ? 'true' : 'false',
      FUNDED_V3_FEE_ROUTER_PROGRAM_ID:program.publicKey.toBase58(),
      FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64) },
    connectionFactory:() => ({}),
    rewardChainFactory:() => ({ readiness:async () => ({ constrainedPayouts:true }) }),
    loadSettlement:async () => settlement,
    loadFunding:async () => proof ? { signature:fundingSignature, amount:'20',
      balanceDeltaVerified:true } : null,
    schedulerFactory:() => ({
      recordDirectFunded:async input => {
        enrolled++;
        const row = { id:`direct:x:${collectionSignature}`, mint:input.mint,
          manifest:{ totalAmount:input.amount,
            leaves:[{ recipient:input.recipient }] } };
        rewards.schedules[row.id] ||= row;
        return row;
      },
      execute:async (_now, ids) => {
        submitted++;
        assert.deepEqual(ids, [`direct:x:${collectionSignature}`]);
        const row = rewards.schedules[ids[0]];
        row.status = 'paid';
        row.payments = { [wallet.publicKey.toBase58()]:{
          status:'paid', finalized:true, balanceDeltaVerified:true,
          amount:'5', signature:'finalized-qa-signature' } };
      },
    }),
    originAllowed:() => true,
    respond:(_res,status,data) => responses.push({ status,data }),
  });
  return { state, responses, get enrolled(){return enrolled;},
    get submitted(){return submitted;},
    request:(action,input = {}) => handle({ method:'POST', input, headers:{} }, {},
      new URL(`/api/tokens/${mintAddress}/v3-x-claim/${collectionSignature}/${action}`,
        'https://funded.vip')) };
}

test('V3 X claims stay closed without the explicit Devnet gate', async () => {
  const f = fixture({ enabled:false });
  await f.request('prepare', { wallet:wallet.publicKey.toBase58() });
  assert.equal(f.responses.at(-1).status, 503);
  assert.deepEqual(f.state.v3XClaims, {});
});

test('V3 X claim requires the original OAuth subject and finalized funding proof', async () => {
  for (const options of [{ xUserId:'67890' }, { proof:false }]) {
    const f = fixture(options);
    await f.request('prepare', { wallet:wallet.publicKey.toBase58() });
    assert.equal(f.responses.at(-1).status, 409);
    assert.deepEqual(f.state.v3XClaims, {});
  }
});

test('V3 X payout binds OAuth and a signed recipient wallet to one funded cycle', async () => {
  const f = fixture();
  await f.request('prepare', { wallet:wallet.publicKey.toBase58() });
  assert.equal(f.responses.at(-1).status, 200);
  const message = f.responses.at(-1).data.statement;
  assert.match(message, /funded.app V3 SOL reward/);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey));
  await f.request('verify', { wallet:wallet.publicKey.toBase58(), signature });
  assert.equal(f.responses.at(-1).status, 200);
  await f.request('execute');
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.state.v3XClaims[collectionSignature].status, 'paid');
  assert.equal(f.enrolled, 1);
  assert.equal(f.submitted, 1);
});

test('the immutable X user ID remains claimable after a handle change', async () => {
  const f = fixture({ sessionUsername:'renamed_qa' });
  await f.request('prepare', { wallet:wallet.publicKey.toBase58() });
  assert.equal(f.responses.at(-1).status, 200);
});

test('V3 X claim rejects a different wallet and an invalid signature', async () => {
  const f = fixture();
  await f.request('prepare', { wallet:wallet.publicKey.toBase58() });
  const message = f.responses.at(-1).data.statement;
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey));
  await f.request('verify', { wallet:otherWallet.publicKey.toBase58(), signature });
  assert.equal(f.responses.at(-1).status, 401);
  await f.request('verify', { wallet:wallet.publicKey.toBase58(), signature });
  await f.request('verify', { wallet:otherWallet.publicKey.toBase58(), signature });
  assert.equal(f.responses.at(-1).status, 409);
});

test('a malformed V3 X wallet signature returns a client error', async () => {
  const f = fixture();
  await f.request('prepare', { wallet:wallet.publicKey.toBase58() });
  await f.request('verify', { wallet:wallet.publicKey.toBase58(), signature:'not-base58!' });
  assert.equal(f.responses.at(-1).status, 400);
});
