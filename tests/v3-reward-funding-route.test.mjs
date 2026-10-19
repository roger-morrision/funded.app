import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair, Transaction } from '@solana/web3.js';
import { deriveCommunityRewardVaultV3, deriveMintRouterV3 } from '../mint-router-v3.js';
import { v3AllocationPlan } from '../server/v3-allocation-plan.mjs';
import { AUTOMATIC_REWARDS } from '../automatic-rewards.js';
import { createV3RewardFundingRoutes } from '../server/routes/v3-reward-funding.mjs';
import {bonusHash} from '../server/daily-bonus.mjs';
import {residualSourceKey} from '../server/v3-residual-source.mjs';

const key = byte => Keypair.fromSeed(new Uint8Array(32).fill(byte));
const creator = key(31), authority = key(32), program = key(33), mint = key(34);
const collectionSignature = '1'.repeat(64);
const settlementSignature = '2'.repeat(64);
const claimId = Buffer.alloc(32, 8);
const router = deriveMintRouterV3(program.publicKey, mint.publicKey).address.toBase58();

function fixture({ enabled = true, submit = null, kind = 'community', qaShort = false,
  protectedPolicy = false, residual = false,
  recipientBalance = 1_000_000,
  existingProgram = null } = {}) {
  const suffix = ['creator-wallet', 'referral', 'operations'].includes(kind) ? 'payout' : 'funding';
  const path = `/api/tokens/${mint.publicKey.toBase58()}/v3-${kind}-${suffix}/${collectionSignature}${kind === 'referral' ? '/1' : ''}`;
  const responses = [];
  const launch = { mint:mint.publicKey.toBase58(), onchainVerified:true, cluster:'devnet',
    createdTimestamp:1_700_000_000,
    creatorWallet:creator.publicKey.toBase58(), pumpFeeRoute:{ scope:'per-mint-v3',
      programId:program.publicKey.toBase58(), router,
      initialAuthority:authority.publicKey.toBase58() },
    feeDistribution:{ creatorDirected:{ shares:{ creatorWalletPercent:60,
      holderAirdropPercent:15, solClaimPercent:5 }, recipients:{ xAccount:'@qa' } } },
    xUserId:'12345' };
  const settlementProof = { signature:settlementSignature, mint:mint.publicKey.toBase58(),
    claimId:claimId.toString('hex'), expectedLamports:'100',
    position:{settledBeforeLamports:'0',settledAfterLamports:'100',policySettledLamports:'100',creatorPoolBeforeLamports:'0',creatorPoolAfterLamports:'80'},
    categoryLamports:['80','10','2','1','0','2','5'] };
  if(residual)Object.assign(settlementProof,{expectedLamports:'1000002',categoryLamports:['800002','80000','20000','6000','4000','40000','50000'],
    position:{settledBeforeLamports:'1000002',settledAfterLamports:'2000004',policySettledLamports:'2000004',creatorPoolBeforeLamports:'800001',creatorPoolAfterLamports:'1600003'}});
  const allocationPlan = v3AllocationPlan({ launch, settlement:{ ...settlementProof,position:residual?undefined:settlementProof.position,
    programId:program.publicKey.toBase58(), collectionSignature,
    settlementSignature } });
  const state = { launches:{ [launch.mint]:launch },
    collections:{ [collectionSignature]:{ signature:collectionSignature,
      mint:launch.mint, scope:'per-mint-v3', cluster:'devnet',
      status:'collected', onchainVerified:true, attribution:'mint-verified',
      programId:program.publicKey.toBase58(),
      router, claimId:claimId.toString('hex'), collectedLamports:100 } },
    v3Settlements:{ [collectionSignature]:{ status:'finalized', mint:launch.mint,
      collectionSignature, settlementSignature, allocationPlan } },
    v3CommunityFunding:{}, referrals:{ attributions:{} } };
  let auditSource,auditHash;
  if(residual){
    state.collections[collectionSignature].collectedLamports=1000002;
    const target=v3AllocationPlan({launch,settlement:{...settlementProof,programId:program.publicKey.toBase58(),collectionSignature,settlementSignature}});
    const originalWallet=allocationPlan.creatorDirected.walletLamports;
    state.v3CreatorWalletPayout={[collectionSignature]:{status:'finalized',signature:'old-wallet-receipt',amount:originalWallet}};
    auditSource={collectionSignature,settlementSignature,originalPlanHash:bonusHash(allocationPlan),target,
      releasedLamports:[originalWallet,'0','0'],unreleasedLamports:[String(BigInt(target.creatorDirected.walletLamports)-BigInt(originalWallet)),target.creatorDirected.holderLamports,target.creatorDirected.xLamports]};
    const frozen={version:1,status:'reviewed-residual-not-paid',mint:launch.mint,programId:program.publicKey.toBase58(),sources:[auditSource]};
    auditHash=bonusHash(frozen);state.v3AllocationResidualPlans={[auditHash]:{plan:{...frozen,hash:auditHash},actor:'qa-admin',approvedAt:'2026-10-19T00:00:00Z'}};
  }
  let submitted = 0;
  const holderPools = new Map();
  const rewardState = { programs:existingProgram ? { [launch.mint]:existingProgram } : {} };
  const registrations = [];
  let finalized = false;
  const vault = deriveCommunityRewardVaultV3(program.publicKey, mint.publicKey, authority.publicKey);
  const handle = createV3RewardFundingRoutes({
    body:async req => req.input, store:{ read:async () => state, update:async fn => fn(state) },
    solanaCluster:'devnet', solanaRpcUrl:'https://unused.invalid',
    v3AuthorityKeypair:() => authority,
    rewardStore:{ read:async () => rewardState },
    schedulerFactory:() => ({
      register:async input => { registrations.push(input); rewardState.programs[input.mint] = input; },
      recordFundedPool:async input => {
        const prior = holderPools.get(input.id);
        if (prior) assert.deepEqual(input, prior);
        holderPools.set(input.id, input);
      },
    }),
    env:{ FUNDED_V3_COMMUNITY_FUNDING_ENABLED:enabled ? 'true' : 'false',
      FUNDED_V3_CREATOR_REWARD_FUNDING_ENABLED:enabled ? 'true' : 'false',
      FUNDED_V3_CREATOR_WALLET_PAYOUT_ENABLED:enabled ? 'true' : 'false',
      FUNDED_V3_REFERRAL_PAYOUT_ENABLED:enabled ? 'true' : 'false',
      FUNDED_V3_OPERATIONS_PAYOUT_ENABLED:enabled ? 'true' : 'false',
      FUNDED_V3_OPERATIONS_RECIPIENT:key(40).publicKey.toBase58(),
      FUNDED_QA_SHORT_REWARD_PERIODS:qaShort ? 'true' : 'false',
      FUNDED_QA_HOLDER_MINT:qaShort ? launch.mint : '',
      FUNDED_QA_HOLDER_MIN_LAMPORTS:qaShort ? '100000' : '',
      FUNDED_V3_FEE_ROUTER_PROGRAM_ID:program.publicKey.toBase58(),
      FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64) },
    connectionFactory:() => ({ getBalance:async () => recipientBalance,
      getMinimumBalanceForRentExemption:async () => 890_880,
      getLatestBlockhash:async () => ({
      blockhash:key(35).publicKey.toBase58(), lastValidBlockHeight:123 }) }),
    verifyReadiness:async () => ({ ready:true, configuredRouter:router, protectedPolicy }),
    rewardChainFactory:() => ({ readiness:async () => ({ constrainedPayouts:true }),
      ensureVault:async () => vault }),
    loadSettlement:async () => settlementProof,
    reviewResiduals:async()=>({sources:[auditSource]}),
    loadFunding:async ({ signature, amount, recipient }) => finalized ? { signature,
      mint:launch.mint, amount:String(amount), recipient:recipient.toBase58(),
      balanceDeltaVerified:true } : null,
    submitTransaction:async ({ transaction }) => {
      submitted++;
      if (submit) return submit(transaction);
      finalized = true;
      return bs58.encode(transaction.signature);
    },
    originAllowed:() => true,
    respond:(_res,status,data) => responses.push({ status,data }),
  });
  return { state, responses, holderPools, registrations, auditHash, auditSource,get submitted(){return submitted;},
    setFinalized:value => { finalized=value; },
    request:input => handle({ method:'POST', input, headers:{} }, {}, new URL(path,'https://funded.vip')) };
}

