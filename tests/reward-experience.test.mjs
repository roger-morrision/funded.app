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
  name:'Example', symbol:'EX', createdTimestamp:1790812800, pumpFeeRoute:{ scope:'per-mint-v2', router },
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
  assert.equal(result.tokens[0].createdTimestamp, 1790812800);
  assert.equal(result.tokens[0].totals.collected, '100000000');
  assert.equal(result.tokens[0].totals.holder, '20000000');
  assert.equal(result.tokens[0].holderPaidWallets, 1);
  assert.equal(result.tokens[0].holderPaidLamports, '20000000');
  assert.equal(result.tokens[0].xPaidWallets, 0);
  assert.equal(result.tokens[0].xPaidLamports, '0');
  assert.equal(result.tokens[0].buybackBurnedBaseUnits, '500');
  assert.equal(result.tokens[0].payoutSource, 'finalized-cycle-source-not-attributed-to-fee-claim');
  assert.equal(result.wallet.rows[0].payouts[0].feeSourceVerified, false);
  assert.equal(result.community.paidLamports, null);
});

test('X recipient totals count only finalized matching payout evidence', () => {
  const xPayment = 'J'.repeat(64);
  const missingEvidence = 'K'.repeat(64);
  const paidState = structuredClone(state);
  paidState.payouts = {
    verified:{ mint, source:'mint-router-settle-mint', to:wallet, signature:xPayment,
      amountLamports:'3000000', paidAt:'2026-10-01T02:00:00Z' },
    unmatched:{ mint, source:'mint-router-settle-mint', to:holder, signature:missingEvidence,
      amountLamports:'9000000' },
  };
  const paidEvidence = { ...evidence, verifiedPayouts:[{ signature:xPayment, to:wallet,
    source:'mint-router-settle-mint', amountLamports:3000000 }] };
  const result = rewardExperience(paidState, rewards, paidEvidence, 'devnet');
  assert.equal(result.tokens[0].xPaidWallets, 1);
  assert.equal(result.tokens[0].xPayoutCount, 1);
  assert.equal(result.tokens[0].xPaidLamports, '3000000');
  assert.equal(result.tokens[0].holderPaidLamports, '20000000');
});

test('direct finalized X and referral payments retain delivery proof without claiming unverified fee provenance', () => {
  for (const source of ['mint-router-settle-mint', 'solana-keeper-referral-claim']) {
    const direct = { launches:{ [mint]:launch }, collections:{}, payouts:{ paid:{
      mint, cluster:'devnet', source, status:'paid', from:router, to:wallet,
      signature:payment, amountLamports:15,
    } } };
    const proof = { ...evidence, status:'partial', verifiedCollections:[], verifiedPayouts:[{
      signature:payment, source, to:wallet, amountLamports:15, slot:1,
    }] };
    const result = rewardExperience(direct, {}, proof, 'devnet', wallet);
    const paid = result.wallet.rows[0].payouts[0];
    assert.equal(paid.amountLamports, '15');
    assert.equal(paid.source, 'finalized-matching-balance-delta');
    assert.equal(paid.feeSourceVerified, false);
    assert.deepEqual(paid.sourceClaims, []);
    assert.equal(result.events[0].kind, source === 'mint-router-settle-mint' ? 'x-paid' : 'referral-paid');
    assert.equal(result.events[0].feeSourceVerified, false);
    assert.deepEqual(result.events[0].sourceClaims, []);
    if (source === 'mint-router-settle-mint') assert.equal(result.tokens[0].xPaidLamports, '15');
  }
});

