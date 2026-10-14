import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair, Transaction } from '@solana/web3.js';
import { deriveMintRouterV3 } from '../mint-router-v3.js';
import { createV3CreatorSettlementRoutes } from '../server/routes/v3-creator-settlement.mjs';

const key = byte => Keypair.fromSeed(new Uint8Array(32).fill(byte));
const creator = key(21), authority = key(22), program = key(23), mint = key(24);
const collectionSignature = '1'.repeat(64);
const claimId = Buffer.alloc(32, 8);
const router = deriveMintRouterV3(program.publicKey, mint.publicKey).address.toBase58();
const path = `/api/tokens/${mint.publicKey.toBase58()}/v3-settlement/${collectionSignature}`;

function fixture({ enabled = true, submit = null } = {}) {
  const responses = [];
  const state = { collections:{ [collectionSignature]:{
    signature:collectionSignature, mint:mint.publicKey.toBase58(),
    scope:'per-mint-v3', cluster:'devnet', status:'collected', onchainVerified:true,
    attribution:'mint-verified', programId:program.publicKey.toBase58(), router,
    collectedLamports:30, claimId:claimId.toString('hex'),
  } }, launches:{ [mint.publicKey.toBase58()]:{
    mint:mint.publicKey.toBase58(), onchainVerified:true, cluster:'devnet',
    creatorWallet:creator.publicKey.toBase58(), pumpFeeRoute:{ scope:'per-mint-v3',
      programId:program.publicKey.toBase58(), router,
      initialAuthority:authority.publicKey.toBase58() },
    feeDistribution:{ creatorDirected:{ shares:{ creatorWalletPercent:60,
      holderAirdropPercent:15, solClaimPercent:5 }, recipients:{ xAccount:'@qa' } } },
    xUserId:'12345',
  } }, v3Settlements:{}, referrals:{ attributions:{} } };
  let submitted = 0;
  let finalized = false;
  const handle = createV3CreatorSettlementRoutes({
    body:async req => req.input, store:{ read:async () => state, update:async fn => fn(state) },
    solanaCluster:'devnet', solanaRpcUrl:'https://unused.invalid',
    v3AuthorityKeypair:() => authority,
    env:{ FUNDED_V3_SETTLEMENT_ENABLED:enabled ? 'true' : 'false',
      FUNDED_V3_FEE_ROUTER_PROGRAM_ID:program.publicKey.toBase58(),
      FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64) },
    connectionFactory:() => ({ getLatestBlockhash:async () => ({
      blockhash:key(25).publicKey.toBase58(), lastValidBlockHeight:123 }) }),
    verifyReadiness:async () => ({ ready:true, configuredRouter:router }),
    loadCollection:async () => ({ signature:collectionSignature, router,
      expectedLamports:30n, claimId }),
    loadSettlement:async ({ signature }) => finalized ? {
      signature, mint:mint.publicKey.toBase58(), router,
      claimId:claimId.toString('hex'), expectedLamports:'30',
      categoryLamports:['24','3','1','1','0','1','0'], slot:42,
      blockTime:1_700_000_000,
    } : null,
    submitTransaction:async ({ transaction }) => {
      submitted++;
      if (submit) return submit(transaction);
      finalized = true;
      return bs58.encode(transaction.signature);
    },
    originAllowed:() => true,
    respond:(_res,status,data) => responses.push({status,data}),
  });
  return { state, responses, get submitted(){return submitted;},
    setFinalized:value => { finalized=value; },
    request:input => handle({ method:'POST', input, headers:{} }, {}, new URL(path,'https://funded.vip')) };
}

function signPrepared(base64) {
  const tx = Transaction.from(Buffer.from(base64,'base64'));
  tx.partialSign(creator);
  return tx.serialize({ requireAllSignatures:false, verifySignatures:false }).toString('base64');
}

test('V3 settlement stays disabled by default', async () => {
  const f = fixture({ enabled:false });
  await f.request({});
  assert.equal(f.responses[0].status, 503);
  assert.deepEqual(f.state.v3Settlements, {});
});

test('creator signs the exact V3 settlement and finalized proof closes the collection', async () => {
  const f = fixture();
  await f.request({});
  assert.equal(f.responses[0].status, 202);
  assert.equal(f.responses[0].data.amountLamports, '30');
  await assert.rejects(f.request({ creatorSignedTransaction:f.responses[0].data.transaction }),
    /launch creator has not signed/);
  assert.deepEqual(f.state.v3Settlements, {});
  await f.request({ creatorSignedTransaction:signPrepared(f.responses[0].data.transaction) });
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.state.v3Settlements[collectionSignature].status, 'finalized');
  assert.deepEqual(f.state.v3Settlements[collectionSignature].allocationPlan.creatorDirected,
    { walletLamports:'18', holderLamports:'4', xLamports:'2', xUserId:'12345', xHandle:'@qa' });
  assert.equal(f.submitted, 1);
  await f.request({});
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.submitted, 1);
});

test('V3 settlement freezes the referral upline at the first qualified fee event', async () => {
  const f = fixture();
  const inviter = key(26).publicKey.toBase58();
  f.state.referrals.attributions[creator.publicKey.toBase58()] = {
    wallet:creator.publicKey.toBase58(), inviterWallet:inviter,
    lock:'first-touch', capturedAt:new Date(1_699_999_999_000).toISOString() };
  await f.request({});
  await f.request({ creatorSignedTransaction:signPrepared(f.responses[0].data.transaction) });
  assert.deepEqual(f.state.v3Settlements[collectionSignature].referralUpline, [inviter]);
  f.state.referrals.attributions[creator.publicKey.toBase58()].inviterWallet = key(27).publicKey.toBase58();
  await f.request({});
  assert.deepEqual(f.responses.at(-1).data.referralUpline, [inviter]);
});

test('uncertain V3 submission remains pending and recovers from finalized proof without rebroadcast', async () => {
  const f = fixture({ submit:() => { throw new Error('RPC outcome unknown'); } });
  await f.request({});
  await assert.rejects(f.request({ creatorSignedTransaction:signPrepared(f.responses[0].data.transaction) }),
    /RPC outcome unknown/);
  assert.equal(f.state.v3Settlements[collectionSignature].status, 'verification-pending');
  assert.equal(f.submitted, 1);
  f.setFinalized(true);
  await f.request({});
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.state.v3Settlements[collectionSignature].status, 'finalized');
  assert.equal(f.submitted, 1);
});

test('finalized V3 settlement is recorded while malformed local payout policy remains blocked', async () => {
  const f = fixture();
  await f.request({});
  f.state.launches[mint.publicKey.toBase58()].feeDistribution = null;
  await f.request({ creatorSignedTransaction:signPrepared(f.responses[0].data.transaction) });
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.state.v3Settlements[collectionSignature].status, 'finalized');
  assert.deepEqual(f.state.v3Settlements[collectionSignature].allocationPlan,
    { status:'blocked', reason:'signed-policy-allocation-unavailable', reconciliationRequired:true });
});
