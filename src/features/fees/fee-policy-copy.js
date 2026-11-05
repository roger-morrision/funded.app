import {FEE_EXECUTION_COPY} from './execution-copy.js';
import { FEE_DISTRIBUTION } from '../../../distribution-policy.js';
import { DAILY_BONUS_POLICY } from '../../../config/daily-bonus.js';
import {referralRatePresentation} from './referral-rate-copy.js';
import {feeDistributionPresentation,FEE_PERCENT_BASIS} from './distribution-summary.js';

export function sharedFeeAllocationCopy(fee=FEE_DISTRIBUTION) {
  return feeDistributionPresentation(fee).rows.filter(row=>row.key!=='creator').map(row=>`${row.percent}% ${row.label}`).join(' · ');
}

export function savedFeeAllocationCopy(policy) {
  const saved=policy?.fixedFunded;
  const rows=[['Operations & marketing',saved?.operations],['Referral network',saved?.appReferral],
    ['Daily bonus',saved?.communityRewards],['$FUNDED buyback & burn',saved?.fundedBuyback],
    ...(saved?.marketingAgency?[['AI marketing & coin buybacks',saved.marketingAgency]]:[])];
  if(saved?.percent!==20||rows.some(([,row])=>typeof row?.effectivePercentOfCreatorFees!=='number'||!Number.isFinite(row.effectivePercentOfCreatorFees)||row.effectivePercentOfCreatorFees<0)
    ||Math.abs(rows.reduce((sum,[,row])=>sum+row.effectivePercentOfCreatorFees,0)-20)>0.000001)return 'Operations & marketing and reward allocations: inspect the saved policy';
  return rows.map(([label,row])=>`${row.effectivePercentOfCreatorFees}% ${label}`).join(' · ');
}

export function bonusRankCopy() {
  return `1st ${DAILY_BONUS_POLICY.rankPercents[0]}% · 2nd ${DAILY_BONUS_POLICY.rankPercents[1]}% · 3rd ${DAILY_BONUS_POLICY.rankPercents[2]}% of the category budget`;
}

export function bonusCategoryCopy() {
  return `Creators, direct referrers and traders each receive one third of the Daily bonus pool. Within each category: ${bonusRankCopy()}.`;
}

// Read live bindings when rendering so saved admin policy overrides the build default.
export function currentFeePolicyCopy() {
  const fee = FEE_DISTRIBUTION;
  const rates = [fee.operationsEffectivePercent, fee.appReferralEffectivePercent,
    fee.communityEffectivePercent, fee.buybackEffectivePercent];
  const names = ['Operations & marketing', 'Referral network', 'Daily bonus', '$FUNDED buyback & burn'];
  if(fee.agencyEffectivePercent!==undefined){rates.push(fee.agencyEffectivePercent);names.push('AI marketing & coin buybacks');}
  const presentation=feeDistributionPresentation(fee);
  return {
    allocation: `${presentation.headline}. ${presentation.allocation} ${FEE_PERCENT_BASIS}`,
    headline:presentation.headline,
    benefits:presentation.benefitLine,
    scope: 'Current policy for new launches. Existing coins and historical settlements keep their recorded rates. Allocated SOL is not a wallet balance or a completed payment.',
  collection: FEE_EXECUTION_COPY.collection,
    creator: FEE_EXECUTION_COPY.creator,
    holders: 'Holder SOL payouts are automatic after a funded reward pool and complete finalized eligibility snapshot are verified; recipients do not claim or sign. Standard payouts are hourly; selected Devnet QA coins use five-minute cycles and reduced minimums. Check the coin’s current conditions and receipt.',
    x: 'X rewards require the allocated X account to sign in, link the recipient wallet, and claim. A completed sign-in or signature prompt is not a finalized payment.',
    referrals: `${referralRatePresentation().guide} ${FEE_EXECUTION_COPY.referralDelivery}`,
    reserve: 'Missing referral levels stay in the community reserve. They are not reassigned to another inviter or added to the Daily bonus pool.',
    bonus: `The ${fee.communityEffectivePercent}% Daily bonus pool is funded from gross collected creator fees at each coin’s saved rate. ${bonusCategoryCopy()} Each completed UTC day closes at 00:00 UTC. Creators rank by finalized settled fees, referrers by direct referred creators’ settled fees, and traders by finalized buy and sell SOL volume. Fees qualify in the window when settlement finalizes; later settlements enter a later window. New trader rankings include only wallets that can sign directly; program-derived addresses are excluded. Existing snapshots keep their original eligibility and paid rankings stay frozen.`,
    bonusFunding: 'Daily bonuses are paid automatically to winning wallets after the snapshot and source funding are verified. No manual claim or recipient signature is required. Standard snapshots close daily; an explicitly labeled Devnet QA mode uses five-minute windows for selected test coins, with checks every 30 seconds. The cutoff is not an immediate payment guarantee. Ties use wallet address order; unfilled ranks retain their share in the reserve. The separate community airdrop uses launched coin tokens, not this SOL pool.',
    buyback: 'The buyback allocation stays in dedicated program vaults until the configured aggregate trigger is met. The worker then attempts a protected $FUNDED purchase and burn. Market checks and finalized purchase/burn receipts are required; the allocation itself is not a burn.',
    agency: 'Every new launch includes both own-coin buyback-and-burn agents. Promotion packages also include X promotion. They share the separate AI marketing allocation equally and use only verified, funded budgets at their saved milestones or cadence. Existing coins retain their saved selections. Policy publication does not establish current executor readiness.',
    steps: [`${fee.creatorPercent}% creator-directed`,...rates.map((rate, i) => `${rate}% ${names[i]}`)],
  };
}