function signPrepared(base64) {
  const tx = Transaction.from(Buffer.from(base64, 'base64'));
  tx.partialSign(creator);
  return tx.serialize({ requireAllSignatures:false, verifySignatures:false }).toString('base64');
}

test('audited one-lamport wallet residual uses a new withdrawal and ledger identity without rewriting the paid receipt',async()=>{
  const f=fixture({kind:'creator-wallet',protectedPolicy:true,residual:true});
  const original=structuredClone(f.state.v3CreatorWalletPayout[collectionSignature]);
  const originalAllocation=structuredClone(f.state.v3Settlements[collectionSignature].allocationPlan);
  await f.request({residualPlanHash:f.auditHash});
  assert.equal(f.responses.at(-1).status,202);assert.equal(f.responses.at(-1).data.amountLamports,'1');
  const creatorSignedTransaction=signPrepared(f.responses.at(-1).data.transaction);
  await f.request({residualPlanHash:f.auditHash,creatorSignedTransaction});
  assert.equal(f.responses.at(-1).status,200);assert.equal(f.submitted,1);
  const key=residualSourceKey(collectionSignature,f.auditHash);
  assert.equal(f.state.v3CreatorWalletPayout[key].amount,'1');
  assert.equal(f.state.v3CreatorWalletPayout[key].residualPlanHash,f.auditHash);
  assert.deepEqual(f.state.v3CreatorWalletPayout[collectionSignature],original);
  assert.deepEqual(f.state.v3Settlements[collectionSignature].allocationPlan,originalAllocation);
  await f.request({residualPlanHash:f.auditHash});assert.equal(f.responses.at(-1).status,200);assert.equal(f.submitted,1);
});

