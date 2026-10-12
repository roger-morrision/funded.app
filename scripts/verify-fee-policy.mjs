import assert from 'node:assert/strict';
import { APP_REFERRAL_LEVELS, buildFeeDistributionPolicy, calculateCreatorFeeClaim, FEE_DISTRIBUTION, settleCreatorFeeClaim, validateFeeDistribution, validateProtocolFeeSplit } from '../distribution-policy.js';
import { createFeeFlowView } from '../src/features/fees/fee-flow-view.js';
import { readFileSync } from 'node:fs';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';

const configured = validateProtocolFeeSplit(PROTOCOL_FEE_SPLIT);
const grossRate = rate => Number((rate / 5).toFixed(6));

assert.equal(FEE_DISTRIBUTION.pumpRoutedPercent, 100);
assert.equal(FEE_DISTRIBUTION.pumpRoutedShareBps, 10_000);
assert.equal(FEE_DISTRIBUTION.fundedPercent, 20);
assert.equal(FEE_DISTRIBUTION.creatorPercent, 80);
assert.equal(FEE_DISTRIBUTION.operationsRateOfFundedRevenue, configured.operationsPercent);
assert.equal(FEE_DISTRIBUTION.appReferralRateOfFundedRevenue, configured.referralLevelPercents.reduce((sum, rate) => sum + rate, 0));
assert.equal(FEE_DISTRIBUTION.communityRateOfFundedRevenue, configured.communityPercent);
assert.equal(FEE_DISTRIBUTION.buybackRateOfFundedRevenue, configured.buybackPercent);
assert.equal(FEE_DISTRIBUTION.operationsRateOfFundedRevenue + FEE_DISTRIBUTION.appReferralRateOfFundedRevenue + FEE_DISTRIBUTION.communityRateOfFundedRevenue + FEE_DISTRIBUTION.buybackRateOfFundedRevenue, 100);
assert.deepEqual(APP_REFERRAL_LEVELS.map(level => level.percentOfFundedRevenue), configured.referralLevelPercents);
assert.deepEqual(APP_REFERRAL_LEVELS.map(level => level.effectivePercentOfCreatorFees), configured.referralLevelPercents.map(grossRate));
assert.equal(validateFeeDistribution({ creatorWalletPercent: 50, holderAirdropPercent: 30, xPercent: 0 }).valid, true);
assert.equal(validateFeeDistribution({ creatorWalletPercent: 50, holderAirdropPercent: 20, xPercent: 10, xRecipient: '@creator' }).valid, true);
assert.equal(validateFeeDistribution({ creatorWalletPercent: 50, holderAirdropPercent: 20, xPercent: 9 }).valid, false);
assert.equal(validateFeeDistribution({ creatorWalletPercent: 60, holderAirdropPercent: 10, xPercent: 10 }).xRecipientValid, false);
assert.equal(validateFeeDistribution({ creatorWalletPercent: 90, holderAirdropPercent: 0, xPercent: 0 }).sharesValid, false);
assert.equal(validateFeeDistribution({ creatorWalletPercent: 50, holderAirdropPercent: 20, xPercent: 10, xRecipient: 'creator' }).valid, false);

