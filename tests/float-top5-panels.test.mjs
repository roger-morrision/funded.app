import test from 'node:test';
import assert from 'node:assert/strict';
import { proofTotals, proofTotalsMarkup, formatProofSol, formatProofUsd } from '../src/features/proof/proof-totals.js';
import { holderRewardsSummary, holderRewardsMarkup, relativeTime } from '../src/features/coin/holder-rewards-card.js';
import { bonusCountdownSummary, bonusCountdownMarkup, formatCountdown } from '../src/features/leaderboard/bonus-countdown.js';
import { launchFeeSentence } from '../src/features/launch/preview-view.js';

const summary = {
  launches: 9, collections: 6, referralPayoutCount: 15, dailyBonusPayoutCount: 15,
  exactLamports: { collectedLamports: '15669055', referralPaidLamports: '55450', dailyBonusPaidLamports: '161000' },
  rewardPaid: { holder: { paidLamports: '1566306', payoutCount: 14 } },
  homeFeeAllocations: { buybackLamports: '783452', burnedTokens: 1199, verifiedBurnCount: 4 },
};

test('proof totals read paid amounts from the analytics summary', () => {
  const items = proofTotals(summary);
  const by = Object.fromEntries(items.map(item => [item.key, item]));
  assert.equal(by.fees.lamports, 15669055);
  assert.equal(by.holders.lamports, 1566306);
  assert.equal(by.referrals.note, '15 payments');
  assert.equal(by.buyback.lamports, null);
  assert.match(by.buyback.note, /receipts unavailable/);
  assert.equal(by.launches.value, '9');
  assert.equal(proofTotals(null), null);
});

test('proof totals format small SOL amounts and add USD only with a price', () => {
  assert.equal(formatProofSol(15669055), '0.016 SOL');
  assert.equal(formatProofSol(0), '0 SOL');
  assert.equal(formatProofSol(50), '<0.0001 SOL');
  assert.equal(formatProofSol(null), '—');
  assert.equal(formatProofUsd(15669055, 91.5), '$1.43');
  assert.equal(formatProofUsd(15669055, null), '');
  const markup = proofTotalsMarkup(proofTotals(summary), { keys: ['holders', 'launches'], hrefPrefix: '/' });
  assert.match(markup, /href="\/#payments\/history"/);
  assert.equal((markup.match(/class="proof-total"/g) || []).length, 2);
  assert.doesNotMatch(markup, /≈/);
});

test('holder rewards card shows paid, waiting pot and payout rule, hidden without a holder share', () => {
  const token = { symbol: 'REDQA', holderSharePercent: 10, totals: { holder: '284657' }, holderPaidLamports: '284059', holderPaidWallets: 4, holderPayoutCount: 9, lastHolderPayout: '2026-11-01T06:19:30.283Z', holderRewardPolicy: { cadence: 'hourly', minimumHolderUsd: 20 } };
  const result = holderRewardsSummary(token);
  assert.deepEqual({ paid: result.paid, waiting: result.waiting, wallets: result.wallets }, { paid: 284059, waiting: 598, wallets: 4 });
  const markup = holderRewardsMarkup(result, { now: Date.parse('2026-11-01T07:19:30Z') });
  assert.match(markup, /\$REDQA holders earn 10% of creator fees/);
  assert.match(markup, /9 payments to 4 wallets/);
  assert.match(markup, /Paid in SOL every hour to eligible holders of \$REDQA \(at least \$20 worth\)/);
  assert.match(markup, /1 h ago/);
  assert.equal(holderRewardsSummary({ ...token, holderSharePercent: 0 }), null);
  assert.equal(holderRewardsSummary({ ...token, holderPaidLamports: '999999999' }).waiting, 0);
  assert.equal(relativeTime(null), 'No payout yet');
});

test('bonus countdown splits today\'s pool by rank and counts down to the cutoff', () => {
  const now = Date.parse('2026-11-03T06:30:00Z');
  const result = bonusCountdownSummary({ dashboard: { nextCutoffAt: '2026-11-04T00:00:00.000Z', pool: { categoryLamports: { traders: '1000000000', creators: '0' } } }, bonus: { policy: { rankPercents: [50, 30, 20] } }, now });
  assert.equal(formatCountdown(result.remainingMs), '17h 30m 00s');
  assert.deepEqual(result.prizes.map(item => item.lamports), [500000000, 300000000, 200000000]);
  assert.match(bonusCountdownMarkup(result), /0.5 SOL/);
  const creators = bonusCountdownSummary({ dashboard: { nextCutoffAt: '2026-11-04T00:00:00.000Z', pool: { categoryLamports: { creators: '0' } } }, view: 'creators', now });
  assert.match(bonusCountdownMarkup(creators), /Grows with every fee collected today/);
  assert.match(bonusCountdownMarkup(creators), /<span>50%<\/span><small>of the pool<\/small>/);
  assert.doesNotMatch(bonusCountdownMarkup(creators), /<li><b>#1<\/b><span>0 SOL/);
  const scheduleOnly = bonusCountdownSummary({ bonus: { nextCutoffAt: '2026-11-04T00:00:00.000Z' }, now });
  assert.equal(scheduleOnly.poolLamports, null);
  assert.match(bonusCountdownMarkup(scheduleOnly), /Total appears once/);
  assert.equal(bonusCountdownSummary({}), null);
});

test('launch fee sentence names every paid party in plain words', () => {
  assert.equal(launchFeeSentence({ symbol: 'PUP', creator: 40, holders: 40, x: 0 }), 'Of every creator fee $PUP earns, you keep 40% and holders share 40%. The other 20% pays for operations, referrals, the Daily bonus and $FUNDED burns.');
  assert.match(launchFeeSentence({ creator: 40, holders: 0, x: 40, xHandle: '@alice' }), /your coin earns, you keep 40% and @alice gets 40%/);
  assert.match(launchFeeSentence({ creator: 40, holders: 20, x: 20, xHandle: '' }), /you keep 40%, holders share 20% and the X account gets 20%/);
});
