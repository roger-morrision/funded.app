import test from 'node:test';
import assert from 'node:assert/strict';
import { recordedV3AllocationPlan, v3AllocationPlan } from '../server/v3-allocation-plan.mjs';

const launch = { mint:'qa-mint', onchainVerified:true, cluster:'devnet', xUserId:'12345',
  pumpFeeRoute:{ scope:'per-mint-v3', programId:'qa-program' },
  feeDistribution:{ creatorDirected:{ shares:{ creatorWalletPercent:60,
    holderAirdropPercent:15, solClaimPercent:5 }, recipients:{ xAccount:'@qa' } } } };
const settlement = { mint:'qa-mint', programId:'qa-program', expectedLamports:'10000001',
  collectionSignature:'collection', settlementSignature:'settlement',
  categoryLamports:['8000000','1000000','200000','60000','40000','200000','500001'] };

test('V3 payout plan preserves exact on-chain category totals and creator split dust', () => {
  const plan = v3AllocationPlan({ launch, settlement });
  assert.equal(plan.status, 'allocated-not-funded');
  assert.deepEqual(plan.creatorDirected, { walletLamports:'6000000', holderLamports:'1500000',
    xLamports:'500000', xUserId:'12345', xHandle:'@qa' });
  assert.equal(plan.protocol.buybackLamports, '500001');
  assert.equal(plan.protocol.referralLamports.join(','), '200000,60000,40000');
});

test('V3 payout plan rejects forged totals, missing X identity, and mismatched program', () => {
  assert.throws(() => v3AllocationPlan({ launch, settlement:{ ...settlement,
    categoryLamports:settlement.categoryLamports.map((value, index) => index === 0 ? '7999999' : value) } }), /do not reconcile/);
  assert.throws(() => v3AllocationPlan({ launch:{ ...launch, xUserId:null }, settlement }), /X identity/);
  assert.throws(() => v3AllocationPlan({ launch, settlement:{ ...settlement, programId:'other' } }), /matching verified/);
});

test('finalized V3 proof stays recorded but payouts remain blocked for a damaged launch policy', () => {
  assert.deepEqual(recordedV3AllocationPlan({ launch:{ ...launch, feeDistribution:null }, settlement }),
    { status:'blocked', reason:'signed-policy-allocation-unavailable', reconciliationRequired:true });
});
