import test from 'node:test';
import assert from 'node:assert/strict';
import { rewardExperience } from '../server/reward-experience.mjs';

const mint = 'A'.repeat(32);
const wallet = 'B'.repeat(32);
const holder = 'C'.repeat(32);
const router = 'D'.repeat(32);
const claim = 'E'.repeat(64);
const payment = 'F'.repeat(64);
const burn = 'G'.repeat(64);
const launch = { mint, cluster:'devnet', onchainVerified:true, creator:router, creatorWallet:wallet,
  name:'Example', symbol:'EX', pumpFeeRoute:{ scope:'per-mint-v2', router },
  feeDistribution:{ creatorDirected:{ shares:{ holderAirdropPercent:20 } } } };
const state = { launches:{ [mint]:launch }, collections:{ [claim]:{ mint, cluster:'devnet', status:'collected',
  onchainVerified:true, attribution:'mint-verified', signature:claim, collectedLamports:100_000_000, recordedAt:'2026-10-01T00:00:00Z' } },
  settlements:{ [claim]:{ claimSignature:claim, asset:'SOL', grossCreatorFees:0.1,
    creatorDestinations:{ creatorWallet:0.06, holderAirdrop:0.02, solClaim:0 },
    fundedApp:{ communityBase:0.002, missingReferralToCommunity:0, community:0.002, buyback:0.001, referralLevels:[] } } },
  buybackOrders:{ one:{ mint, status:'finalized', refundVerified:true, signature:burn,
    boughtAndBurnedBaseUnits:'500', supplyBefore:'10000', supplyAfter:'9500', settledLamports:'1000000' } } };
const rewards = { schedules:{ one:{ mint, kind:'holder', asset:'SOL', manifest:{ leaves:[{ recipient:holder, amount:'20000000' }] },
  payments:{ [holder]:{ status:'paid', amount:'20000000', signature:payment, finalized:true,
    balanceDeltaVerified:true, paidAt:'2026-10-01T01:00:00Z' } } } } };
const evidence = { cluster:'devnet', commitment:'finalized', status:'onchain-indexed',
  verifiedCollections:[{ signature:claim, mint, collectedLamports:100_000_000 }], verifiedPayouts:[] };

test('verified collection, allocation, holder payment, and burn stay distinct', () => {
  const result = rewardExperience(state, rewards, evidence, 'devnet', holder);
  assert.equal(result.tokens.length, 1);
  assert.equal(result.tokens[0].totals.collected, '100000000');
  assert.equal(result.tokens[0].totals.holder, '20000000');
  assert.equal(result.tokens[0].holderPaidWallets, 1);
  assert.equal(result.tokens[0].buybackBurnedBaseUnits, '500');
  assert.equal(result.tokens[0].payoutSource, 'finalized-cycle-source-not-attributed-to-fee-claim');
  assert.equal(result.wallet.rows[0].payouts[0].feeSourceVerified, false);
  assert.equal(result.community.paidLamports, null);
});

test('community total includes redirected referrals exactly once', () => {
  const withMissingReferral = structuredClone(state);
  withMissingReferral.settlements[claim].fundedApp.referralLevels = [
    { level:1, recipient:null, amount:0.001 },
  ];
  withMissingReferral.settlements[claim].fundedApp.community = 0.003;
  withMissingReferral.settlements[claim].fundedApp.missingReferralToCommunity = 0.001;
  const result = rewardExperience(withMissingReferral, rewards, evidence, 'devnet');
  assert.equal(result.tokens[0].totals.community, '3000000');
  assert.equal(result.community.allocatedLamports, '3000000');
  assert.equal(result.community.baseAllocatedLamports, '2000000');
  assert.equal(result.community.referralRolloverLamports, '1000000');
  assert.equal(result.community.status, 'reserved-for-future-programs-no-payout-policy');
});

test('unverified collections and unmatched payment leaves cannot become proof', () => {
  const unverified = rewardExperience(state, { schedules:{ one:{ ...rewards.schedules.one,
    manifest:{ leaves:[{ recipient:holder, amount:'1' }] } } } },
  { ...evidence, verifiedCollections:[] }, 'devnet', holder);
  assert.equal(unverified.tokens[0].totals.collected, '0');
  assert.equal(unverified.tokens[0].totals.allocated, '0');
  assert.equal(unverified.tokens[0].holderPaidWallets, 0);
  assert.equal(unverified.wallet.rows.length, 0);
});

test('wallet and mint input are validated', () => {
  assert.throws(() => rewardExperience(state, rewards, evidence, 'devnet', 'not a wallet'), /valid Solana wallet/);
  assert.throws(() => rewardExperience(state, rewards, evidence, 'devnet', null, 'not a mint'), /valid Solana mint/);
});

test('token-denominated community distributions do not appear as SOL payments', () => {
  const community = { mint, kind:'community', asset:'TOKEN', manifest:{ leaves:[{ recipient:holder, amount:'500000000' }] },
    payments:{ [holder]:{ status:'paid', amount:'500000000', signature:payment, finalized:true,
      balanceDeltaVerified:true } } };
  const result = rewardExperience(state, { schedules:{ token:community } }, evidence, 'devnet', holder);
  assert.equal(result.wallet.rows.length, 0);
  assert.equal(result.tokens[0].holderPayoutCount, 0);
});

test('holder payout is fee-funded only with a matching verified collection and funded pool', () => {
  const linked = structuredClone(rewards);
  linked.schedules.one.poolIds = [`${claim}:holders`];
  linked.rewardPools = { [`${claim}:holders`]:{ mint, asset:'SOL', amount:'20000000',
    fundingSignature:burn, balanceDeltaVerified:true } };
  linked.fundingRequests = { [`${claim}:holders`]:{ mint, asset:'SOL', amount:'20000000',
    sourceSignature:claim, fundingSignature:burn, status:'funded', balanceDeltaVerified:true } };
  const confirmed = rewardExperience(state, linked, evidence, 'devnet', holder);
  assert.equal(confirmed.tokens[0].payoutSource, 'verified-fee-funded-cycle');
  assert.deepEqual(confirmed.wallet.rows[0].payouts[0].sourceClaims, [claim]);
  linked.rewardPools[`${claim}:holders`].fundingSignature = payment;
  const mismatched = rewardExperience(state, linked, evidence, 'devnet', holder);
  assert.equal(mismatched.wallet.rows[0].payouts[0].feeSourceVerified, false);
});