test('audited holder/X residual funding enrolls a separate holder pool and preserves the original used plan',async()=>{
  const f=fixture({kind:'creator-reward',protectedPolicy:true,residual:true});
  const original=structuredClone(f.state.v3Settlements[collectionSignature].allocationPlan);
  await f.request({residualPlanHash:f.auditHash});assert.equal(f.responses.at(-1).status,202);
  assert.equal(f.responses.at(-1).data.amountLamports,'200000');
  await f.request({residualPlanHash:f.auditHash,creatorSignedTransaction:signPrepared(f.responses.at(-1).data.transaction)});
  assert.equal(f.responses.at(-1).status,200);
  const key=residualSourceKey(collectionSignature,f.auditHash),pool=f.holderPools.get(`v3:${key}`);
  assert.equal(pool.amount,'150000');assert.equal(f.state.v3CreatorRewardFunding[key].amount,'200000');
  assert.equal(f.state.v3CreatorRewardFunding[collectionSignature],undefined);
  assert.deepEqual(f.state.v3Settlements[collectionSignature].allocationPlan,original);
  await f.request({residualPlanHash:f.auditHash});assert.equal(f.submitted,1);assert.equal(f.holderPools.size,1);
});

test('residual recovery does not resubmit an uncertain transfer and rejects an edited approval',async()=>{
  const f=fixture({kind:'creator-wallet',protectedPolicy:true,residual:true,submit:async()=>{throw new Error('QA ambiguous broadcast.');}});
  await f.request({residualPlanHash:f.auditHash});const encoded=signPrepared(f.responses.at(-1).data.transaction);
  await assert.rejects(f.request({residualPlanHash:f.auditHash,creatorSignedTransaction:encoded}),/ambiguous/);
  assert.equal(f.state.v3CreatorWalletPayout[residualSourceKey(collectionSignature,f.auditHash)].status,'verification-pending');
  f.setFinalized(true);await f.request({residualPlanHash:f.auditHash});
  assert.equal(f.responses.at(-1).status,200);assert.equal(f.submitted,1);
  f.state.v3AllocationResidualPlans[f.auditHash].plan.sources[0].unreleasedLamports[0]='999';
  await f.request({residualPlanHash:f.auditHash});assert.equal(f.responses.at(-1).status,409);assert.equal(f.submitted,1);
});