const policy = buildFeeDistributionPolicy({ creatorWalletPercent: 50, holderAirdropPercent: 30, xPercent: 0, feeRouterAddress: 'router-address' });
assert.equal(policy.pumpCreatorFeeRoute.percent, 100);
assert.equal(policy.pumpCreatorFeeRoute.shareBps, 10_000);
assert.equal(policy.pumpCreatorFeeRoute.routerAddress, 'router-address');
assert.equal(policy.fixedFunded.percent, 20);
assert.equal(policy.fixedFunded.operations.effectivePercentOfCreatorFees, grossRate(configured.operationsPercent));
assert.equal(policy.fixedFunded.appReferral.effectivePercentOfCreatorFees, grossRate(configured.referralLevelPercents.reduce((sum, rate) => sum + rate, 0)));
assert.equal(policy.fixedFunded.appReferral.maxDepth, 3);
assert.equal(policy.fixedFunded.appReferral.levels.length, 3);
assert.equal(policy.fixedFunded.appReferral.unattributedDestination, 'community-growth-reserve');
assert.equal(policy.fixedFunded.communityRewards.effectivePercentOfCreatorFees, grossRate(configured.communityPercent));
assert.equal(policy.fixedFunded.communityRewards.destination, 'community-program-reserve');
assert.equal(policy.fixedFunded.communityRewards.payoutMode, 'disabled-until-program-rules-and-verified-receipts');
assert.equal(policy.fixedFunded.fundedBuyback.effectivePercentOfCreatorFees, grossRate(configured.buybackPercent));
assert.equal(policy.creatorDirected.percent, 80);
assert.equal(policy.immutable, true);

const claim = calculateCreatorFeeClaim(100, { creatorWalletPercent: 50, holderAirdropPercent: 20, xPercent: 10, xRecipient: '@creator' }, { referralRecipients: ['L1'] });
assert.equal(claim.pumpRouterIngress, 100);
assert.deepEqual(claim.creatorDestinations, { creatorWallet: 50, holderAirdrop: 20, solClaim: 10 });
assert.equal(claim.fundedApp.operations, grossRate(configured.operationsPercent));
assert.equal(claim.fundedApp.referralPayout, grossRate(configured.referralLevelPercents[0]));
assert.equal(claim.fundedApp.referralLevels[0].status, 'claimable');
assert.equal(claim.fundedApp.referralLevels[0].payoutMode, 'user-initiated-wallet-claim');
assert.equal(claim.fundedApp.missingReferralToCommunity, grossRate(configured.referralLevelPercents[1] + configured.referralLevelPercents[2]));
assert.equal(claim.fundedApp.community, grossRate(configured.communityPercent + configured.referralLevelPercents[1] + configured.referralLevelPercents[2]));
assert.equal(claim.fundedApp.buyback, grossRate(configured.buybackPercent));
assert.equal(claim.totalAllocated, 100);

