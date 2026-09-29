import assert from 'node:assert/strict';
import { coinFeeOverview } from '../server/coin-fee-overview.mjs';

const mint = 'mint-a', cluster = 'devnet';
const launch = { onchainVerified:true, cluster, creatorWallet:'creator-wallet', creator:'router-a', pumpFeeRoute:{ scope:'per-mint-v2', router:'router-a' }, feeDistribution:{ creatorDirected:{ shares:{ creatorWalletPercent:80, holderAirdropPercent:0, solClaimPercent:0 } } } };
const base = { mint, cluster, launch, pumpAccruedLamports:'623763', pumpVault:'vault-a' };
const before = coinFeeOverview(base);
assert.equal(before.pump.accruedLamports, '623763');
assert.equal(before.collectedLamports, '0');
assert.equal(before.receivers.find(row => row.id === 'creator').allocatedLamports, '0');

const collection = { mint, cluster, signature:'claim-a', status:'collected', attribution:'mint-verified', onchainVerified:true, collectedLamports:1_000_000_000 };
const settlement = {
  grossCreatorFees:1,
  creatorDestinations:{ creatorWallet:0.8, holderAirdrop:0, solClaim:0 },
  fundedApp:{ operations:0.14, communityBase:0.02, buyback:0.01, referralLevels:[
    { level:1, recipient:'referrer-a', amount:0.02 },
    { level:2, recipient:null, amount:0.006 },
    { level:3, recipient:null, amount:0.004 },
  ] },
};
const rewardState = { fundingRequests:{ 'claim-a:creator':{ id:'claim-a:creator', status:'funded', recipient:'creator-wallet', scheduleId:'schedule-a' } }, schedules:{ 'schedule-a':{ payments:{ 'creator-wallet':{ status:'paid', amount:'800000000', finalized:true, balanceDeltaVerified:true, signature:'paid-a' } } } } };
const after = coinFeeOverview({ ...base, collections:{ a:collection, unrelated:{ ...collection, mint:'other', signature:'claim-other', collectedLamports:5_000_000_000 }, shared:{ ...collection, signature:'claim-shared', attribution:'router' } }, settlements:{ 'claim-a':settlement }, rewardState });
assert.equal(after.collectedLamports, '1000000000');
assert.equal(after.allocatedLamports, '1000000000');
assert.equal(after.receivers.find(row => row.id === 'creator').confirmedPaidLamports, '800000000');
assert.equal(after.receivers.find(row => row.id === 'creator').withoutConfirmedPayoutLamports, '0');
assert.equal(after.receivers.find(row => row.id === 'community').allocatedLamports, '30000000');
assert.equal(after.receivers.find(row => row.id === 'referral-1').withoutConfirmedPayoutLamports, '20000000');
const paid = coinFeeOverview({ ...base, collections:{ a:collection }, settlements:{ 'claim-a':settlement }, rewardState, referralClaims:{ r:{ settlementSignature:'claim-a', level:1, recipientWallet:'referrer-a', status:'paid', payoutSignature:'ref-paid' } }, verifiedPayoutSignatures:['ref-paid'] });
assert.equal(paid.receivers.find(row => row.id === 'referral-1').confirmedPaidLamports, '20000000');
const unverified = coinFeeOverview({ ...base, collections:{ a:collection }, settlements:{ 'claim-a':settlement }, rewardState, referralClaims:{ r:{ settlementSignature:'claim-a', level:1, recipientWallet:'referrer-a', status:'paid', payoutSignature:'ref-paid' } } });
assert.equal(unverified.receivers.find(row => row.id === 'referral-1').confirmedPaidLamports, '0');
console.log('coin fee overview: verified collection isolation, allocation, and confirmed payment totals');