test('V3 community funding stays disabled by default', async () => {
  const f = fixture({ enabled:false });
  await f.request({});
  assert.equal(f.responses[0].status, 503);
  assert.deepEqual(f.state.v3CommunityFunding, {});
});

test('V3 referral payout binds the frozen inviter and records only finalized proof', async () => {
  const f = fixture({ kind:'referral' });
  const inviter = key(39).publicKey.toBase58();
  f.state.v3Settlements[collectionSignature].referralUpline = [inviter];
  await f.request({});
  assert.equal(f.responses.at(-1).status, 202);
  assert.equal(f.responses.at(-1).data.amountLamports, '2');
  assert.equal(f.responses.at(-1).data.recipient, inviter);
  await f.request({ creatorSignedTransaction:signPrepared(f.responses.at(-1).data.transaction) });
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.state.v3ReferralPayouts[`${collectionSignature}:1`].status, 'finalized');
  assert.equal(f.submitted, 1);
  await f.request({});
  assert.equal(f.submitted, 1);
});

test('protected referral payout prepares approval and release in one creator-signed transaction', async () => {
  const f = fixture({ kind:'referral', protectedPolicy:true });
  f.state.v3Settlements[collectionSignature].referralUpline = [key(39).publicKey.toBase58()];
  await f.request({});
  assert.equal(f.responses.at(-1).status, 202);
  const prepared = Transaction.from(Buffer.from(f.responses.at(-1).data.transaction, 'base64'));
  assert.equal(prepared.instructions.length, 2);
  await f.request({ creatorSignedTransaction:signPrepared(f.responses.at(-1).data.transaction) });
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.submitted, 1);
});

test('protected holder funding includes separate holder and X amounts', async () => {
  const f = fixture({ kind:'creator-reward', protectedPolicy:true });
  await f.request({});
  assert.equal(f.responses.at(-1).status, 202);
  const prepared = Transaction.from(Buffer.from(f.responses.at(-1).data.transaction, 'base64'));
  assert.equal(prepared.instructions.length, 1);
  const data = prepared.instructions[0].data;
  assert.equal(data.readBigUInt64LE(42), 20n);
  assert.equal(data.readBigUInt64LE(50), 15n);
});

test('protected operations funds stay in their vault until a named recipient is approved', async () => {
  const f = fixture({ kind:'operations', protectedPolicy:true });
  await f.request({});
  assert.equal(f.responses.at(-1).status, 202);
  assert.equal(f.responses.at(-1).data.amountLamports, '10');
  const prepared = Transaction.from(Buffer.from(f.responses.at(-1).data.transaction, 'base64'));
  assert.equal(prepared.instructions.length, 2);
  await f.request({ creatorSignedTransaction:signPrepared(f.responses.at(-1).data.transaction) });
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.state.v3OperationsPayout[collectionSignature].status, 'finalized');
});

test('V3 referral payout rejects an unsettled referral upline before preparing a transaction', async () => {
  const f = fixture({ kind:'referral' });
  await f.request({});
  assert.equal(f.responses.at(-1).status, 409);
  assert.deepEqual(f.state.v3ReferralPayouts, undefined);
});

test('V3 referral payout reports the rent top-up needed for a new recipient', async () => {
  const f = fixture({ kind:'referral', recipientBalance:0 });
  const inviter = key(39).publicKey.toBase58();
  f.state.v3Settlements[collectionSignature].referralUpline = [inviter];
  await f.request({});
  assert.equal(f.responses.at(-1).status, 409);
  assert.equal(f.responses.at(-1).data.minimumTopUpLamports, '890880');
  assert.equal(f.submitted, 0);
});

test('V3 community funding requires creator approval and finalized category transfer proof', async () => {
  const f = fixture();
  await f.request({});
  assert.equal(f.responses[0].status, 202);
  assert.equal(f.responses[0].data.amountLamports, '2');
  await assert.rejects(f.request({ creatorSignedTransaction:f.responses[0].data.transaction }),
    /launch creator has not signed/);
  assert.deepEqual(f.state.v3CommunityFunding, {});
  await f.request({ creatorSignedTransaction:signPrepared(f.responses[0].data.transaction) });
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.state.v3CommunityFunding[collectionSignature].status, 'finalized');
  assert.equal(f.submitted, 1);
  await f.request({});
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.submitted, 1);
});