const claims = new Map();
const first = settleCreatorFeeClaim({ claimSignature: 'claim-1', grossCreatorFees: 100 }, { creatorWalletPercent: 80, holderAirdropPercent: 0, xPercent: 0 }, { referralRecipients: ['L1', 'L2', 'L3'] }, claims);
const duplicate = settleCreatorFeeClaim({ claimSignature: 'claim-1', grossCreatorFees: 999 }, { creatorWalletPercent: 80, holderAirdropPercent: 0, xPercent: 0 }, {}, claims);
assert.equal(first, duplicate);
assert.equal(claims.size, 1);
const alternate = { operationsPercent: 50, referralLevelPercents: [12, 5, 3], communityPercent: 20, buybackPercent: 10 };
assert.deepEqual(validateProtocolFeeSplit(alternate), alternate);
assert.throws(() => validateProtocolFeeSplit({ ...alternate, buybackPercent: 11 }), /totaling 100%/);
assert.throws(() => validateProtocolFeeSplit({ ...alternate, referralLevelPercents: [20, -3, 3] }), /totaling 100%/);
assert.throws(() => validateProtocolFeeSplit({ ...alternate, referralLevelPercents: [12, 8] }), /three referral levels/);
const alternatePolicy = buildFeeDistributionPolicy({ creatorWalletPercent: 80 }, { fundedSplit: alternate });
assert.equal(alternatePolicy.fixedFunded.operations.effectivePercentOfCreatorFees, 10);
assert.deepEqual(alternatePolicy.fixedFunded.appReferral.levels.map(level => level.effectivePercentOfCreatorFees), [2.4, 1, 0.6]);
assert.equal(alternatePolicy.fixedFunded.communityRewards.effectivePercentOfCreatorFees, 4);
assert.equal(alternatePolicy.fixedFunded.fundedBuyback.effectivePercentOfCreatorFees, 2);
const alternateClaim = calculateCreatorFeeClaim(100, { creatorWalletPercent: 80 }, { fixedFunded: alternatePolicy.fixedFunded, referralRecipients: ['L1', 'L2', 'L3'] });
assert.deepEqual([alternateClaim.fundedApp.operations, alternateClaim.fundedApp.referralPayout, alternateClaim.fundedApp.community, alternateClaim.fundedApp.buyback], [10, 4, 4, 2]);
assert.equal(alternateClaim.totalAllocated, 100);
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
for (const id of ['fee-policy-faq', 'buyback-policy-heading', 'buyback-policy-note']) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} must be rendered from the configured policy`);
}
const nodes = new Map([...['#fee-policy-faq', '#buyback-policy-heading', '#buyback-policy-note']].map(selector => [selector, { textContent: '' }]));
const bars = Array.from({ length: 5 }, () => ({ style: {} }));
const rows = Array.from({ length: 5 }, () => ({ textContent: '' }));
const previousDocument = globalThis.document;
globalThis.document = {
  querySelector: selector => nodes.get(selector) || null,
  querySelectorAll: selector => selector === '.home-receipt-card .receipt-bars span' ? bars
    : selector === '.home-receipt-card .receipt-rows span' ? rows : [],
};
try {
  createFeeFlowView({ creatorSharePercent: 80, fundedSharePercent: 20,
    operationsEffectivePercent: 10, appReferralEffectivePercent: 4, communityEffectivePercent: 4, buybackEffectivePercent: 2,
    operationsRateOfFundedRevenue: 50, appReferralRateOfFundedRevenue: 20, communityRateOfFundedRevenue: 20, buybackRateOfFundedRevenue: 10,
    appReferralLevels: alternatePolicy.fixedFunded.appReferral.levels }).renderPublishedFeeRates();
  assert.match(nodes.get('#fee-policy-faq').textContent, /referrals \(4%\).*community \(4%\).*buyback allocation \(2%\)/);
  assert.equal(nodes.get('#buyback-policy-heading').textContent, 'Preview the 2% policy');
  assert.match(nodes.get('#buyback-policy-note').textContent, /0\.100 SOL.*Local calculation only/);
  assert.deepEqual(bars.map(node => node.style.width), ['80%', '10%', '4%', '4%', '2%']);
  assert.equal(rows[4].textContent, '2 SOL Buyback allocation');
} finally { globalThis.document = previousDocument; }
const legacyPolicy = buildFeeDistributionPolicy({ creatorWalletPercent: 80 }, { fundedSplit: { operationsPercent: 70, referralLevelPercents: [10, 3, 2], communityPercent: 10, buybackPercent: 5 } });
const oldClaim = calculateCreatorFeeClaim(100, { creatorWalletPercent: 80 }, { fixedFunded: legacyPolicy.fixedFunded, referralRecipients: ['L1', 'L2', 'L3'] });
assert.deepEqual([oldClaim.fundedApp.operations, oldClaim.fundedApp.referralPayout, oldClaim.fundedApp.community, oldClaim.fundedApp.buyback], [14, 3, 2, 1]);
assert.throws(() => calculateCreatorFeeClaim(100, { creatorWalletPercent: 80 }, { fixedFunded: { ...alternatePolicy.fixedFunded, percent: 25 } }), /20% app share/);
for (let lamports = 1; lamports <= 1000; lamports++) {
  const exact = calculateCreatorFeeClaim(lamports / 1_000_000_000, { creatorWalletPercent: 80 }, { fixedFunded: alternatePolicy.fixedFunded, referralRecipients: ['L1', 'L2', 'L3'] });
  assert.equal(Math.round(exact.totalAllocated * 1_000_000_000), lamports);
  assert.equal(Math.round((exact.creatorTotal + exact.fundedApp.total) * 1_000_000_000), lamports);
}
console.log('fee distribution policy checks passed');