test('paid referral shows verified fee provenance only when collection, entitlement, and payout match', () => {
  const referralId = 'referral-claim-1';
  const payoutId = `referral:${referralId}`;
  const amountLamports = 2_000_000;
  const linked = structuredClone(state);
  linked.settlements[claim].fundedApp.referralLevels = [
    { level:1, recipient:holder, amount:0.002, status:'claimable' },
  ];
  linked.referralClaims = { [referralId]:{ id:referralId, settlementSignature:claim, level:1,
    recipientWallet:holder, amount:0.002, asset:'SOL', status:'paid', payoutId, payoutSignature:payment } };
  linked.payouts = { [payoutId]:{ id:payoutId, mint, claimId:referralId, source:'solana-keeper-referral-claim',
    to:holder, signature:payment, amountLamports } };
  const receipt = { ...evidence, verifiedPayouts:[{ signature:payment, source:'solana-keeper-referral-claim',
    to:holder, amountLamports }] };
  const paid = rewardExperience(linked, {}, receipt, 'devnet', holder).wallet.rows[0].payouts[0];
  assert.equal(paid.feeSourceVerified, true);
  assert.deepEqual(paid.sourceClaims, [claim]);
  for (const change of [
    item => { item.referralClaims[referralId].settlementSignature = 'Z'.repeat(64); },
    item => { item.referralClaims[referralId].payoutSignature = 'Z'.repeat(64); },
    item => { item.referralClaims[referralId].amount = 0.003; },
    item => { item.settlements[claim].fundedApp.referralLevels[0].recipient = wallet; },
  ]) {
    const mismatched = structuredClone(linked);
    change(mismatched);
    const result = rewardExperience(mismatched, {}, receipt, 'devnet', holder).wallet.rows[0].payouts[0];
    assert.equal(result.feeSourceVerified, false);
    assert.deepEqual(result.sourceClaims, []);
  }
  const unverified = rewardExperience(linked, {}, { ...receipt, verifiedCollections:[] }, 'devnet', holder);
  assert.equal(unverified.wallet.rows[0].payouts[0].feeSourceVerified, false);
});

test('direct payment display uses the same exact 15-lamport legacy SOL conversion as receipt verification', () => {
  const payout = { mint, cluster:'devnet', source:'mint-router-settle-mint', status:'paid', from:router, to:wallet,
    signature:payment, amountSol:1.5e-8 };
  const direct = { launches:{ [mint]:launch }, payouts:{ paid:payout } };
  const proof = { ...evidence, verifiedCollections:[], verifiedPayouts:[{
    signature:payment, source:payout.source, to:wallet, amountLamports:15,
  }] };
  const result = rewardExperience(direct, {}, proof, 'devnet', wallet);
  assert.equal(result.tokens[0].xPaidLamports, '15');
  assert.equal(result.wallet.rows[0].payouts[0].feeSourceVerified, false);
  for (const invalid of [true, '15.000000000000001', '1.5e1', ' 15', Number.MAX_SAFE_INTEGER + 1]) {
    const changed = structuredClone(direct);
    changed.payouts.paid.amountLamports = invalid;
    assert.equal(rewardExperience(changed, {}, proof, 'devnet').tokens[0].xPayoutCount, 0);
  }
  for (const invalidProof of ['15', true, 15.5, Number.MAX_SAFE_INTEGER + 1]) {
    const changed = structuredClone(proof);
    changed.verifiedPayouts[0].amountLamports = invalidProof;
    assert.equal(rewardExperience(direct, {}, changed, 'devnet').tokens[0].xPayoutCount, 0);
  }
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
  assert.equal(result.community.status, 'allocated-awaiting-vault-funding');
});

test('community vault funding is distinct from allocation and spending', () => {
  const vault = 'H'.repeat(32);
  const funded = rewardExperience(state, { ...rewards, fundingRequests:{ [`${claim}:community`]:{
    id:`${claim}:community`, kind:'community-reserve', mint, asset:'SOL', sourceSignature:claim,
    amount:'2000000', status:'funded', balanceDeltaVerified:true, fundingClaim:'claim-record', vault,
  } } }, evidence, 'devnet');
  assert.equal(funded.community.allocatedLamports, '2000000');
  assert.equal(funded.community.fundedLamports, '2000000');
  assert.equal(funded.community.vaultAddress, vault);
  assert.equal(funded.community.paidLamports, null);
  assert.equal(funded.community.status, 'vault-funded-no-program-payout');
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