test('V3 creator-directed holder and X funds use category zero and their exact combined amount', async () => {
  const f = fixture({ kind:'creator-reward' });
  await f.request({});
  assert.equal(f.responses[0].status, 202);
  assert.equal(f.responses[0].data.amountLamports, '20');
  await f.request({ creatorSignedTransaction:signPrepared(f.responses[0].data.transaction) });
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.state.v3CreatorRewardFunding[collectionSignature].amount, '20');
  assert.equal(f.state.v3CreatorRewardFunding[collectionSignature].status, 'finalized');
  assert.equal(f.holderPools.get(`v3:${collectionSignature}`).amount, '15');
  assert.deepEqual(f.registrations[0].excludedWallets, [deriveCommunityRewardVaultV3(
    program.publicKey, mint.publicKey, authority.publicKey).toBase58()]);
  await f.request({});
  assert.equal(f.holderPools.size, 1);
});

test('the selected Devnet QA holder mint can re-enroll a funded daily pool into a bounded short period', async () => {
  const f = fixture({ kind:'creator-reward', qaShort:true,
    existingProgram:{ mint:mint.publicKey.toBase58(), asset:'SOL',
      activatedAt:1_700_000_000, periodSeconds:AUTOMATIC_REWARDS.periodSeconds } });
  await f.request({});
  await f.request({ creatorSignedTransaction:signPrepared(f.responses[0].data.transaction) });
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.registrations.length, 1);
  assert.equal(f.registrations[0].periodSeconds, 300);
  assert.equal(f.registrations[0].sampleIntervalSeconds, 60);
  assert.equal(f.registrations[0].payoutDelaySeconds, 0);
  assert.equal(f.registrations[0].firstPeriodStart % 300, 0);
  assert.deepEqual(f.registrations[0].excludedWallets, [deriveCommunityRewardVaultV3(
    program.publicKey, mint.publicKey, authority.publicKey).toBase58()]);
  assert.equal(f.holderPools.get(`v3:${collectionSignature}`).amount, '15');
  await f.request({});
  assert.equal(f.registrations.length, 1);
  assert.equal(f.submitted, 1, 're-enrollment must not submit a second funding transaction');
});

test('V3 creator wallet payout releases only its exact category-zero share', async () => {
  const f = fixture({ kind:'creator-wallet' });
  await f.request({});
  assert.equal(f.responses[0].status, 202);
  assert.equal(f.responses[0].data.amountLamports, '60');
  assert.equal(f.responses[0].data.recipient, creator.publicKey.toBase58());
  await f.request({ creatorSignedTransaction:signPrepared(f.responses[0].data.transaction) });
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.state.v3CreatorWalletPayout[collectionSignature].amount, '60');
  assert.equal(f.state.v3CreatorWalletPayout[collectionSignature].status, 'finalized');
});

test('V3 community funding preserves uncertain submission for receipt recovery', async () => {
  const f = fixture({ submit:() => { throw new Error('RPC outcome unknown'); } });
  await f.request({});
  await assert.rejects(f.request({ creatorSignedTransaction:signPrepared(f.responses[0].data.transaction) }),
    /RPC outcome unknown/);
  assert.equal(f.state.v3CommunityFunding[collectionSignature].status, 'verification-pending');
  f.setFinalized(true);
  await f.request({});
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.submitted, 1);
});

test('V3 community funding rejects a changed local allocation plan', async () => {
  const f = fixture();
  f.state.v3Settlements[collectionSignature].allocationPlan.protocol.communityLamports = '3';
  await f.request({});
  assert.equal(f.responses[0].status, 409);
  assert.deepEqual(f.state.v3CommunityFunding, {});
});

test('V3 funding accepts equivalent saved allocation fields in storage order', async () => {
  const f = fixture();
  const plan = f.state.v3Settlements[collectionSignature].allocationPlan;
  f.state.v3Settlements[collectionSignature].allocationPlan = Object.fromEntries(
    Object.entries(plan).reverse());
  await f.request({});
  assert.equal(f.responses[0].status, 202);
});
