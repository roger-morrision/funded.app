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
const rewardState = { fundingRequests:{
  'claim-a:creator':{ id:'claim-a:creator', status:'funded', recipient:'creator-wallet', scheduleId:'schedule-a' },
  'claim-a:operations':{ id:'claim-a:operations', status:'funded', recipient:'owner-wallet', scheduleId:'schedule-operations' },
}, schedules:{
  'schedule-a':{ payments:{ 'creator-wallet':{ status:'paid', amount:'800000000', finalized:true, balanceDeltaVerified:true, signature:'paid-a' } } },
  'schedule-operations':{ payments:{ 'owner-wallet':{ status:'paid', amount:'140000000', finalized:true, balanceDeltaVerified:true, signature:'paid-operations' } } },
} };
const after = coinFeeOverview({ ...base, operationsRecipient:'owner-wallet', collections:{ a:collection, unrelated:{ ...collection, mint:'other', signature:'claim-other', collectedLamports:5_000_000_000 }, shared:{ ...collection, signature:'claim-shared', attribution:'router' } }, settlements:{ 'claim-a':settlement }, rewardState });
assert.equal(after.collectedLamports, '1000000000');
assert.equal(after.allocatedLamports, '1000000000');
assert.equal(after.receivers.find(row => row.id === 'creator').confirmedPaidLamports, '800000000');
assert.equal(after.receivers.find(row => row.id === 'creator').withoutConfirmedPayoutLamports, '0');
assert.equal(after.receivers.find(row => row.id === 'operations').recipient, 'owner-wallet');
assert.equal(after.receivers.find(row => row.id === 'operations').confirmedPaidLamports, '140000000');
assert.deepEqual(after.receivers.find(row => row.id === 'operations').payoutSignatures, ['paid-operations']);
assert.equal(after.receivers.find(row => row.id === 'community').allocatedLamports, '30000000');
assert.equal(after.receivers.find(row => row.id === 'referral-1').withoutConfirmedPayoutLamports, '20000000');
const paid = coinFeeOverview({ ...base, collections:{ a:collection }, settlements:{ 'claim-a':settlement }, rewardState, referralClaims:{ r:{ settlementSignature:'claim-a', level:1, recipientWallet:'referrer-a', status:'paid', payoutSignature:'ref-paid' } }, verifiedPayoutSignatures:['ref-paid'] });
assert.equal(paid.receivers.find(row => row.id === 'referral-1').confirmedPaidLamports, '20000000');
const unverified = coinFeeOverview({ ...base, collections:{ a:collection }, settlements:{ 'claim-a':settlement }, rewardState, referralClaims:{ r:{ settlementSignature:'claim-a', level:1, recipientWallet:'referrer-a', status:'paid', payoutSignature:'ref-paid' } } });
assert.equal(unverified.receivers.find(row => row.id === 'referral-1').confirmedPaidLamports, '0');
const micro = coinFeeOverview({ ...base, collections:{ tiny:{ ...collection, signature:'tiny', collectedLamports:17822 } },
  settlements:{ tiny:{ ...settlement, grossCreatorFees:0.000017822, creatorDestinations:{ creatorWallet:0.000012475, holderAirdrop:0.000001782, solClaim:0 },
    fundedApp:{ ...settlement.fundedApp, operations:0.000002495, communityBase:3.56e-7, buyback:1.78e-7,
      referralLevels:[{ level:1, recipient:'referrer-a', amount:3.56e-7 }] } } } });
assert.equal(micro.receivers.find(row => row.id === 'referral-1').allocatedLamports, '356');
assert.equal(micro.receivers.find(row => row.id === 'community').allocatedLamports, '356');
const holderSettlement = { ...settlement, creatorDestinations:{ creatorWallet:0.7, holderAirdrop:0.1, solClaim:0 } };
const holderRequestId = 'claim-a:holders';
const holderPool = { id:holderRequestId, mint, asset:'SOL', status:'assigned', scheduleId:'holder-cycle', amount:'100000000', balanceDeltaVerified:true };
const holderPayment = { status:'paid', amount:'99999999', finalized:true, balanceDeltaVerified:true, signature:'holder-paid' };
const holderState = { ...rewardState, rewardPools:{ [holderRequestId]:holderPool }, schedules:{ ...rewardState.schedules,
  'holder-cycle':{ id:'holder-cycle', mint, kind:'holder', asset:'SOL', poolIds:[holderRequestId], payments:{ 'holder-wallet':holderPayment } },
} };
const holderOverview = coinFeeOverview({ ...base, collections:{ a:collection }, settlements:{ 'claim-a':holderSettlement }, rewardState:holderState });
assert.equal(holderOverview.receivers.find(row => row.id === 'holders').confirmedPaidLamports, '99999999');
assert.deepEqual(holderOverview.receivers.find(row => row.id === 'holders').payoutSignatures, ['holder-paid']);
const mixedState = { ...holderState, rewardPools:{ ...holderState.rewardPools,
  'qa-top-up':{ ...holderPool, id:'qa-top-up' } }, schedules:{ ...holderState.schedules,
  'holder-cycle':{ ...holderState.schedules['holder-cycle'], poolIds:[holderRequestId, 'qa-top-up'] },
} };
const mixedOverview = coinFeeOverview({ ...base, collections:{ a:collection }, settlements:{ 'claim-a':holderSettlement }, rewardState:mixedState });
assert.equal(mixedOverview.receivers.find(row => row.id === 'holders').confirmedPaidLamports, '0');
console.log('coin fee overview: verified collection isolation, allocation, and confirmed payment totals');
